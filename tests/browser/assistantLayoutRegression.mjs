import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

const port = process.argv[2] ?? '5181'
const browser = await lightingBrowser({ requestTimeout: 45_000 })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const click = (selector, label) => browser.evaluate(`(() => {
  const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => ${label ? `item.textContent.trim() === ${JSON.stringify(label)}` : 'true'});
  if (!button || button.disabled) throw new Error('Missing enabled control: ' + ${JSON.stringify(label ?? selector)}); button.click()
})()`)
const send = async text => {
  await browser.evaluate(`document.querySelector('#design-assistant-request').focus()`)
  await browser.call('Input.insertText', { text })
  await click('.design-assistant button[type=submit]')
}
const geometry = 'assistantPlanProps().floors.map(floor => ({walls:floor.walls, rooms:floor.rooms, models:floor.models}))'
const upper = 'assistantPlanProps().floors[1]'
const overlay = 'assistantPlan().findOne(".assistant-layout-preview")'
const prompt = 'Design the upstairs with three bedrooms, a bathroom and an airy landing.'

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1420, height: 950, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/assistantLayout.html` })
  await browser.wait('!!window.assistantPlanProps?.()?.floors && !!window.assistantThree?.()?.scene', 90_000)
  await browser.wait('!assistantThree().scene.userData.shaderWarmupPending && !document.querySelector(".viewport-preparing-overlay")', 90_000)
  await click('button[aria-label="3D view menu"]')
  assert.equal(await browser.evaluate(`document.querySelector('select[aria-label="Lighting mode"]').value`), 'design')
  await click('input[aria-label="Head height"]')
  await click('button[aria-label="3D view menu"]')
  const original = await browser.evaluate(geometry)
  assert.equal(original[1].walls.length, 4)
  await click('button[aria-label="Project menu"]')
  await click('.project-menu-dropdown button', 'AI Design Assistant')
  assert.equal(await browser.evaluate('!!document.querySelector(".design-assistant")'), true)
  await browser.evaluate(`window.assistantFrames = []; window.assistantTracking = true;
    requestAnimationFrame(function frame(time) { if (assistantTracking) { assistantFrames.push(time); requestAnimationFrame(frame) } });`)
  await send(prompt)
  await browser.evaluate('document.activeElement.blur(); window.assistantCameraStart = assistantThree().camera.position.clone()')
  await browser.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await pause(450)
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await browser.wait('!!document.querySelector(".design-assistant-proposal")', 30_000)
  const metrics = await browser.evaluate(`(() => { assistantTracking = false; const stamps = assistantFrames; const state = assistantThree().scene.userData;
    return { frames: stamps.length, maxGap: Math.max(0, ...stamps.slice(1).map((time, index) => time - stamps[index])),
      giPreparing: !!state.indirectLighting?.preparing, shaderPending: !!state.shaderWarmupPending,
      walked: assistantThree().camera.position.distanceTo(assistantCameraStart) } })()`)
  assert.ok(metrics.frames >= 2, JSON.stringify(metrics))
  assert.ok(metrics.walked > 0.02, JSON.stringify(metrics))
  assert.equal(metrics.giPreparing, false)
  assert.equal(metrics.shaderPending, false)
  assert.deepEqual(await browser.evaluate(geometry), original, 'preview leaves the model unchanged')
  await browser.wait(`(${overlay})?.find('.assistant-doorway').length === 4`)
  assert.equal(await browser.evaluate(`assistantPlan().findOne('.existing-plan-geometry')?.opacity()`), 0.18)
  assert.equal(await browser.evaluate(`(${overlay}).find('.assistant-retained-wall').length`), 4)
  assert.ok(await browser.evaluate(`(() => {
    const button = document.querySelector('.assistant-fit-draft')
    const rect = button.getBoundingClientRect()
    return button.contains(document.elementFromPoint(rect.left + 6, rect.top + rect.height / 2))
  })()`), 'Fit draft stays clear of the editing toolbar')
  assert.ok(await browser.evaluate(`(() => {
    const stage = assistantPlan()
    const drawing = (${overlay}).getClientRect()
    const panel = document.querySelector('.design-assistant').getBoundingClientRect()
    const clearWidth = panel.left - stage.container().getBoundingClientRect().left
    return drawing.x >= 0 && drawing.y >= 0 && drawing.x + drawing.width <= clearWidth && drawing.y + drawing.height <= stage.height()
  })()`), 'draft fits in the visible plan beside the assistant panel')
  assert.equal(await browser.evaluate('document.querySelectorAll(".design-assistant-options button").length'), 2)
  await click('.design-assistant-options button', 'Spacious landing')
  assert.equal(await browser.evaluate('document.querySelector(".design-assistant-options button[aria-pressed=true]").textContent'), 'Spacious landing')
  const bathroomArea = 'parseFloat(document.querySelectorAll(".design-assistant-metrics dd")[1].textContent)'
  const bathroomBefore = await browser.evaluate(bathroomArea)
  await send('Could you make the bathroom a little bigger?')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.ok(await browser.evaluate(bathroomArea) > bathroomBefore, await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  assert.deepEqual(await browser.evaluate(geometry), original)
  await click('.design-assistant-actions button', 'Apply layout')
  await browser.wait(`${upper}.models.length === 4 && !(${overlay})`, 30_000)
  assert.equal(await browser.evaluate(`assistantPlan().findOne('.existing-plan-geometry')?.opacity()`), 1)
  const applied = await browser.evaluate(geometry)
  assert.equal(applied[1].rooms.filter(room => room.function === 'bedroom').length, 3)
  assert.deepEqual(applied[1].walls.slice(0, 4), original[1].walls)
  await click('button[aria-label="Undo"]')
  await browser.wait(`${upper}.models.length === 0`)
  assert.deepEqual(await browser.evaluate(geometry), original, 'one undo restores the native floor')

  await send(prompt)
  await click('button[aria-label="Redo"]')
  await browser.wait('document.querySelector(".design-assistant-messages").textContent.includes("house changed")', 30_000)
  assert.equal(await browser.evaluate(`!!(${overlay})`), false)
  assert.deepEqual(await browser.evaluate(geometry), applied, 'a pending request cannot overwrite the intervening editor action')
  await pause(50)
  console.log('Assistant preview, apply, undo and concurrent edit passed.', metrics)

  await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/assistantLayout.html?red-house` })
  await browser.wait('window.assistantPlanProps?.()?.floors?.[1]?.walls.length === 13', 90_000)
  await click('button[aria-label="Project menu"]')
  await click('.project-menu-dropdown button', 'AI Design Assistant')
  await send('Design the upstairs with three bedrooms, a good-sized bathroom and an airy landing.')
  await browser.wait('!document.querySelector(".design-assistant-progress")', 30_000)
  assert.equal(await browser.evaluate('document.querySelectorAll(".design-assistant-options button").length'), 2,
    await browser.evaluate('document.querySelector(".design-assistant-messages").textContent'))
  await browser.wait(`(${overlay})?.find('.assistant-doorway').length === 4`)
  await click('.design-assistant-actions button', 'Discard')
  await browser.wait(`!(${overlay}) && assistantPlan().findOne('.existing-plan-geometry')?.opacity() === 1`)
  console.log('Saved Red House generates and previews two layouts.')
} finally { browser.close() }
