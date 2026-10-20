// Start Vite on 5180, build a viewer, then: node tests/browser/readOnlyViewerRegression.mjs
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { checkViewerTouch } from './viewerTouchRegression.mjs'
import { checkViewerRendering } from './viewerRenderingRegression.mjs'

const dist = resolve('dist-viewer')
const prefix = '/house-designer/another-house/'
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' }
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return }
    const path = resolve(dist, pathname.slice(prefix.length) || 'index.html')
    const suffix = relative(dist, path)
    if (suffix === '..' || suffix.startsWith(`..${sep}`)) { response.writeHead(403).end(); return }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' })
    response.end(readFileSync(path))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const productionUrl = process.env.VIEWER_TEST_URL ?? `http://127.0.0.1:${server.address().port}${prefix}`
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
  `--user-data-dir=${createBrowserTestProfile('house-viewer-test-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  const errors = [], assetFailures = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) {
      pending.delete(message.id)
      message.error ? request.reject(message.error) : request.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.args.some(arg=>String(arg.value??'').includes('Saved GI'))) console.log('Saved GI diagnostic',message.params.args.map(arg=>arg.value??arg.description).join(' '))
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400 && !message.params.response.url.endsWith('/favicon.ico')) assetFailures.push(message.params.response.url)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 30000)
    pending.set(++id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (expression, label, attempts = 160) => {
    for (let index = 0; index < attempts; index++) {
      if (await evaluate(expression)) return
      await pause(250)
    }
    throw new Error(`Timed out: ${label}. Status: ${await evaluate("document.querySelector('.viewer-status')?.textContent")}. ${JSON.stringify(errors)}`)
  }
  const key = (code, pressed) => call('Input.dispatchKeyEvent', { type: pressed ? 'keyDown' : 'keyUp', code, key: code.replace('Key', '').toLowerCase() })
  const move = async code => { await key(code, true); await pause(250); await key(code, false); await pause(100) }
  const camera = () => evaluate(`window.viewerState().camera.position.toArray()`)
  const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled button');b.click()})()`)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  if(process.argv.includes('--rendering-only')) {
    await checkViewerRendering({ call, evaluate, pause, waitFor })
    assert.deepEqual(errors, [])
  } else if(!process.argv.includes('--built-only')) {
  if (process.argv.includes('--touch-only')) {
    await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  // Control-only checks exercise the real geometry/camera without baking new
  // lighting in SwiftShader. The compiled-package checks below cover saved GI.
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html' + (process.argv.includes('--controls-only') ? '?basic-scene' : '') })
  await waitFor(process.argv.includes('--controls-only')
    ? `!!window.viewerState?.() && window.basicSceneReport?.gpuCompleteMs !== undefined`
    : `!!window.viewerState?.() && document.querySelector('.viewer-status')?.textContent==='Scene ready.'`, 'fixture ready', 400)
  // Software rendering must leave enough time for input frames; the controls
  // use CSS coordinates, independent of the WebGL drawing-buffer resolution.
  await evaluate('window.viewerState().setDpr(0.5)')
  await pause(1000)
  if (process.argv.includes('--touch-only')) {
    assert.ok(await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return r.top===0&&Math.abs(r.height-visualViewport.height)<2})()`), 'cold landscape launch fills the viewport before any rotation')
    writeFileSync('node_modules/.cache/viewer-cold-landscape.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  if (!process.argv.includes('--touch-only')) {
  const normalFov = await evaluate('window.viewerState().camera.fov')
  for (const label of ['Wide aspect', 'Super-wide aspect', 'Normal aspect']) {
    await evaluate(`document.querySelector('[aria-label="${label}"]').click()`)
    await pause(150)
    assert.equal(await evaluate(`document.querySelector('[aria-label="${label}"]').getAttribute('aria-pressed')`), 'true')
    const fov = await evaluate('window.viewerState().camera.fov')
    assert.ok(label === 'Normal aspect' ? fov === normalFov : fov > normalFov, 'aspect button changes the actual camera field of view')
  }
  assert.equal(await evaluate(`document.querySelectorAll('canvas').length`), 1)
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="3D transform mode"],.light-gimbal,.viewport-indicators,.render-options-menu')`), false)
  assert.equal(await evaluate(`!!document.querySelector('.webxr-enter-button')`), true)
  await evaluate(`(()=>{const c=window.viewerState().camera;c.rotation.order='YXZ';c.rotation.set(0.6,0,0);c.updateMatrixWorld()})()`)
  await move('KeyW')
  const walked = await camera()
  assert.ok(walked[2] < 7, 'W moves forward')
  assert.equal(walked[1], 1.8, 'walk stays at head height while looking up')
  await move('KeyA')
  assert.ok((await camera())[0] < walked[0], 'A moves sideways')
  await move('KeyE')
  assert.equal((await camera())[1], 1.8, 'walk ignores flight keys')
  await click('Fly'); await pause(200)
  const beforeFlight = await camera()
  await move('KeyW')
  assert.ok((await camera())[1] > beforeFlight[1], 'flight follows upward view direction')
  const beforeDescent = await camera()
  await move('KeyQ')
  assert.ok((await camera())[1] < beforeDescent[1], 'Q descends')
  await move('KeyE')
  await click('Walk'); await pause(200)
  assert.equal((await camera())[1], 1.8, 'switching back to Walk snaps to floor head height even without movement')
  const viewport = await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  const beforeLook = await evaluate(`window.viewerState().camera.quaternion.toArray()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...viewport, button: 'left', buttons: 1, clickCount: 1 })
  // A real drag supplies several events; the first can intentionally resync
  // after a slow shader frame instead of rotating from stale pointer input.
  for (let step = 1; step <= 5; step++) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: viewport.x + 20 * step, y: viewport.y + 5 * step, button: 'left', buttons: 1 })
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: viewport.x + 100, y: viewport.y + 25, button: 'left', buttons: 0, clickCount: 1 })
  assert.notDeepEqual(await evaluate(`window.viewerState().camera.quaternion.toArray()`), beforeLook, 'left drag changes the view')
  assert.equal(await evaluate(`(()=>{let found=false;window.viewerState().scene.traverse(o=>{if(o.constructor.name.includes('TransformControls'))found=true});return found})()`), false)
  await evaluate(`(()=>{const t=window.viewerTransitions()[0],c=window.viewerState().camera;c.position.set(t.from.x,1.8,t.from.y-1);c.lookAt(t.from.x,1.2,t.from.y);c.updateMatrixWorld()})()`)
  await pause(400)
  const stairButton = await evaluate(`(()=>{const b=document.querySelector('.viewer-stair-button');if(!b)throw Error('No stair button');const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b}})()`)
  writeFileSync('.tmp-viewer-stairs.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  assert.equal(stairButton.hit, true, 'stair button is visible and clickable in the 3D view')
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: stairButton.x, y: stairButton.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stairButton.x, y: stairButton.y, button: 'left', clickCount: 1 })
  await waitFor(`document.querySelector('[aria-label="Current floor"]').textContent==='First floor'`, 'upstairs stair button')
  await pause(150)
  assert.ok(Math.abs((await camera())[1] - 4.5) < 1e-8)
  const destination = await evaluate(`window.viewerTransitions()[0].to`)
  assert.ok(Math.abs((await camera())[0] - destination.x) < 1e-8)
  assert.ok(Math.abs((await camera())[2] - destination.y) < 1e-8)
  await click('Downstairs'); await pause(200)
  assert.equal((await camera())[1], 1.8)
  await key('KeyW', true); await pause(100)
  await evaluate(`window.dispatchEvent(new Event('blur'))`)
  const afterBlur = await camera(); await pause(250)
  assert.deepEqual(await camera(), afterBlur, 'blur clears held movement keys')
  await key('KeyW', false)
  await click('Reset view'); await pause(200)
  assert.deepEqual(await camera(), [4, 1.8, 7])
  await evaluate(`(()=>{
    window.testPad={connected:true,mapping:'standard',axes:[0,0,0,0]};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[null,window.testPad]});
  })()`)
  const stick = async axes => {
    await evaluate(`window.testPad.axes=${JSON.stringify(axes)}`)
    await pause(350)
    await evaluate('window.testPad.axes=[0,0,0,0]')
    await pause(100)
  }
  await stick([0, -1, 0, 0])
  const controllerWalk = await camera()
  assert.ok(controllerWalk[2] < 6.9, 'left stick walks forward through the mounted controls')
  assert.equal(controllerWalk[1], 1.8)
  await stick([1, 0, 0, 0])
  assert.ok((await camera())[0] > controllerWalk[0], 'left stick strafes right')
  const controllerLook = await evaluate('window.viewerState().camera.rotation.y')
  await stick([0, 0, 1, -1])
  assert.ok(await evaluate('window.viewerState().camera.rotation.y') < controllerLook, 'right stick looks right')
  assert.ok(await evaluate('window.viewerState().camera.rotation.x') > 0, 'right stick looks up')
  await click('Fly'); await pause(150)
  const controllerFlight = await camera()
  await stick([0, -1, 0, 0])
  assert.ok((await camera())[1] > controllerFlight[1], 'controller flight follows camera pitch')
  await click('Walk'); await pause(150)
  await waitFor('window.viewerState().camera.position.y===1.8', 'walk head height restored')
  const neutral = await camera()
  await stick([.05, -.05, 0, 0])
  assert.deepEqual(await camera(), neutral, 'stick drift does not move the camera')
  await evaluate(`(()=>{const input=document.createElement('input');input.id='controller-focus-test';document.body.append(input);input.focus()})()`)
  await stick([0, -1, 0, 0])
  assert.deepEqual(await camera(), neutral, 'controller pauses while typing')
  await evaluate(`document.getElementById('controller-focus-test').remove();window.originalHasFocus=document.hasFocus;document.hasFocus=()=>false`)
  await stick([0, -1, 0, 0])
  assert.deepEqual(await camera(), neutral, 'controller pauses when the page loses focus')
  await evaluate('document.hasFocus=window.originalHasFocus;window.testPad.connected=false')
  await stick([0, -1, 0, 0])
  assert.deepEqual(await camera(), neutral, 'disconnecting immediately stops controller input')
  await evaluate(`Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{throw new DOMException('Blocked','SecurityError')}})`)
  await pause(150)
  assert.deepEqual(await camera(), neutral, 'denied gamepad access leaves the viewer usable')
  await evaluate('delete navigator.getGamepads;delete document.hasFocus')
  await click('Reset view'); await pause(150)
  assert.equal(await evaluate(`window.viewerHouseUnchanged()`), true)
  assert.deepEqual(errors, [])
  writeFileSync('.tmp-viewer-controls.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS: Walk, Fly, mouse look, Xbox sticks, input guards, stairs, floor head height, reset, input cleanup, and read-only controls.')
  }
  await checkViewerTouch({ call, evaluate, pause, waitFor })
  }

  // Run the compiled package from a different nested URL, with no portal server.
  if (!process.argv.includes('--controls-only') && !process.argv.includes('--rendering-only')) {
  assetFailures.length = 0
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.giWorkerCreations=0;window.bakedGIShown=false;
    const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);if(String(url).includes('indirectLighting.worker'))window.giWorkerCreations++}};
    const names=new WeakMap(),proto=WebGL2RenderingContext.prototype,get=proto.getUniformLocation,set=proto.uniform1f;
    proto.getUniformLocation=function(program,name){const location=get.call(this,program,name);if(location)names.set(location,name);return location};
    proto.uniform1f=function(location,value){if(names.get(location)==='hdGIUseVolume'&&value===1)window.bakedGIShown=true;return set.call(this,location,value)};
  `})
  await call('Page.navigate', { url: productionUrl })
  await waitFor(`!!document.querySelector('[aria-label="House viewer controls"]') && document.querySelector('.viewer-status')?.textContent==='Scene ready.'`, 'published house ready', 480)
  assert.equal(await evaluate(`document.querySelectorAll('canvas').length`), 1)
  assert.ok(await evaluate(`document.querySelector('.viewer-title strong').textContent.length>0`))
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="3D transform mode"],.light-gimbal,.floorplan-toolbar')`), false)
  assert.deepEqual(assetFailures, [], 'nested viewer has no missing house assets')
  assert.deepEqual(await evaluate(`(window.houseDesignerEngineLog?.entries??[]).filter(e=>['model-load-failed','texture-load-failed','texture-preload-failed'].includes(e.type))`), [], 'published textures and models decode successfully')
  assert.deepEqual(errors, [])
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="3D aspect"] button').length`), 3)
  const checkStatusLayout = () => evaluate(`(()=>{
    const status=document.querySelector('.viewer-status').getBoundingClientRect();
    const others=['.viewer-toolbar','.viewer-help','.webxr-enter-button'].map(s=>document.querySelector(s).getBoundingClientRect());
    return status.bottom<=innerHeight && status.left>=0 && status.right<=innerWidth && others.every(r=>r.bottom<=status.top);
  })()`)
  assert.ok(await checkStatusLayout(), 'bottom status is visible below the title, help and VR controls')
  if(JSON.parse(readFileSync(join(dist,'house.json'),'utf8')).project.indirectLighting){
    await waitFor('window.bakedGIShown','published house displays saved GI')
    assert.equal(await evaluate('window.giWorkerCreations'),0,'compiled client displays baked GI without a GI worker')
    console.log('PASS: Compiled client loads and displays the saved lighting without calculating GI.')
  }
  writeFileSync('.tmp-viewer-published.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await pause(300)
  assert.ok(await checkStatusLayout(), 'status remains unobscured on a narrow display')
  writeFileSync('.tmp-viewer-narrow.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS: Aspect controls and unobscured scene status on desktop and narrow displays.')
  console.log('PASS: Compiled house loads with its assets at a reusable nested website path, without the asset portal.')
  }
} finally {
  ws?.close()
  child.kill()
  server.close()
}
