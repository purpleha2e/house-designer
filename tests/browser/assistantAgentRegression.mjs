import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { installNativeAudit } from './rendererAuditNative.js'
import { parseAgentRequest } from '../../server/design-agent-input.ts'
import { defaultAgentLimits, runDesignAgent } from '../../server/design-agent-loop.ts'

const port = process.argv[2] ?? '5182'
const browser = await lightingBrowser({ requestTimeout: 45_000, onEvent(event) {
  if (event.method === 'Fetch.requestPaused') void answerRedesign(event.params)
} })
const url = `http://127.0.0.1:${port}/tests/browser/assistantLayout.html`
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const click = (selector, label) => browser.evaluate(`(() => {
  const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => ${label ? `node.textContent.trim() === ${JSON.stringify(label)}` : 'true'});
  if (!element || element.disabled) throw new Error('Missing enabled control: ' + ${JSON.stringify(label ?? selector)});
  element.click();
})()`)
const send = async text => {
  await browser.evaluate(`document.querySelector('#design-assistant-request').focus()`)
  await browser.call('Input.insertText', { text })
  await click('.design-assistant button[type=submit]')
  await browser.evaluate('document.activeElement.blur()')
}
const mode = `document.querySelector('select[aria-label="Assistant mode"]')`
const ready = `!!window.assistantThree?.()?.scene && !!window.assistantPlanProps?.()?.floors`
const topology = `assistantPlanProps().floors.map(floor => ({walls:floor.walls,models:floor.models,rooms:floor.rooms}))`
const footprints = `assistantPlanProps().floors.map(floor => floor.floorFootprints ?? null)`
const overlay = `assistantPlan().findOne('.assistant-layout-preview')`
const mixedBrief = "this is my house. we can extend out the north side by 4m, out the east side by 2.5m. could you please design a wraparound extension so we have a kitchen/diner and open plan living. 4 bedrooms upstairs, one of them with an en-suite, family bathroom and any stairs you think would look good. we're going for farmhouse style"
const coordinatedPrompt = 'Design an office and kitchen downstairs and stairs up to two bedrooms and a family bathroom.'
const integratedBrief = 'Extend out the north side by 4m and east side by 2.5m with a two-storey wraparound extension. Design the office and kitchen downstairs and stairs up to two bedrooms and a family bathroom.'
const timeoutBrief = 'Could you review the room layout on the ground floor?'
const retryAttempts = []
let agentRequests = 0
let continuedRequest

const redesignProvider = { start() {
  let step = 0
  let draftId, connection, opening, roomId
  return { async next(outputs) {
    const result = outputs[0]?.result
    if (result) assert.ok(result.ok, result.message)
    const tool = (name, args) => ({ calls: [{ id: `browser-redesign-${step}`, name, args: JSON.stringify(args) }] })
    switch (step++) {
      case 0: return tool('get_floor_layout', { floorId: 'upper', draftId: null })
      case 1: {
        connection = result.value.connections.find(link => link.from && link.to)
        opening = result.value.openings.find(item => item.id === connection.openingId)
        roomId = result.value.rooms.find(room => [connection.from, connection.to].includes(room.id) && room.function !== 'landing').id
        return tool('begin_room_redesign', { floorId: 'upper', baseId: null, bedrooms: null, ensuites: 0 })
      }
      case 2:
        draftId = result.value.draftId
        return tool('remove_opening', { draftId, openingId: opening.id })
      case 3: return tool('insert_internal_door', { draftId, doors: [{ wallId: connection.wallId, roomId, offset: opening.center }] })
      case 4: return tool('insert_windows', { draftId, windows: [{ wallId: 'wall-1', offset: 4.6, width: 1.2, height: 1.05, sillHeight: 1 }] })
      case 5: return tool('evaluate_layout', { draftId })
      case 6:
        assert.equal(result.value.valid, true, JSON.stringify(result.value.findings))
        return tool('publish_design', { draftId, title: 'Window and replacement door', explanation: 'Replace a bedroom door and add a new window.',
          advantages: [], compromises: [] })
      default: return { calls: [], message: 'The 2D plan shows a replacement door and a new window.' }
    }
  } }
} }

