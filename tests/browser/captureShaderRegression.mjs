// With Vite running: node tests/browser/captureShaderRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('capture-shaders-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id)
    if (request) { pending.delete(result.id); result.error ? request.reject(result.error) : request.resolve(result.result) }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.navigate',{url:'http://127.0.0.1:'+(process.argv[2]??5180)+'/tests/browser/captureShaderRegression.html'})
  for(let i=0;i<600;i++){await pause(100);if(await evaluate('!!window.captureShaderRegression'))break;if(errors.length)throw Error(JSON.stringify(errors))}
  const result=await evaluate('window.captureShaderRegression');console.log(JSON.stringify(result));
  assert.ok(result.activeSamplers.length>8,'stress case exercises material, GI and sun samplers');
  assert.ok(!result.activeSamplers.some(name=>['hdRoomLightMask','hdRoomLightBoundaries','hdLightPortals','hdLightPortalEdges'].includes(name)),'capture must not retain disabled room/portal samplers');
  assert.deepEqual(errors,[]);console.log('PASS: capture sampler stress material links without room/portal texture overhead')
}finally{ws?.close();child.kill()}
