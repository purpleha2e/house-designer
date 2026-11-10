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
  await call('Page.navigate',{url:'http://127.0.0.1:'+(process.argv[2]??5180)+'/tests/browser/captureShaderRegression.html?'+new URLSearchParams({...(process.argv.includes('--fast')?{fast:'1'}:{}),...(process.argv.includes('--display')?{display:'1'}:{})})})
  for(let i=0;i<600;i++){await pause(100);if(await evaluate('!!window.captureShaderRegression'))break;if(errors.length)throw Error(JSON.stringify(errors))}
  const result=await evaluate('window.captureShaderRegression');console.log(JSON.stringify(result));
  assert.ok(result.activeSamplers.length>8,'stress case exercises material, GI and sun samplers');
  assert.ok(result.activeSamplers.length<=result.maxTextures,'material stays within the fragment sampler limit');
  if(process.argv.includes('--display')) {
    assert.ok(result.activeSamplers.includes('hdFastLight'),'display stress includes experimental GI');
    assert.ok(result.activeSamplers.includes('hdRoomLightBoundaries'),'display retains exact room and portal visibility');
    assert.ok(!result.activeSamplers.includes('hdLightPortalEdges'),'portal edges share the room boundary sampler');
    assert.deepEqual(errors,[]);console.log('PASS: experimental display GI fits the fragment sampler limit with six PBR maps, environment and sun shadows')
  } else {
  assert.ok(!result.activeSamplers.some(name=>['hdRoomLightMask','hdRoomLightBoundaries','hdLightPortals','hdLightPortalEdges'].includes(name)),'capture must not retain disabled room/portal samplers');
  assert.ok(result.point17.some((value,index)=>value>result.off[index]+10),'the seventeenth point light contributes to the GI capture');
  assert.ok(result.spot17.some((value,index)=>value>result.off[index]+10),'the seventeenth spot light contributes to the GI capture');
  assert.ok(result.blockedPoint17.every((value,index)=>value<result.point17[index]/2),'the seventeenth point light uses its own cached occlusion');
  assert.ok(result.blockedSpot17.every((value,index)=>value<result.spot17[index]/2),'the seventeenth spot light uses its own cached occlusion');
  assert.deepEqual(errors,[]);console.log('PASS: capture sampler stress material links without room/portal texture overhead')
  }
}finally{ws?.close();child.kill()}