const coordinatedProvider = { start(input) {
  const extended = input.context.extensionStage === 'interior'
  const north = extended ? -4 : 0, east = extended ? 14.1 : 11.6
  const removeWallIds = extended ? ['wall-0', 'wall-1'] : []
  const walls = [{ start: [4.2, north], end: [4.2, 9.2] }, { start: [7.4, north], end: [7.4, 9.2] }]
  const room = (name, role, at, accessFrom = 1) => ({ name, role, at, accessFrom, daylight: false })
  return { async next() {
    return { calls: [{ id: 'browser-coordinated', name: 'compose_two_storey_layout', args: JSON.stringify({
      lower: { floorId: 'lower', removeWallIds, closeOpeningIds: [], walls,
        rooms: [room('Hallway', 'hall', [6, 4], null), room('Office', 'office', [2, 4]), room('Kitchen diner', 'kitchen-diner', [10, 4])] },
      upper: { floorId: 'upper', removeWallIds, closeOpeningIds: [], walls: [...walls, { start: [7.4, 5], end: [east, 5] }],
        rooms: [room('Landing', 'hall', [6, 4], null), room('Bedroom 1', 'bedroom', [2, 4]), room('Bedroom 2', 'bedroom', [10, 3]),
          room('Family bathroom', 'bathroom', [10, 7])] },
      stair: { layout: 'auto', near: null, replaceStairId: 'stairs' },
      title: 'A coordinated home', explanation: 'The rooms and stair share a central hall on both floors.',
    }) }] }
  } }
} }

async function answerRedesign({ requestId, request }) {
  const readingModes = request.method === 'GET'
  let body = JSON.stringify({ demo: true, live: true })
  if (!readingModes) {
    agentRequests++
    try {
      const input = parseAgentRequest(JSON.parse(request.postData))
      assert.ok(input?.mode === 'live')
      const events = []
      if (input.prompt.startsWith('Design the rooms on both floors and fit the stairs')) continuedRequest = input
      const testingRetry = input.prompt === timeoutBrief
      if (testingRetry) retryAttempts.push(input)
      const provider = testingRetry ? { start: () => ({ next: () => retryAttempts.length === 1 ?
        new Promise(() => {}) : Promise.resolve({ calls: [], message: 'I received your original brief again.' }) }) } :
        continuedRequest === input ? { start: () => ({ next: async () => ({ calls: [], message: 'The coordinated layout has the original design brief.' }) }) } :
        input.prompt === coordinatedPrompt || input.prompt === integratedBrief ? coordinatedProvider :
        input.prompt.includes('wraparound') ? { start: () => ({ next: async () => ({
        calls: [{ id: 'browser-extension', name: 'propose_extension', args: JSON.stringify({ floorId: 'lower', upperFloorId: 'upper',
          spans: [{ wallId: 'wall-2', depth: 4 }, { wallId: 'wall-3', depth: 2 }] }) }],
      }) }) } : redesignProvider
      await runDesignAgent(input, provider, new AbortController().signal, event => events.push(event),
        testingRetry ? { ...defaultAgentLimits, modelTurnMilliseconds: 30 } : defaultAgentLimits)
      body = events.map(event => JSON.stringify(event)).join('\n') + '\n'
    } catch (error) {
      body = JSON.stringify({ type: 'error', text: String(error) }) + '\n'
    }
  }
  await browser.call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
    { name: 'Content-Type', value: readingModes ? 'application/json' : 'application/x-ndjson' },
  ], body: Buffer.from(body).toString('base64') })
}

