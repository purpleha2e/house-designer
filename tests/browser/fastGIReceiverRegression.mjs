// With Vite running: node tests/browser/fastGIReceiverRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('fast-gi-receiver-')}`, 'about:blank',
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
    if (request) { pending.delete(result.id); clearTimeout(request.timer); result.error ? request.reject(result.error) : request.resolve(result.result) }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const request=++id,timer=setTimeout(()=>{pending.delete(request);reject(Error(`${method} timed out`))},30000)
    pending.set(request, { resolve, reject, timer }); ws.send(JSON.stringify({ id:request, method, params, sessionId }))
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
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/fastGIReceiverRegression.html`})
  for(let i=0;i<600;i++){await pause(100);if(await evaluate('!!window.fastGIReceiverRegression'))break;if(errors.length)throw Error(JSON.stringify(errors))}
  const result=await evaluate('window.fastGIReceiverRegression');console.log(JSON.stringify(result))
  assert.ok(result.ceilingJoin.min>.99,'constant indoor lighting cannot disappear at a padded ceiling/wall join')
  assert.ok(result.tangentGradient.min>.1&&result.tangentGradient.maxStep<.02,'lighting along the join retains a smooth spatial gradient')
  assert.equal(result.partitionDarkSide.max,0,'receiver correction cannot sample light through a partition')
  assert.ok(result.partitionLitSide.min>3.99,'the lit partition side retains its lighting')
  assert.ok(result.thinCeiling.min>.99&&result.thinCeiling.max<1.01,'receiver reconstruction cannot borrow bright unknown space above a thin ceiling')
  assert.ok(result.doorRecess.min>.3&&result.doorRecess.maxStep<.02,'a door recess must retain a continuous gradient when nearby sample support changes')
  assert.ok(result.recessBoundary.maxStep<.03,'crossing the padded boundary of a door recess cannot introduce a lighting step')
  assert.deepEqual(errors,[]);console.log('PASS: continuous receiver lighting at ceiling joins without crossing a partition')
}finally{ws?.close();child.kill()}
