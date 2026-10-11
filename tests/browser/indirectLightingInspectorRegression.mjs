// With Vite running: node --experimental-strip-types tests/browser/indirectLightingInspectorRegression.mjs [port]
// Checks GI point inspection and picking in the actual editor without invalidating lighting.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const floor = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
  models: [], rooms: [], roofs: [], walls: [
    ['south', 0, 0, 8, 0], ['east', 8, 0, 8, 4], ['north', 8, 4, 0, 4], ['west', 0, 4, 0, 0], ['partition', 4, 0, 4, 4],
  ].map(([id, x, y, ex, ey]) => ({ id, start: { x, y }, end: { x: ex, y: ey }, height: 2.4, thickness: .2, kind: 'external', openings: [] })) }
const upper = { ...structuredClone(floor), id: 'first', name: 'First', elevation: 2.6,
  walls: floor.walls.filter(wall => wall.id !== 'partition') }
floor.models.push({ id: 'bed', modelId: 'king-bed', position: { x: 2, y: 2 }, rotation: 0, scale: 1, widthScale: 1, depthScale: 1 },
  { id: 'lamp', modelId: 'point-light', position: { x: .6, y: 2 }, height: 1.8, rotation: 0, lightEnabled: true,
    lightColor: '#fff3c4', lightPower: 120, lightDistance: 10, lightFalloff: 1.15 })
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
    performance.setResourceTimingBufferSize(4000);window.probeCubeSizes=[];window.testAlerts=[];
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
  const projectAction = async name => {
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await wait(`!!document.querySelector('.project-menu-dropdown')`, 'project menu opened')
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(e=>e.textContent.trim()==='${name}').click()`)
  }
  const ready = label => wait(`window.probeScene()?.userData.indirectLighting?.state==='ready'&&!!window.probeScene().userData.getBakedIndirectLighting?.()`, label)
  await ready('baseline ready')

  const baseline=await evaluate('({...window.probeScene().userData.indirectLighting})')
  assert.ok(baseline.floorProbes>0,'raised bed receives underside captures')
  await viewMenu()
  await evaluate('[...document.querySelectorAll("label")].find(e=>e.textContent.trim()==="Inspect GI point").querySelector("input").click()')
  await viewMenu()
  await wait('!!window.probeScene().userData.inspectIndirectPoint','inspector armed')
  await evaluate('window.probeScene().userData.inspectIndirectPoint([6,.018,2],[0,1,0])')
  await wait('!!window.probeScene().userData.indirectPointInspection','report ready')
  const report=await evaluate('window.probeScene().userData.indirectPointInspection')
  assert.equal(report.floorId,'ground');assert.equal(report.bias,.004);assert.equal(report.floorLayer,true)
  assert.ok(report.probes.length>0);assert.ok(report.probes.every(p=>p.finalRGB.length===3))
  assert.ok(await evaluate('!!document.querySelector(\'[aria-label="GI point inspection"]\')'))
  const target=await evaluate('(async()=>{const url=performance.getEntriesByType("resource").find(e=>e.name.includes("/@react-three_fiber.js"))?.name;const {_roots}=await import(url);const r=[..._roots.values()].map(r=>r.store.getState()).find(r=>r.scene===window.probeScene());r.camera.position.set(6,1.6,3.4);r.camera.lookAt(6,.02,2);r.camera.updateMatrixWorld();r.invalidate();window.inspectRoot=r;const rect=r.gl.domElement.getBoundingClientRect();return {x:rect.right-35,y:rect.top+rect.height*.75}})()')
  await new Promise(r=>setTimeout(r,500))
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1})
  await wait('document.querySelector(\'[aria-label="GI point inspection"]\')?.getAttribute("aria-busy")==="false"&&window.probeScene().userData.indirectPointInspection?.point[0]!==6','picked surface report')
  const picked=await evaluate('window.probeScene().userData.indirectPointInspection')
  const panelBounds=await evaluate('(()=>{const e=document.querySelector(\'[aria-label="GI point inspection"]\');const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,visible:checkVisibility?e.checkVisibility():getComputedStyle(e).display!=="none"}})()'.replace('checkVisibility?','"checkVisibility" in e?'))
  assert.ok(panelBounds.visible&&panelBounds.left>=0&&panelBounds.top>=0&&panelBounds.right<=1200&&panelBounds.bottom<=1050,'panel remains visible after camera movement')

  assert.ok(picked.normal[1]>.99,'floor normal is upward')
  await evaluate('(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==="application/json")window.inspectionBlob=blob;return original.call(this,blob)};[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Download report").click()})()')
  const downloaded=JSON.parse(await evaluate('window.inspectionBlob.text()'))
  assert.deepEqual(downloaded.point,picked.point)
  writeFileSync('.tmp-gi-point-inspection.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate('window.probeScene().userData.inspectIndirectPoint([100,.018,100],[0,1,0])')
  await wait('document.querySelector(\'[aria-label="GI point inspection"]\')?.textContent.includes("Choose a surface inside")','outside point rejected')
  await viewMenu()
  await evaluate('[...document.querySelectorAll("label")].find(e=>e.textContent.trim()==="Inspect GI point").querySelector("input").click()')
  await viewMenu()
  await wait('!window.probeScene().userData.inspectIndirectPoint&&!document.querySelector(\'[aria-label="GI point inspection"]\')','inspector removed')
  const after=await evaluate('window.probeScene().userData.indirectLighting')
  assert.equal(after.generation,baseline.generation);assert.equal(after.capturedFaces,baseline.capturedFaces)

  await projectAction('Save')
  startupProject=JSON.parse(await evaluate('window.savedProjectText'))
  assert.ok(startupProject.indirectLighting,'completed bake saved')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.inspectionReloaded=true'})
  await call('Page.reload',{ignoreCache:true})
  await wait('window.inspectionReloaded&&!!document.querySelector(\'[aria-label="3D view menu"]\')&&performance.getEntriesByType("resource").some(e=>e.name.includes("/@react-three_fiber.js"))','fresh editor')
  await evaluate('(async()=>{const url=performance.getEntriesByType("resource").find(e=>e.name.includes("/@react-three_fiber.js"))?.name;const {_roots}=await import(url);window.probeScene=()=>[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.userData.getBakedIndirectLighting)})()')
  await wait('window.probeScene()?.userData.indirectLighting?.source==="saved"&&window.probeScene().userData.indirectLighting.state==="ready"','restored lighting')
  const savedBaseline=await evaluate('({...window.probeScene().userData.indirectLighting})')
  await viewMenu()
  await evaluate('[...document.querySelectorAll("label")].find(e=>e.textContent.trim()==="Inspect GI point").querySelector("input").click()')
  await viewMenu()
  await wait('!!window.probeScene().userData.inspectIndirectPoint','saved inspector armed')
  await evaluate('window.probeScene().userData.inspectIndirectPoint([6,.018,2],[0,1,0])')
  await wait('!!window.probeScene().userData.indirectPointInspection','saved inspection ready')
  const savedReport=await evaluate('window.probeScene().userData.indirectPointInspection')
  assert.deepEqual(savedReport.displayed,report.displayed);assert.deepEqual(savedReport.exactAtSurface,report.exactAtSurface)
  assert.equal(await evaluate('window.probeScene().userData.indirectLighting.generation'),savedBaseline.generation)
  assert.equal(await evaluate('window.probeScene().userData.indirectLighting.capturedFaces'),0)

  await projectAction('Save')
  startupProject=JSON.parse(await evaluate('window.savedProjectText'))
  startupProject.indirectLighting.floorLayer.version = 1
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.legacyFloorReloaded=true'})
  await call('Page.reload',{ignoreCache:true})
  await wait('window.legacyFloorReloaded&&!!document.querySelector(\'[aria-label="3D view menu"]\')&&performance.getEntriesByType("resource").some(e=>e.name.includes("/@react-three_fiber.js"))','legacy floor editor')
  await evaluate('(async()=>{const url=performance.getEntriesByType("resource").find(e=>e.name.includes("/@react-three_fiber.js"))?.name;const {_roots}=await import(url);window.probeScene=()=>[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.userData.getBakedIndirectLighting)})()')
  await wait('window.probeScene()?.userData.indirectLighting?.floorLayerReady&&window.probeScene().userData.indirectLighting.state==="ready"&&!!window.probeScene().userData.getBakedIndirectLighting?.()?.floorLayer','legacy floor upgraded')
  assert.equal(await evaluate('window.probeScene().userData.indirectLighting.capturedFaces'),0,'legacy upgrade captures no new probe faces')
  assert.equal(await evaluate('window.probeScene().userData.getBakedIndirectLighting().floorLayer.version'),2,'legacy floor layer gains bounded support')
  assert.deepEqual(startupProject.indirectLighting.coefficients,await evaluate('window.probeScene().userData.getBakedIndirectLighting().coefficients'))
  assert.deepEqual(startupProject.indirectLighting.volume,await evaluate('window.probeScene().userData.getBakedIndirectLighting().volume'))

  await projectAction('Save')
  startupProject=JSON.parse(await evaluate('window.savedProjectText'))
  delete startupProject.indirectLighting.layout.floorProbeLayoutVersion
  startupProject.indirectLighting.layout.probes=startupProject.indirectLighting.layout.probes.filter(probe=>probe.kind!=='floor')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.legacyProbeReloaded=true'})
  await call('Page.reload',{ignoreCache:true})
  await wait('window.legacyProbeReloaded&&!!document.querySelector(\'[aria-label="3D view menu"]\')&&performance.getEntriesByType("resource").some(e=>e.name.includes("/@react-three_fiber.js"))','legacy probe editor')
  await evaluate('(async()=>{const url=performance.getEntriesByType("resource").find(e=>e.name.includes("/@react-three_fiber.js"))?.name;const {_roots}=await import(url);window.probeScene=()=>[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.userData.getBakedIndirectLighting)})()')
  await wait('window.probeScene()?.userData.indirectLighting?.state==="ready"&&window.probeScene().userData.getBakedIndirectLighting?.()?.layout.floorProbeLayoutVersion===1','legacy probes upgraded')
  const upgrade=await evaluate('({...window.probeScene().userData.indirectLighting})')
  assert.ok(upgrade.partial&&upgrade.reusedProbes>0)
  assert.equal(upgrade.firstProbes,upgrade.floorProbes,'only new underside captures repeat the first pass')
  assert.ok(upgrade.capturedFaces>0&&upgrade.firstProbes<upgrade.probes)
  const floorProbe=await evaluate('window.probeScene().userData.getBakedIndirectLighting().layout.probes.find(p=>p.kind==="floor")')
  await viewMenu()
  await evaluate('[...document.querySelectorAll("label")].find(e=>e.textContent.trim()==="Inspect GI point").querySelector("input").click()')
  await viewMenu()
  await wait('!!window.probeScene().userData.inspectIndirectPoint','underside inspector armed')
  await evaluate(`window.probeScene().userData.inspectIndirectPoint([${floorProbe.position[0]},.012,${floorProbe.position[2]}],[0,1,0])`)
  await wait('!!window.probeScene().userData.indirectPointInspection','underside report ready')
  const underside=await evaluate('window.probeScene().userData.indirectPointInspection')
  assert.ok(underside.exactAtSurface.support>.1&&underside.exactAtSurface.confidence===1)
  assert.ok(underside.displayed.rgb.some(value=>value>.0001),'captured indirect light is present beneath the bed')
  assert.deepEqual(errors,[])
  console.log('PASS: point inspection, actual floor picking, persistence, old floor-cache refinement and regional underside capture upgrade',JSON.stringify({point:picked.point,bias:picked.bias,probes:picked.probes.length,upgrade,underside:underside.displayed}))
} finally {for(const timer of timers)clearTimeout(timer);ws?.close();child.kill()}