async function openDemo() {
  await click('button[aria-label="Project menu"]')
  await click('.project-menu-dropdown button', 'AI Design Assistant')
  await browser.wait(`!!${mode} && !${mode}.querySelector('[value=demo]').disabled`, 20_000)
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'demo'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  assert.equal(await browser.evaluate(`${mode}.value`), 'demo')
}

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installNativeAudit.toString()})();` })
  await browser.call('Page.navigate', { url })
  await browser.wait(ready, 90_000)
  await openDemo()
  const clipboard = await browser.evaluate(`(() => {
    const prompt = document.querySelector('#design-assistant-request');
    prompt.blur();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.design-assistant-message p'));
    selection.removeAllRanges();
    selection.addRange(range);
    const shortcut = key => new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
    const copy = document.body.dispatchEvent(shortcut('c'));
    selection.removeAllRanges();
    prompt.focus();
    const paste = prompt.dispatchEvent(shortcut('v'));
    return { copy, paste };
  })()`)
  assert.deepEqual(clipboard, { copy: true, paste: true })
  const before = await browser.evaluate(topology)
  await send('Design three bedrooms, a good-sized bathroom and an airy landing upstairs.')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.equal(await browser.evaluate('document.querySelectorAll(".design-assistant-options button").length'), 2,
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  await browser.wait(`(${overlay})?.find('.assistant-doorway').length === 4`)
  const tools = await browser.evaluate(`Array.from(document.querySelectorAll('.design-agent-diagnostics details summary'), e => e.textContent)`)
  assert.ok(tools.some(text => text.startsWith('get_floor_layout')))
  assert.ok(tools.some(text => text.startsWith('publish_design')))
  assert.deepEqual(await browser.evaluate(topology), before)
  const area = `parseFloat(document.querySelectorAll('.design-assistant-metrics dd')[1].textContent)`
  const bathroomBefore = await browser.evaluate(area)
  await send('Could we make the bathroom a little bigger?')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.ok(await browser.evaluate(`${area} > ${bathroomBefore}`), await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  assert.equal(await browser.evaluate(`assistantPlanProps().assistantPreview?.proposal.method`), 'agent')
  assert.deepEqual(await browser.evaluate(topology), before)
  await click('.design-assistant-actions button', 'Apply layout')
  await browser.wait('assistantPlanProps().floors[1].models.length === 4')
  const installed = await browser.evaluate(topology)
  await browser.call('Fetch.enable', { patterns: [{ urlPattern: '*api/workspace/assistant/agent' }] })
  await click('.design-assistant-close')
  await click('button[aria-label="Project menu"]')
  await click('.project-menu-dropdown button', 'AI Design Assistant')
  await browser.wait(`!!${mode}?.querySelector('[value=live]')`)
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'live'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await send('Replace one bedroom door and add a window to the right exterior wall.')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.equal(await browser.evaluate('assistantPlanProps().assistantPreview?.proposal.method'), 'room-redesign',
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  assert.equal(await browser.evaluate(`(${overlay})?.find('.assistant-closed-opening').length`), 1)
  assert.equal(await browser.evaluate(`(${overlay})?.find('.assistant-window').length`), 1)
  assert.equal(await browser.evaluate(`(${overlay})?.find('.assistant-retained-wall').length`), installed[1].walls.length)
  assert.equal(await browser.evaluate(`assistantPlan().findOne('.existing-plan-geometry')?.opacity()`), 0.18)
  assert.deepEqual(await browser.evaluate(topology), installed)
  await click('.design-assistant-actions button', 'Apply layout')
  await browser.wait('assistantPlanProps().floors[1].models.length === 5')
  assert.equal(await browser.evaluate(`assistantPlan().findOne('.existing-plan-geometry')?.opacity()`), 1)
  const redesigned = (await browser.evaluate(topology))[1]
  assert.equal(redesigned.walls.length, installed[1].walls.length)
  assert.equal(installed[1].models.filter(model => !redesigned.models.some(entry => entry.id === model.id)).length, 1)
  assert.equal(redesigned.models.filter(model => model.modelId === 'window-large-single-pane').length, 1)
  await click('button[aria-label="Undo"]')
  await browser.wait('assistantPlanProps().floors[1].models.length === 4')
  assert.deepEqual(await browser.evaluate(topology), installed)
  const slabsBefore = await browser.evaluate(footprints)
  await send('Show a two-storey wraparound extension, 4 m to the rear and 2 m to the right.')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.equal(await browser.evaluate('assistantPlanProps().assistantPreview?.proposal.method'), 'extension',
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  await browser.wait(`assistantPlanProps().activeFloor.id === 'lower' && !!(${overlay})?.findOne('.assistant-extension-area')`)
  await browser.evaluate(`(() => {
    const floor = document.querySelector('select[aria-label="2D editing floor"]')
    floor.value = 'upper'
    floor.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await browser.wait(`assistantPlanProps().activeFloor.id === 'upper' && !!(${overlay})?.findOne('.assistant-extension-area')`)
  assert.deepEqual(await browser.evaluate(topology), installed)
  assert.deepEqual(await browser.evaluate(footprints), slabsBefore)
  await click('.design-assistant-actions button', 'Apply extension')
  await browser.wait('assistantPlanProps().floors.every(floor => floor.rooms.some(room => room.name === "Extension"))')
  assert.ok((await browser.evaluate(footprints)).every(floor => floor?.length))
  await click('button[aria-label="Undo"]')
  await browser.wait(`!(${topology}).flatMap(floor => floor.rooms).some(room => room.name === 'Extension')`)
  assert.deepEqual(await browser.evaluate(topology), installed)
  assert.deepEqual(await browser.evaluate(footprints), slabsBefore)
  const requestsBeforeMeasured = agentRequests
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'demo'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await send(mixedBrief)
  await browser.wait(`assistantPlanProps().assistantPreview?.proposal.method === 'extension' && !!(${overlay})?.findOne('.assistant-extension-area')`)
  assert.equal(agentRequests, requestsBeforeMeasured)
  await click('.design-assistant-actions button', 'Apply extension')
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'live'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await browser.wait(`!!document.querySelector('[aria-label="Continue the extension design"]')`)
  const singleStorey = await browser.evaluate(topology)
  const singleStoreySlabs = await browser.evaluate(footprints)
  await send('sorry, I meant a two-storey extension')
  await browser.wait(`assistantPlanProps().activeFloor.id === 'upper' && !!(${overlay})?.findOne('.assistant-extension-area')`)
  assert.equal(agentRequests, requestsBeforeMeasured)
  assert.deepEqual(await browser.evaluate(topology), singleStorey)
  await click('.design-assistant-actions button', 'Apply extension')
  await browser.wait('assistantPlanProps().floors[1].rooms.some(room => room.name === "Extension")')
  assert.deepEqual((await browser.evaluate(topology))[0], singleStorey[0])
  assert.deepEqual((await browser.evaluate(footprints))[0], singleStoreySlabs[0])
  await click('button[aria-label="Undo"]')
  await browser.wait('!assistantPlanProps().floors[1].rooms.some(room => room.name === "Extension")')
  assert.deepEqual(await browser.evaluate(topology), singleStorey)
  assert.deepEqual(await browser.evaluate(footprints), singleStoreySlabs)
  await click('.design-assistant-actions button', 'Design both floors and stairs')
  await browser.wait(`document.querySelector('.design-assistant-messages').textContent.includes('The coordinated layout has the original design brief.')`)
  assert.equal(agentRequests, requestsBeforeMeasured + 1)
  assert.ok(continuedRequest.history.some(turn => turn.role === 'user' && turn.text === mixedBrief))
  assert.ok(continuedRequest.source.floors[0].rooms.some(room => room.name === 'Extension'))
  await click('button[aria-label="Undo"]')
  await browser.wait(`!(${topology}).flatMap(floor => floor.rooms).some(room => room.name === 'Extension')`)
  assert.equal(await browser.evaluate(`!!document.querySelector('[aria-label="Continue the extension design"]')`), false)
  await browser.call('Fetch.disable')
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'demo'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await click('button[aria-label="Undo"]')
  await browser.wait('assistantPlanProps().floors[1].models.length === 0')
  assert.deepEqual(await browser.evaluate(topology), before)
  await send('Design the upstairs with three bedrooms and a bathroom.')
  await click('button[aria-label="Redo"]')
  await browser.wait(`document.querySelector('.design-assistant-messages').textContent.includes('house changed')`, 30_000)
  assert.equal(await browser.evaluate(`!!(${overlay})`), false)
  await click('button[aria-label="Undo"]')
  await browser.wait('assistantPlanProps().floors[1].models.length === 0')
  await send('Design the upstairs with two bedrooms and a bathroom.')
  await click('.design-assistant-send button', 'Cancel')
  assert.ok(await browser.evaluate('document.querySelector(".design-assistant-messages").textContent.includes("stopped working")'))
  assert.deepEqual(await browser.evaluate(topology), before)
  await browser.call('Fetch.enable', { patterns: [{ urlPattern: '*api/workspace/assistant/agent' }] })
  await browser.evaluate(`(() => { const select = ${mode}; select.value = 'live'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await send(coordinatedPrompt)
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.equal(await browser.evaluate('assistantPlanProps().assistantPreview?.proposal.method'), 'coordinated',
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  assert.ok(await browser.evaluate(`(${overlay})?.find('.assistant-partition').length > 0`))
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.assistant-preview-floors button')].map(button => [button.textContent, button.getAttribute('aria-pressed')])`),
    [['Ground floor', 'true'], ['First floor', 'false']])
  await click('.assistant-preview-floors button', 'First floor')
  await browser.wait(`assistantPlanProps().activeFloor.id === 'upper' && (${overlay})?.find('.assistant-partition').length > 0`)
  assert.equal(await browser.evaluate(`document.querySelector('.assistant-preview-floors [aria-pressed="true"]').textContent`), 'First floor')
  await click('.assistant-preview-floors button', 'Ground floor')
  await browser.wait(`assistantPlanProps().activeFloor.id === 'lower' && !!(${overlay})?.findOne('.assistant-staircase')`, 10_000)
  assert.deepEqual(await browser.evaluate(topology), before)
  await click('.design-assistant-actions button', 'Apply layout')
  await browser.wait('assistantPlanProps().floors[1].rooms.some(room => room.name === "Family bathroom")')
  assert.ok(await browser.evaluate('assistantPlanProps().floors[0].rooms.some(room => room.name === "Kitchen diner")'))
  assert.equal(await browser.evaluate('assistantPlanProps().floors[0].models.filter(model => model.modelId.includes("stairs") || model.modelId.endsWith("-stair-variety")).length'), 1)
  await browser.evaluate(`(() => {
    const floor = document.querySelector('select[aria-label="3D visible floors"]')
    floor.value = 'upper'
    floor.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await browser.wait(`!!assistantThree().scene.getObjectByName('open-stairwell-guardrails')?.getObjectByName('stair-handrails')`, 10_000)
  assert.equal(await browser.evaluate(`assistantThree().scene.getObjectByName('open-stairwell-guardrails').position.y`), 2.7)
  assert.equal(await browser.evaluate(`!!document.querySelector('.assistant-preview-floors')`), false)
  await browser.evaluate(`(() => {
    const floor = document.querySelector('select[aria-label="3D visible floors"]')
    floor.value = 'all'
    floor.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await click('button[aria-label="Undo"]')
  await browser.wait('!assistantPlanProps().floors[1].rooms.some(room => room.name === "Family bathroom")')
  assert.deepEqual(await browser.evaluate(topology), before)
  const footprintsBeforeIntegrated = await browser.evaluate(footprints)
  const requestsBeforeIntegrated = agentRequests
  await send(integratedBrief)
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.ok(await browser.evaluate('!!assistantPlanProps().assistantPreview?.proposal.extensionBasis'),
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  assert.equal(agentRequests, requestsBeforeIntegrated + 1)
  assert.deepEqual(await browser.evaluate(topology), before)
  assert.deepEqual(await browser.evaluate(footprints), footprintsBeforeIntegrated)
  await send(timeoutBrief)
  await browser.wait(`document.querySelector('.design-assistant-messages').textContent.includes('OpenAI did not finish its reply')`, 10_000)
  await click('.design-assistant-send button', 'Retry request')
  await browser.wait(`document.querySelector('.design-assistant-messages').textContent.includes('I received your original brief again.')`, 10_000)
  assert.equal(retryAttempts.length, 2)
  assert.deepEqual(retryAttempts[1], retryAttempts[0])
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.design-assistant-message.user')].filter(message => message.textContent === ${JSON.stringify(timeoutBrief)}).length`), 1)
  assert.equal(await browser.evaluate('assistantPlanProps().assistantPreview.previewFloors.length'), 2)
  assert.ok(await browser.evaluate('assistantPlanProps().assistantPreview.previewFloors.every(floor => floor.floorFootprints.length && floor.rooms.some(room => room.function === "landing"))'))
  await click('.design-assistant-actions button', 'Apply design')
  await browser.wait('assistantPlanProps().floors[1].rooms.some(room => room.name === "Family bathroom")')
  assert.ok((await browser.evaluate(footprints)).every(floor => floor?.length))
  await click('button[aria-label="Undo"]')
  await browser.wait('!assistantPlanProps().floors[1].rooms.some(room => room.name === "Family bathroom")')
  assert.deepEqual(await browser.evaluate(topology), before)
  assert.deepEqual(await browser.evaluate(footprints), footprintsBeforeIntegrated)
  await browser.call('Fetch.disable')
  console.log('Agent service streamed inspection and previews. Draft revision, apply, undo, concurrent edits and cancel passed.', tools)

  await browser.call('Page.navigate', { url: `${url}?springfield` })
  await browser.wait(ready, 120_000)
  const house = await browser.evaluate(`assistantPlanProps().floors.map(f => ({wallCount:f.walls.length,modelCount:f.models.length}))`)
  assert.ok(house.length >= 2 && house.reduce((n, f) => n + f.modelCount, 0) >= 20, JSON.stringify(house))
  await browser.wait(`assistantThree().gl.info.render.triangles > 0 && !assistantThree().scene.userData.shaderWarmupPending &&
    !document.querySelector('.viewport-preparing-overlay')`, 120_000)
  await click('button[aria-label="3D view menu"]')
  assert.equal(await browser.evaluate(`document.querySelector('select[aria-label="Lighting mode"]').value`), 'design')
  await click('input[aria-label="Head height"]')
  await click('button[aria-label="3D view menu"]')
  await openDemo()
  await pause(600)
  await browser.evaluate(`window.agentFrameAudit = { frames: [], watching: true, gi: false, warmup: false,
    beforeCompile: assistantThree().gl.getContext().__rendererAudit.compileCalls,
    camera: assistantThree().camera.position.clone() };
    requestAnimationFrame(function auditFrame(time) {
      const audit = agentFrameAudit, current = assistantThree().scene.userData;
      if (!audit.watching) return;
      audit.frames.push(time); audit.gi ||= !!current.indirectLighting?.preparing;
      audit.warmup ||= !!current.shaderWarmupPending; requestAnimationFrame(auditFrame);
    });`)
  await send('Design three bedrooms, a good-sized bathroom and an airy landing upstairs.')
  await browser.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await pause(560)
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  const report = await browser.evaluate(`(() => {
    const audit = agentFrameAudit; audit.watching = false;
    const frames = audit.frames;
    return { frames: frames.length, frameSpanMs: frames.at(-1) - frames[0], maxFrameGapMs: Math.max(0,...frames.slice(1).map((time,i) => time - frames[i])),
      cameraMetres: assistantThree().camera.position.distanceTo(audit.camera),
      shaderCompiles: assistantThree().gl.getContext().__rendererAudit.compileCalls - audit.beforeCompile,
      giPreparing: audit.gi, shaderWarmup: audit.warmup,
      toolCalls: document.querySelectorAll('.design-agent-diagnostics details').length };
  })()`)
  assert.ok(report.frames >= 3 && report.cameraMetres > 0.02 && report.toolCalls > 0, JSON.stringify(report))
  assert.equal(report.giPreparing, false)
  assert.equal(report.shaderWarmup, false)
  assert.equal(report.shaderCompiles, 0)
  console.log('Springfield Design Mode while the agent inspected the house', { house, ...report })
} finally { browser.close() }
