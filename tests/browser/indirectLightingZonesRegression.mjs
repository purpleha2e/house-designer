// With Vite running: node --experimental-strip-types tests/browser/indirectLightingZonesRegression.mjs [port]
// Checks local window edits against full rebakes and persistence in the actual editor.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { DataUtils } from 'three'
import { loadIndirectLighting } from '../../src/indirectLightingPersistence.ts'

const floor = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
  models: [], rooms: [], roofs: [], walls: [
    ['south', 0, 0, 8, 0], ['east', 8, 0, 8, 4], ['north', 8, 4, 0, 4], ['west', 0, 4, 0, 0], ['partition', 4, 0, 4, 4],
  ].map(([id, x, y, ex, ey]) => ({ id, start: { x, y }, end: { x: ex, y: ey }, height: 2.4, thickness: .2, kind: 'external', openings: [] })) }
const upper = { ...structuredClone(floor), id: 'first', name: 'First', elevation: 2.6,
  walls: floor.walls.filter(wall => wall.id !== 'partition') }
const project = { activeFloorId: floor.id, floors: [floor, upper], wallKind: 'external', surfaceAssignments: [],
  sunPosition: { azimuth: 1, elevation: .78 }, threeDView: { floorViewId: 'all', diffuseProbeResolution: 4,
    camera: { position: { x: 6, y: 5, z: 8 }, quaternion: { w: 1, x: 0, y: 0, z: 0 } } } }
