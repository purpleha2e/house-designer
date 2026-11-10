// Vite running: node tests/browser/doorMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('opening-preview-')}`, 'about:blank',
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
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/wallOpeningPreviewRegression.html`})
  await wait('!!window.openingPreviewResult')
  const result=await evaluate('openingPreviewResult')
  assert.ok(result.before.old[0]>245&&result.before.next[0]<200)
  assert.ok(result.immediate.old[0]<200&&result.immediate.next[0]>245,'both the old filled opening and new hole must update in the immediate draw')
  assert.equal(result.immediate.compiles,0,'opening edits reuse existing programs')
  assert.ok(result.final.old[0]<200&&result.final.next[0]>245)
  assert.equal(result.final.active,false)
  assert.ok(result.wallMove.oldEnd[0]>245&&result.wallMove.newEnd[0]<200&&result.wallMove.body[0]<200&&result.wallMove.hole[0]>245,'wall movement preserves both its body and openings')
  assert.ok(result.wallAdd[0]<200&&result.wallRemove[0]>245,'wall additions and removal update immediately')
  assert.equal(result.compiles,0)
  assert.equal(result.glError,0)
  assert.deepEqual(errors,[])
  console.log('PASS immediate opening pixels, zero shader compiles, and final mesh handover',JSON.stringify(result))
}finally{ws?.close();browser.kill()}
