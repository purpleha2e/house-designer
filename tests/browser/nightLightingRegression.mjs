// Restore the saved Colin house at its authored camera/sun and isolate direct/indirect light.
// node tests/browser/savedColinLightingRegression.mjs [port]
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const port = process.argv[2] ?? '5180'
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

  await call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&saved-colin`})
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  let last=0,status
  for(let i=0;i<2400;i++){
    await pause(100);status=await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting')
    const fatal=errors.find(e=>!e.startsWith("THREE.GLTFLoader: Couldn't load texture blob:"));if(fatal)throw Error(fatal)
    if(status?.state==='ready'&&!status.pendingLighting&&!status.pendingUpdate&&!status.volumePending&&!status.preparing&&!status.warming&&!status.reading&&!status.saving&&await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase === "full"'))break
    if(Date.now()-last>15000){console.log('loading',status&&{state:status.state,source:status.source,completed:status.completed,total:status.total,blocked:status.blocked});last=Date.now()}
  }
  assert.equal(status.state,'ready')
  assert.equal(status.source,'saved');assert.equal(status.capturedFaces,0);assert.equal(status.probes,244);assert.equal(status.reflections,13)
  console.log('READY',JSON.stringify(status))

  const lamp=await evaluate(`window.regressionFloors[0].models.find(m=>m.modelId==='point-light').id`)
  await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`);await pause(150)
  const reset=await evaluate(`(()=>{const input=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));return {daylight:[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight').querySelector('input').checked}})()`)
  assert.equal(reset.daylight,false,'Use the saved night fixture')
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="View exposure"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await evaluate(`window.updateRegressionFloors(regressionFloors.map(f=>({...f,models:f.models.map(m=>m.modelId==='point-light'?{...m,lightEnabled:false}:m)})))`)
  let darkness
  for(let i=0;i<100;i++){
    await pause(100);darkness=await evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms?.(),lights=[];s.scene.traverse(o=>{if(o.isLight)lights.push({type:o.type,intensity:o.intensity})});return {strength:u?.hdGIDisplayStrength.value,fill:u?.hdGIIndoorFill.value,lights}})()`)
    if(darkness.strength===0&&darkness.lights.every(l=>l.intensity===0))break
  }
  assert.equal(darkness.strength,0);assert.equal(darkness.fill,0);assert.ok(darkness.lights.every(l=>l.intensity===0))
  await pause(150)
  const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/night-all-off.png',Buffer.from(data,'base64'))
  const region=await sharp(Buffer.from(data,'base64')).extract({left:20,top:100,width:750,height:600}).toBuffer()
  const pixels=await sharp(region).stats()
  assert.ok(pixels.channels.slice(0,3).every(c=>c.mean<1),'Unlit room must render black, not retain old GI or environment fill')
  console.log('DARKNESS',darkness)
  await evaluate(`(()=>{
    window.nightMetrics={gaps:[],programsDuringDraw:0,frames:[0],events:[],started:performance.now()};
    const s=roofWallScene(),ctx=s.gl.getContext(),create=ctx.createProgram.bind(ctx),render=s.gl.render.bind(s.gl);
    let last=performance.now(),display=false;
    setInterval(()=>{const now=performance.now();nightMetrics.gaps.push(now-last);last=now},16);
    const source=ctx.shaderSource.bind(ctx);
    ctx.shaderSource=(shader,code)=>{nightMetrics.events.push({t:performance.now()-nightMetrics.started,event:'shader',length:code.length,kind:code.includes('hdLocalRadiance')?'relighter':code.includes('hdSurfaceReceiver')?'surface':code.includes('hdSurfaceRadiance')?'reduce':code.includes('samplerCube radiance')?'integrate':code.includes('uniform sampler2D current')?'preview':'other'});return source(shader,code)};
    setInterval(()=>{const gi=s.scene.userData.indirectLighting;nightMetrics.events.push({t:performance.now()-nightMetrics.started,event:'status',state:gi.state,warming:gi.warming,preparing:gi.preparing,reading:gi.reading,completed:gi.completed,captured:gi.capturedFaces})},250);
    ctx.createProgram=()=>{if(display)nightMetrics.programsDuringDraw++;return create()};
    s.gl.render=(scene,camera)=>{display=scene===s.scene||!!scene.userData.retainedViewport;try{if(display)nightMetrics.frames.push(performance.now()-nightMetrics.started);return render(scene,camera)}finally{display=false}}
  })()`)
  const added=await evaluate(`(()=>{const t=performance.now();window.updateRegressionFloors(regressionFloors.map((f,i)=>i?f:{...f,models:[...f.models,{id:'night-new-point',modelId:'point-light',position:{x:4,y:8},height:1.8,rotation:0,scale:1,lightPower:220,lightEnabled:true}]}));return performance.now()-t})()`)
  await pause(45000)
  const metrics=await evaluate('nightMetrics');writeFileSync('tmp/night-metrics.json',JSON.stringify(metrics,null,2));console.log('NIGHT RESULT',JSON.stringify({handlerMs:added,maxHeartbeat:Math.max(...metrics.gaps),programsDuringDraw:metrics.programsDuringDraw,frames:metrics.frames.length}))
  assert.ok(Math.max(...metrics.gaps)<500,'Night light placement must not block UI for half a second')
  assert.equal(metrics.programsDuringDraw,0,'Live display must only use prepared shaders')
  const maxFrameGap=Math.max(...metrics.frames.slice(1).map((t,i)=>t-metrics.frames[i]));console.log('MAX FRAME GAP',maxFrameGap)
  assert.ok(maxFrameGap<1000,'GI preparation must not stall rendered frames for a second')
  assert.ok(metrics.frames.length>20,'Prepared night view must keep drawing during capture preparation')
  assert.deepEqual(errors,[])
  console.log('PASS no-source darkness and responsive night point placement')
} finally {
  ws?.close();child.kill()
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Browser closed'))}
}
