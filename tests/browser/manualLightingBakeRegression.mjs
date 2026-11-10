// Vite running: node tests/browser/doorMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('manual-bake-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.once('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); clearTimeout(request.timer); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 60000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (expression, timeout = 180000) => {
    const end = Date.now() + timeout
    while (!await evaluate(expression)) {
      assert.deepEqual(errors, [])
      if (Date.now() > end) throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.doorLatency?.state()?.scene.userData.indirectLighting'))}`)
      await pause(50)
    }
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};
  ` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/doorMoveLatencyRegression.html?preview-lighting` })
  const status='doorLatency.state().scene.userData.indirectLighting'
  const preview=`(()=>{const u=window.doorLatency?.state()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&!u.indirectLighting.blocked&&u.fastGI.stats.state==='ready'})()`
  await wait(preview)
  assert.equal(await evaluate(`(${status}).state`),'preview')
  assert.equal(await evaluate(`(${status}).geometryBuilds??0`),0)
  const clickBake=async()=>{
    await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
    await wait(`!![...document.querySelectorAll('#three-settings-menu button')].find(b=>b.textContent==='Bake lighting')`)
    await evaluate(`[...document.querySelectorAll('#three-settings-menu button')].find(b=>b.textContent==='Bake lighting').click()`)
    await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
  }
  await clickBake()
  await wait(`(${status}).state==='ready'&&(${status}).saved&&!(${status}).saving`)
  assert.ok(await evaluate(`(${status}).capturedFaces>0`),'Bake lighting must actually produce full probe lighting')
  const baked=await evaluate(`({faces:(${status}).capturedFaces,saved:(${status}).saved})`)
  const firstPreview=await evaluate('houseDesignerFastGI.stats.revision')
  await evaluate('doorLatency.move(2)')
  await wait(`(${status}).state==='preview'&&houseDesignerFastGI.stats.revision>${firstPreview}&&${preview}`)
  assert.equal(await evaluate(`(${status}).pendingLighting`),true)
  await clickBake()
  await wait(`(${status}).preparing||(${status}).state==='refining'`)
  const secondPreview=await evaluate('houseDesignerFastGI.stats.revision')
  await evaluate('doorLatency.move(2.25)')
  await wait(`(${status}).state==='preview'&&houseDesignerFastGI.stats.revision>${secondPreview}&&${preview}`)
  const faces=await evaluate(`(${status}).capturedFaces??0`)
  await pause(1500)
  assert.equal(await evaluate(`(${status}).capturedFaces??0`),faces,'editing cancels an active manual bake')
  assert.equal(await evaluate('doorLatency.state().scene.userData.getBakedIndirectLighting?.()'),undefined,'obsolete lighting cannot be saved as current')
  assert.equal(await evaluate('doorLatency.state().gl.getContext().getError()'),0)
  assert.deepEqual(errors,[])
  console.log('PASS preview-only startup, explicit completed bake, edit invalidation, and cancellation',JSON.stringify(baked))
}finally{ws?.close();browser.kill()}
