// With Vite running: node tests/browser/diffuseProbeResolutionRegression.mjs [port]
// Exercises the real editor slider, GPU cubemap sizes, interrupted bakes and Save/Load.
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const floor = { id: 'quality', name: 'Probe quality', elevation: 0, roomHeight: 2.4, slabThickness: .2,
  models: [], rooms: [], roofs: [], walls: [
    ['south', 0, 0, 4, 0], ['east', 4, 0, 4, 4], ['north', 4, 4, 0, 4], ['west', 0, 4, 0, 0],
  ].map(([id, x, y, ex, ey]) => ({ id, start: { x, y }, end: { x: ex, y: ey }, height: 2.4, thickness: .2, kind: 'external', openings: [] })) }
const project = { activeFloorId: floor.id, floors: [floor], wallKind: 'external', surfaceAssignments: [],
  sunPosition: { azimuth: 1, elevation: .78 }, threeDView: { floorViewId: 'all', diffuseProbeResolution: 16,
    camera: { position: { x: 6, y: 5, z: 8 }, quaternion: { w: 1, x: 0, y: 0, z: 0 } } } }
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1200,1050', `--user-data-dir=${createBrowserTestProfile('probe-quality-')}`, 'about:blank',
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
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from('export default ' + JSON.stringify(project)).toString('base64') })
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
  await viewMenu()
  assert.equal(await evaluate(`document.querySelector('[aria-label="Diffuse probe resolution"]').value`), '2')
  const quality = async index => {
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="Diffuse probe resolution"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${index}');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('[aria-label="Diffuse probe resolution"]').getAttribute('aria-valuetext').startsWith('${[4, 8, 16][index]} by')`, 'slider changed')
  }
  await quality(0)
  await viewMenu()
  const projectAction = async name => {
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await wait(`!!document.querySelector('.project-menu-dropdown')`, 'project menu opened')
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(e=>e.textContent.trim()==='${name}').click()`)
  }
  await projectAction('Save')
  await wait('!!window.savedProjectText', 'early save')
  assert.equal(JSON.parse(await evaluate('window.savedProjectText')).threeDView.diffuseProbeResolution, 4)
  await wait(`window.probeScene()?.userData.indirectLighting?.state==='ready'&&!!window.probeScene().userData.getBakedIndirectLighting?.()`, '4x4 bake ready')
  assert.ok((await evaluate('window.probeCubeSizes')).includes(4), 'the GPU actually allocates 4x4 cubemap faces')
  await projectAction('Save')
  const saved = JSON.parse(await evaluate('window.savedProjectText'))
  assert.equal(saved.indirectLighting.settings.diffuseProbeResolution, 4)
  await projectAction('Load')
  await wait(`window.probeScene()?.userData.indirectLighting?.source==='saved'&&window.probeScene().userData.indirectLighting.state==='ready'`, 'saved 4x4 restored')
  await viewMenu(); await quality(1)
  await wait(`window.probeScene()?.userData.indirectLighting?.source==='baked'&&!window.probeScene().userData.getBakedIndirectLighting?.()`, 'quality change invalidates cached lighting')
  await quality(2); await quality(1)
  await wait(`window.probeScene()?.userData.indirectLighting?.state==='ready'&&window.probeScene().userData.getBakedIndirectLighting?.()?.settings.diffuseProbeResolution===8`, '8x8 interrupted bake completes')
  assert.ok((await evaluate('window.probeCubeSizes')).includes(8), 'the GPU actually allocates 8x8 cubemap faces')
  assert.deepEqual(await evaluate('window.testAlerts'), [])
  assert.deepEqual(errors, [])
  writeFileSync('.tmp-indirect-probe-quality.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS: 4x4/8x8 GPU captures, slider, interrupted rebake, early Save and baked Save/Load')
} finally { for (const timer of timers) clearTimeout(timer); ws?.close(); child.kill() }
