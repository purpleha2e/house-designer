// With Vite running: node tests/browser/giPipelinePerformance.mjs [port] [project] [seconds]
// Read-only profiling of the existing GI pipeline; uses an isolated headless profile.
// Worker times include queuing/copying; readbacks include GPU completion and timer polling.
// captureMs is CPU submission time, not GPU time. Profiles with asset errors are incomplete.
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const port = process.argv[2] ?? '5180', project = process.argv[3] ?? 'lighting-startup'
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1200,850', `--user-data-dir=${createBrowserTestProfile('gi-pipeline-')}`, 'about:blank',
], { windowsHide: true })
let ws
const pending = new Map()
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Chrome exited ${code}`)) })
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '))
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') console.log('Browser warning', message.params.args.map(a => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 30000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable'); await call('Runtime.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};
    window.liveMetrics={reads:0,workers:[],gaps:[],programs:0};
    let last=performance.now();setInterval(()=>{const now=performance.now();liveMetrics.gaps.push(now-last);last=now},16);
    const WorkerBase=Worker;window.Worker=class extends WorkerBase{postMessage(m,...args){if(String(m.kind).match(/preview|volume|plan/))liveMetrics.workers.push(m.kind);return super.postMessage(m,...args)}};
  `})
  const query=process.argv[3]??'lighting-startup&live-gi'
  await call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?${query}`})
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const status=()=>evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting')
  const waitReady=async(label)=>{
    let last=0
    for(let i=0;i<2400;i++){
      await pause(100);const s=await status()
      const fatal=errors.find(e=>!e.startsWith("THREE.GLTFLoader: Couldn't load texture blob:"));if(fatal)throw Error(fatal)
      if(s?.state==='ready'&&!s.pendingLighting&&!s.pendingUpdate&&!s.volumePending&&!s.preparing&&!s.warming&&!s.reading&&!s.saving&&await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase === "full"'))return s
      if(Date.now()-last>15000){console.log(label,s&&{state:s.state,completed:s.completed,total:s.total,blocked:s.blocked,gpu:s.gpuPreview,gpuProbes:s.gpuPreviewProbes,surfaces:s.surfaceCachedProbes});last=Date.now()}
    }
    throw Error(label+' did not settle')
  }
  await waitReady('initial')
  const lamp=await evaluate(`(async()=>{const {modelsById}=await import('/src/models/modelLibrary.ts');return window.regressionFloors.flatMap(f=>f.models).find(m=>modelsById.get(m.modelId)?.isLight)?.id})()`)
  assert.ok(lamp,'Fixture needs a lamp')
  const change=(factor)=>evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id===${JSON.stringify(lamp)}?{...m,lightPower:(m.lightPower??1000)*${factor}}:m)})))`)
  await change(.9);await waitReady('prepare surfaces')
  const prepared=await status();assert.ok(prepared.surfaceRelighting);assert.ok(prepared.surfaceCachedProbes>0,'Must retain cached receivers')
  await evaluate(`(()=>{const {gl,scene}=window.roofWallScene(),read=gl.readRenderTargetPixelsAsync.bind(gl),ctx=gl.getContext(),create=ctx.createProgram.bind(ctx);gl.readRenderTargetPixelsAsync=(...args)=>{liveMetrics.reads++;return read(...args)};ctx.createProgram=()=>{liveMetrics.programs++;return create()}})()`)
  const results=[]
  for(const gpu of process.argv.includes('--gpu-only')?[true]:[false,true]){
    await evaluate(`window.roofWallScene().scene.userData.indirectGpuPreviewEnabled=${gpu};liveMetrics={reads:0,workers:[],gaps:[],programs:0};window.liveEditStarted=performance.now()`)
    const baseline=await status()
    const start=Date.now();let firstPreview,previewReads
    for(let i=0;i<12;i++){
      await change(i%2?1.02:.98);await pause(80)
      const s=await status()
      if(firstPreview===undefined&&(gpu?s.gpuPreview&&s.gpuPreviewRevision>baseline.lightingRevision:s.generation>baseline.generation&&s.previewUpdates>0)){
        firstPreview=Date.now()-start;previewReads=(await evaluate('liveMetrics.reads'))
      }
    }
    const during=await evaluate('({...liveMetrics,status:window.roofWallScene().scene.userData.indirectLighting})')
    if(gpu){const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/gpu-live-'+query.replace(/[^a-z0-9]/gi,'-')+'-preview.png',Buffer.from(data,'base64'))}
    const before=Date.now();await waitReady(gpu?'GPU settle':'CPU settle')
    const final=await status()
    const result={gpu,firstPreview,previewReads,dragMs:Date.now()-start-(Date.now()-before),settleMs:Date.now()-before,
      during:{reads:during.reads,workers:during.workers,programs:during.programs,maxHeartbeat:Math.max(...during.gaps),status:during.status},final}
    console.log('LIVE RESULT',JSON.stringify(result));results.push(result)
    if(gpu){assert.ok(during.status.gpuPreviewReady||during.status.gpuPreview);assert.equal(during.reads,0,'GPU interaction must not read probe pixels');assert.deepEqual(during.workers,[],'GPU interaction must not rebuild CPU volumes');assert.equal(during.programs,0,'GPU interaction must use warmed shaders');assert.ok(firstPreview<1000,'GPU preview must be interactive')}
  }
  assert.deepEqual(errors,[])
  writeFileSync('tmp/gpu-live-'+query.replace(/[^a-z0-9]/gi,'-')+'.json',JSON.stringify(results,null,2))
  console.log('PASS live GPU relighting integration')
} finally {
  ws?.close();child.kill()
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Browser closed'))}
}
