// Vite running: node tests/browser/giWorkerFailureRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('gi-worker-failure-')}`, 'about:blank',
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.giWorkersStarted=0;window.giFailureInputs=[];window.injectGIFailure=true;
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options){
        if(String(url).includes('indirectLighting.worker')){
          const source='import '+JSON.stringify(new URL(url,location.href).href)+';const handle=self.onmessage;self.onmessage=e=>{if(e.data.injectGIFailure)throw new Error("Injected GI coordinator failure");return handle(e)}';
          super(URL.createObjectURL(new Blob([source],{type:'text/javascript'})),options);
        } else super(url,options);
        this.isGICoordinator=String(url).includes('indirectLighting.worker');
      }
      postMessage(message,...rest){
        if(this.isGICoordinator&&message.kind==='prepare'&&window.injectGIFailure){
          window.giWorkersStarted++;
          window.giFailureInputs.push(JSON.stringify([message.floors,message.lights,message.geometry,message.obstacles]));
          return super.postMessage({...message,injectGIFailure:true},...rest);
        }
        return super.postMessage(message,...rest);
      }
    };
  ` });
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/doorMoveLatencyRegression.html` })
  const status = 'window.doorLatency?.state()?.scene.userData.indirectLighting'
  await wait(`(${status})?.state==='fallback'`)
  const first = await evaluate(`({started:giWorkersStarted,status:${status}})`)
  assert.equal(first.started, 1)
  assert.match(first.status.failureReason, /Injected GI coordinator failure/)
  await pause(2000)
  assert.equal(await evaluate('giWorkersStarted'), 1, 'unchanged failed input is not retried every frame')
  assert.equal(await evaluate(`(${status}).state`), 'fallback')
  await evaluate('doorLatency.move(2)')
  await wait(`giWorkersStarted>=2&&(${status})?.state==='fallback'&&!(${status}).blocked&&!doorLatency.state().scene.userData.shaderWarmupPending&&!doorLatency.state().scene.userData.indirectScanPending`)
  await pause(1500)
  const editAttempts=await evaluate('giWorkersStarted')
  const uniqueInputs=await evaluate('new Set(giFailureInputs).size')
  assert.equal(editAttempts,uniqueInputs,'only changed preparation inputs may start a new attempt')
  await pause(1500)
  assert.equal(await evaluate('giWorkersStarted'), editAttempts, 'settled geometry does not retry after failure')
  await evaluate('injectGIFailure=false;doorLatency.move(1.25)')
  await wait(`(${status})?.state==='ready'&&!(${status}).pendingUpdate`)
  const final = await evaluate(status)
  assert.equal(final.failureReason, undefined)
  await evaluate('window.retainedVolume=doorLatency.state().scene.userData.getIndirectUniforms().hdGIVolume.value;injectGIFailure=true;doorLatency.move(2.25)')
  await wait(`giWorkersStarted>${editAttempts}&&(${status})?.state==='fallback'&&!(${status}).blocked&&!doorLatency.state().scene.userData.shaderWarmupPending&&!doorLatency.state().scene.userData.indirectScanPending`)
  await pause(1500)
  const laterAttempts=await evaluate('giWorkersStarted')
  await pause(1500)
  assert.equal(await evaluate('giWorkersStarted'), laterAttempts)
  assert.equal(await evaluate('doorLatency.state().scene.userData.getIndirectUniforms().hdGIVolume.value===retainedVolume'), true,
    'failed replacement keeps the last completed lighting texture')
  assert.equal(await evaluate(`(${status}).displayed`), true)
  assert.equal(await evaluate('doorLatency.state().gl.getContext().getError()'), 0)
  console.log('PASS GI failures settle, edits retry, replacements recover, and completed lighting survives a later failure')
} finally { ws?.close(); browser.kill() }
