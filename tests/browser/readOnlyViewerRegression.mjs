// Start Vite on 5180, build a viewer, then: node tests/browser/readOnlyViewerRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve, sep } from 'node:path'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'

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
const productionUrl = `http://127.0.0.1:${server.address().port}${prefix}`
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'house-viewer-test-'))}`, 'about:blank',
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
    throw new Error(`Timed out: ${label}. ${JSON.stringify(errors)}`)
  }
  const key = (code, pressed) => call('Input.dispatchKeyEvent', { type: pressed ? 'keyDown' : 'keyUp', code, key: code.replace('Key', '').toLowerCase() })
  const move = async code => { await key(code, true); await pause(250); await key(code, false); await pause(100) }
  const camera = () => evaluate(`window.viewerState().camera.position.toArray()`)
  const click = label => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled button');b.click()})()`)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html' })
  await waitFor(`!!window.viewerState?.() && !document.querySelector('.viewport-preparing-overlay')`, 'fixture ready')
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
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: viewport.x + 100, y: viewport.y + 25, button: 'left', buttons: 1 })
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
  assert.equal(await evaluate(`window.viewerHouseUnchanged()`), true)
  assert.deepEqual(errors, [])
  writeFileSync('.tmp-viewer-controls.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS: Walk, Fly, mouse look, stairs, floor head height, reset, input cleanup, and read-only controls.')

  // Run the compiled package from a different nested URL, with no portal server.
  assetFailures.length = 0
  await call('Page.navigate', { url: productionUrl })
  await waitFor(`!!document.querySelector('[aria-label="House viewer controls"]') && !document.querySelector('.viewport-preparing-overlay')`, 'published house ready', 240)
  assert.equal(await evaluate(`document.querySelectorAll('canvas').length`), 1)
  assert.ok(await evaluate(`document.querySelector('.viewer-title strong').textContent.length>0`))
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="3D transform mode"],.light-gimbal,.floorplan-toolbar')`), false)
  assert.deepEqual(assetFailures, [], 'nested viewer has no missing house assets')
  assert.deepEqual(await evaluate(`(window.houseDesignerEngineLog?.entries??[]).filter(e=>['model-load-failed','texture-load-failed','texture-preload-failed'].includes(e.type))`), [], 'published textures and models decode successfully')
  assert.deepEqual(errors, [])
  writeFileSync('.tmp-viewer-published.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS: Compiled house loads with its assets at a reusable nested website path, without the asset portal.')
} finally {
  ws?.close()
  child.kill()
  server.close()
}
