// Vite running: node tests/browser/doorMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('preview-occlusion-')}`, 'about:blank',
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
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/previewLightOcclusion.html`})
  await wait('!!window.previewOcclusionResult')
  const result=await evaluate('previewOcclusionResult')
  assert.equal(result.error,undefined)
  assert.ok(result.closed<.001,'an active lamp behind a sealed wall cannot illuminate the other room')
  assert.ok(result.open>result.closed*10+.001,'removing the wall must admit lamp illumination')
  assert.ok(result.off<.00001,'switching the lamp off must remove its contribution')
  assert.equal(result.glError,0)
  assert.deepEqual(errors,[])
  console.log('PASS preview GPU lamp shadows and light toggles without any probe atlas',JSON.stringify(result))
}finally{ws?.close();browser.kill()}
