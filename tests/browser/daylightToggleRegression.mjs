// Restore the saved Colin house at its authored camera/sun and isolate direct/indirect light.
// node tests/browser/savedColinLightingRegression.mjs [port]
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { readFileSync,writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

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
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 120000)
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
    const WorkerBase=Worker;window.Worker=class extends WorkerBase{postMessage(m,...args){if(String(m.kind).match(/preview|volume|plan/))liveMetrics.workers.push(m.kind);const at=performance.now();try{return super.postMessage(m,...args)}finally{const ms=performance.now()-at;if(ms>20&&window.daylightProfile)daylightProfile.calls.push({name:'worker postMessage '+m.kind,ms,at:at-daylightProfile.started})}}};
  `})

  const restoring=process.argv.find(a=>a.startsWith('--restore='))?.slice(10)
  if(restoring)await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync(restoring,'utf8')}}}`})
  await call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&${restoring?'saved-gi':'saved-colin'}`})
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  let last=0,status
  for(let i=0;i<2400;i++){
    await pause(100);status=await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting')
    const fatal=errors.find(e=>!e.startsWith("THREE.GLTFLoader: Couldn't load texture blob:"));if(fatal)throw Error(fatal)
    if(status?.state==='ready'&&!status.pendingLighting&&!status.pendingUpdate&&!status.volumePending&&!status.preparing&&!status.warming&&!status.reading&&!status.saving&&await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase === "full"'))break
    if(Date.now()-last>15000){console.log('loading',status&&{state:status.state,source:status.source,completed:status.completed,total:status.total,blocked:status.blocked});last=Date.now()}
  }
  assert.equal(status.state,'ready')
  assert.equal(status.probes,244)
  if(status.source==='saved'){assert.equal(status.capturedFaces,0);assert.equal(status.reflections,13)}
  else{
    assert.equal(status.source,'baked','legacy saved GI is replaced by current transport')
    assert.equal(status.fullPassPublications,6);assert.equal(status.capturedFaces,status.probes*6)
  }
  console.log('READY',JSON.stringify(status))
  if(process.argv.includes('--cpu-profile')){await call('Profiler.enable');await call('Profiler.start')}
  await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`);await pause(300)
  await evaluate(`(()=>{
    window.daylightProfile={gaps:[],calls:[],programs:0,frames:[],started:performance.now()};let last=performance.now();
    setInterval(()=>{const now=performance.now();daylightProfile.gaps.push(now-last);last=now},16);
    const s=roofWallScene(),ctx=s.gl.getContext();daylightProfile.initialGlassPrograms=s.gl.info.programs?.filter(p=>p.name==='glass').map(p=>({id:p.id,key:p.cacheKey.slice(0,1400)}));
    for(const name of ['getProgramParameter','getProgramInfoLog','getShaderParameter','getShaderInfoLog','getParameter','getActiveUniform','getActiveAttrib','checkFramebufferStatus','deleteTexture','deleteFramebuffer','deleteProgram','shaderSource','compileShader','linkProgram','getUniformLocation','texImage2D','texSubImage2D','texImage3D','texSubImage3D','drawElements','drawArrays','readPixels','getBufferSubData']){
      const fn=ctx[name].bind(ctx);ctx[name]=(...args)=>{const t=performance.now();try{return fn(...args)}finally{
        const ms=performance.now()-t;if(ms>20){const program=name==='getProgramInfoLog'?s.gl.info.programs?.find(p=>p.program===args[0]):null;const source=program?ctx.getShaderSource(program.fragmentShader):'';const row={name,ms,at:t-daylightProfile.started,program:program?.name,key:program?.cacheKey.slice(0,1400),defines:source?.split('\\n').filter(line=>line.startsWith('#define')).slice(0,100)};daylightProfile.calls.push(row);console.warn('GL STALL',name,ms,JSON.stringify(row.defines))}}};
    }
    const create=ctx.createProgram.bind(ctx);ctx.createProgram=()=>{daylightProfile.programs++;return create()};
    const render=s.gl.render.bind(s.gl);s.gl.render=(scene,camera)=>{const t=performance.now();const r=render(scene,camera);
      if(scene===s.scene||scene.userData.retainedViewport)daylightProfile.frames.push({at:t-daylightProfile.started,ms:performance.now()-t});return r}
  })()`)
  // Measure the UI without CPU-profiler startup/deoptimization overhead.
  await evaluate('daylightProfile.gaps=[];daylightProfile.calls=[];daylightProfile.frames=[];daylightProfile.started=performance.now()')
  const click=await evaluate(`(()=>{const input=[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight')?.querySelector('input');if(!input)throw Error('Missing Daylight');const t=performance.now();if(!input.checked){input.click();return {handlerMs:performance.now()-t,checked:input.checked,initial:'night'}}input.click();return {handlerMs:performance.now()-t,checked:input.checked,initial:'day'}})()`)
  console.log('CLICK',click)
  const states=[];let lastState='',added=false,switchedOff=click.initial==='day',navigation;const started=Date.now()
  for(let i=0;i<600;i++){
    await pause(100)
    const sample=await evaluate(`(()=>{const s=roofWallScene(),sun=s.scene.children.find(o=>o.userData.houseDesignerRole==='sun-light');return {at:performance.now()-daylightProfile.started,sun:sun?.intensity,shadow:sun?.castShadow,status:s.scene.userData.indirectLighting,warmup:s.scene.userData.shaderWarmupPending,profile:s.scene.userData.shaderWarmupProfile?.at(-1)}})()`)
    const next=JSON.stringify([sample.sun,sample.status?.state,sample.status?.geometryBuilds,sample.warmup]);if(next!==lastState){console.log('STATE',JSON.stringify({...sample,profile:undefined,status:{state:sample.status?.state,geometryBuilds:sample.status?.geometryBuilds,completed:sample.status?.completed,total:sample.status?.total}}));states.push(sample);lastState=next}
    if(!switchedOff&&Date.now()-started>2000){switchedOff=true;await evaluate("[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight').querySelector('input').click()")}
    if(!navigation&&Date.now()-started>3000){
      navigation=await evaluate(`new Promise(resolve=>{const s=roofWallScene(),position=s.camera.position.clone(),generation=s.scene.userData.indirectLighting.generation,start=performance.now(),first=daylightProfile.frames.length;let count=0;
        function move(now){s.camera.position.x=position.x+.015*Math.sin(++count*.3);s.camera.updateMatrixWorld();s.invalidate();if(now-start<1200)requestAnimationFrame(move);else{const frames=daylightProfile.frames.slice(first).map(f=>f.at+daylightProfile.started),times=[start,...frames,performance.now()];s.camera.position.copy(position);s.camera.updateMatrixWorld();s.invalidate();resolve({frames:frames.length,maxGap:Math.max(...times.slice(1).map((t,i)=>t-times[i])),generationUnchanged:generation===s.scene.userData.indirectLighting.generation})}}requestAnimationFrame(move)})`)
    }
    if(!added&&!process.argv.includes('--toggle-only')&&Date.now()-started>6000){
      added=true
      console.log('ADD',await evaluate(`(()=>{const t=performance.now();window.daylightAddStarted=t;window.updateRegressionFloors(window.regressionFloors.map((f,i)=>i?f:{...f,models:[...f.models,{id:'daylight-new-point',modelId:'point-light',position:{x:4,y:8},height:1.8,elevation:0,rotation:0,scale:1,lightPower:1000}]}));return {at:t-daylightProfile.started,handlerMs:performance.now()-t}})()`))
    }
    if(added&&Date.now()-started>15000&&sample.status?.state==='ready'&&!sample.status?.pendingLighting&&!sample.warmup&&sample.sun===0)break
    if(process.argv.includes('--toggle-only')&&Date.now()-started>12000&&sample.sun===0)break
  }
  const profile=await evaluate('daylightProfile')
  const suffix=process.argv.includes('--after')?'-after':'-before'
  if(process.argv.includes('--cpu-profile')){const {profile}=await call('Profiler.stop');writeFileSync('tmp/daylight-toggle'+suffix+'.cpuprofile',JSON.stringify(profile))}
  writeFileSync('tmp/daylight-toggle'+suffix+'.json',JSON.stringify({click,profile,states,navigation,errors},null,2))
  const frameTimes = [0, ...profile.frames.map(frame => frame.at)]
  const maxFrameGap = Math.max(...frameTimes.slice(1).map((time, index) => time - frameTimes[index]))
  console.log('SUMMARY',JSON.stringify({click,maxGap:Math.max(...profile.gaps),maxFrameGap,programs:profile.programs,calls:profile.calls,states:states.map(s=>({at:s.at,sun:s.sun,shadow:s.shadow,state:s.status?.state,geometry:s.status?.geometryBuilds})),errors}))
  assert.ok(Math.max(...profile.gaps) < 500, 'Daylight changes must keep the UI responsive')
  // Unchanged views deliberately refresh once per second during a bake. Test
  // navigation separately instead of treating that policy as a frozen view.
  assert.ok(maxFrameGap < 1000+Math.max(...profile.gaps)+50, 'stationary refresh respects the bake schedule and measured UI delay')
  assert.ok(navigation.frames>5&&navigation.maxGap<250,'navigation renders promptly while daylight GI is updating')
  assert.equal(navigation.generationUnchanged,true,'camera movement must not invalidate world GI')
  assert.ok(states.some(sample => sample.sun === 0), 'Daylight off must remove the sun immediately')
  assert.deepEqual(errors, [])
} finally {
  ws?.close();child.kill()
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Browser closed'))}
}