let startupProject = project
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1200,1050', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'probe-quality-'))}`, 'about:blank',
], { windowsHide: true })
let ws
const timers = new Set()
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  const pending = new Map(), errors = []
  let id = 0
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map(a => a.value ?? a.description).join(' ')
      if (m.params.type === 'error' || /(?:GI|Indirect).*unavailable/.test(text)) errors.push(text)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => reject(Error(`${method} timed out`)), 90000); timers.add(timer)
    pending.set(requestId, { resolve: v => { clearTimeout(timer); timers.delete(timer); resolve(v) }, reject })
    ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const wait = async (expression, label) => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return
      if (i % 50 === 0) console.log(label, await evaluate(`document.querySelector('[aria-label="3D engine status"]')?.textContent`))
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw Error(`${label}: ${JSON.stringify(errors)}`)
  }
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Fetch.enable', { patterns: [{ urlPattern: '*colin_house_v2.json*' }] })
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.method === 'Fetch.requestPaused') void call('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from('export default ' + JSON.stringify(startupProject)).toString('base64') })
  })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.probeCubeSizes=[];window.testAlerts=[];
    const upload=WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D=function(...a){if(a.length===9&&a[0]>=34069&&a[0]<=34074)window.probeCubeSizes.push(a[3]);return upload.apply(this,a)};
    window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async contents=>{window.savedProjectText=contents},close:async()=>{}})});
    window.showOpenFilePicker=async()=>[{getFile:async()=>new File([window.savedProjectText],'probe-quality.house.json',{type:'application/json'})}];
    window.alert=message=>window.testAlerts.push(message);
  ` })
  await call('Page.navigate', { url: 'http://127.0.0.1:' + (process.argv[2] ?? '5184') + '/' })
  await wait(`!!document.querySelector('[aria-label="3D view menu"]')`, 'editor mounted')
  await evaluate(`(async()=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))?.name;const {_roots}=await import(url);window.probeScene=()=>[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.userData.getBakedIndirectLighting)})()`)
  const viewMenu = () => evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  const quality = async index => {
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="Diffuse probe resolution"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${index}');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('[aria-label="Diffuse probe resolution"]').getAttribute('aria-valuetext').startsWith('${[4, 8, 16][index]} by')`, 'slider changed')
  }
  const projectAction = async name => {
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await wait(`!!document.querySelector('.project-menu-dropdown')`, 'project menu opened')
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(e=>e.textContent.trim()==='${name}').click()`)
  }
  const ready = label => wait(`window.probeScene()?.userData.indirectLighting?.state==='ready'&&!!window.probeScene().userData.getBakedIndirectLighting?.()`, label)
  await ready('baseline ready')
  await projectAction('Save')
  const original = JSON.parse(await evaluate('window.savedProjectText'))
  assert.equal(original.indirectLighting.directCoefficients.length, 3)
  const edited = structuredClone(original)
  edited.floors[0].models.push({ id: 'test-window', modelId: 'window', position: { x: 2, y: 0 }, rotation: 0, scale: 1,
    wallAttachment: { wallId: 'south', offset: 2 }, wallOpeningBottom: .8 })
  await evaluate(`window.savedProjectText=${JSON.stringify(JSON.stringify(edited))}`)
  await projectAction('Load')
  await wait(`window.probeScene()?.userData.indirectLighting?.source==='baked'&&!window.probeScene().userData.getBakedIndirectLighting?.()`, 'window invalidates lighting')
  await ready('local window bake ready')
  const status = await evaluate('window.probeScene().userData.indirectLighting')
  console.log('WINDOW UPDATE', JSON.stringify(status))
  assert.equal(status.partial, true)
  assert.ok(status.firstProbes < status.probes && status.secondProbes < status.probes)
  assert.ok(status.reusedProbes > 0)
  assert.equal(status.capturedFaces, 6 * (status.firstProbes + status.secondProbes + status.zones))
  await projectAction('Save')
  const partial = JSON.parse(await evaluate('window.savedProjectText'))
  const oldLight = await loadIndirectLighting(original.indirectLighting), localLight = await loadIndirectLighting(partial.indirectLighting)
  let retained = 0
  for (const probe of localLight.field.probes) if (probe.region.floorId === 'first' || probe.position.x > 4) {
    localLight.field.coefficients.forEach((data, colour) => assert.deepEqual(data.subarray(probe.index * 4, probe.index * 4 + 4),
      oldLight.field.coefficients[colour].subarray(probe.index * 4, probe.index * 4 + 4), 'unaffected final irradiance stays bit-identical'))
    retained++
  }
  assert.ok(retained > 0)
  // A quality change and reversal forces a full reference bake at the same quality.
  await viewMenu(); await quality(1); await quality(0); await viewMenu()
  await wait(`!window.probeScene().userData.getBakedIndirectLighting?.()`, 'full reference starts')
  await ready('full reference ready')
  assert.equal(await evaluate('window.probeScene().userData.indirectLighting.partial'), false)
  await projectAction('Save')
  const fullProject = JSON.parse(await evaluate('window.savedProjectText')), fullLight = await loadIndirectLighting(fullProject.indirectLighting)
  let maxDifference = 0
  for (const probe of localLight.field.probes) localLight.field.coefficients.forEach((data, colour) => {
    for (let c = 0; c < 4; c++) maxDifference = Math.max(maxDifference,
      Math.abs(DataUtils.fromHalfFloat(data[probe.index * 4 + c]) - DataUtils.fromHalfFloat(fullLight.field.coefficients[colour][probe.index * 4 + c])))
  })
  assert.ok(maxDifference < .01, `regional and full irradiance agree: ${maxDifference}`)
  // Persisted first-pass data supports a local update in a fresh editor instance.
  startupProject = fullProject
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.zoneReloaded=true' })
  await call('Page.reload', { ignoreCache: true })
  await wait(`window.zoneReloaded&&!!document.querySelector('[aria-label="3D view menu"]')&&performance.getEntriesByType('resource').some(e=>e.name.includes('/@react-three_fiber.js'))`, 'fresh editor mounted')
  await evaluate(`(async()=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))?.name;const {_roots}=await import(url);window.probeScene=()=>[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.userData.getBakedIndirectLighting)})()`)
  await wait(`window.probeScene()?.userData.indirectLighting?.source==='saved'&&window.probeScene().userData.indirectLighting.state==='ready'`, 'saved baseline restored')
  const moved = structuredClone(fullProject)
  moved.floors[0].models[0].wallAttachment.offset = 2.5
  moved.floors[0].models[0].position.x = 2.5
  await evaluate(`window.savedProjectText=${JSON.stringify(JSON.stringify(moved))}`)
  await projectAction('Load')
  await wait(`!window.probeScene().userData.getBakedIndirectLighting?.()`, 'moved window starts')
  await wait(`['preparing','refining'].includes(window.probeScene().userData.indirectLighting.state)`, 'first local update in progress')
  const interruptedGeneration = await evaluate('window.probeScene().userData.indirectLighting.generation')
  const finalMove = structuredClone(fullProject)
  finalMove.floors[0].models[0].wallAttachment.offset = 3
  finalMove.floors[0].models[0].position.x = 3
  await evaluate(`window.savedProjectText=${JSON.stringify(JSON.stringify(finalMove))}`)
  await projectAction('Load')
  await wait(`window.probeScene().userData.indirectLighting.generation>${interruptedGeneration}`, 'obsolete local update cancelled')
  await ready('local update after reload ready')
  assert.equal(await evaluate('window.probeScene().userData.indirectLighting.partial'), true)
  await projectAction('Save')
  assert.equal(JSON.parse(await evaluate('window.savedProjectText')).floors[0].models[0].wallAttachment.offset, 3)
  oldLight.field.dispose(); localLight.field.dispose(); fullLight.field.dispose()
  oldLight.reflections.forEach(r => r.dispose()); localLight.reflections.forEach(r => r.dispose()); fullLight.reflections.forEach(r => r.dispose())
  assert.deepEqual(await evaluate('window.testAlerts'), [])
  assert.deepEqual(errors, [])
  writeFileSync('.tmp-indirect-zone-update.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS:', JSON.stringify({ probes: status.probes, first: status.firstProbes, second: status.secondProbes, reused: retained, maxDifference }))
} finally { for (const timer of timers) clearTimeout(timer); ws?.close(); child.kill() }
