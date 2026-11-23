// With Vite running on port 5188: node tests/browser/modellingLightingEdits.mjs
// Exercises the real editor geometry/lifecycle path in an isolated WebGL browser.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const b=await lightingBrowser(),report={moves:[]},out='tmp/modelling-lighting-edits'
mkdirSync(out,{recursive:true})
const metrics=()=>b.evaluate(`(()=>{const s=window.roofWallScene?.(),d=s?.scene.userData;return {model:d?.modellingLighting,probe:d?.indirectLighting,workers:window.modellingWorkerMessages,warmup:d?.shaderWarmupPending,failure:d?.shaderWarmupFailure,programs:s?.gl.info.programs.length}})()`)
const ready=`(()=>{const s=window.roofWallScene?.(),d=s?.scene.userData;return d?.modellingLighting?.state==='ready'&&!d.modellingLighting.pending&&!d.shaderWarmupPending&&!d.indirectScanPending&&d.progressiveStartup?.phase==='full'})()`
async function wait(e,ms=240000){const end=Date.now()+ms;let last=Date.now();while(!await b.evaluate(e)){if(b.errors.length)throw Error(b.errors.join('\n'));if(Date.now()-last>15000){console.log('Waiting',JSON.stringify(await metrics()));last=Date.now()}if(Date.now()>end)throw Error('Timed out '+e+' '+JSON.stringify(await metrics()));await new Promise(r=>setTimeout(r,100))}}
try{
await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.modellingWorkerMessages=[];const W=Worker;window.Worker=class extends W{constructor(url,options){super(url,options);this.fixtureWorkerUrl=String(url)}postMessage(data,...rest){if(this.fixtureWorkerUrl.includes('indirectLighting.worker'))window.modellingWorkerMessages.push({url:this.fixtureWorkerUrl,kind:data.kind,type:data.type});return super.postMessage(data,...rest)}};`})
await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/roofWallRegression.html?lighting-startup&selection-shaders&lightingModel=modelling'})
await wait(ready,300000)
report.initial=await metrics()
assert.equal(report.initial.workers.length,0,'cold modelling mode must not prepare legacy probes')
assert.equal(report.initial.probe?.state,'suspended')
await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(4,1.3,3.2);s.camera.lookAt(3,1.2,0);s.camera.updateMatrixWorld();s.invalidate()})()`)
await wait(ready)
await new Promise(r=>setTimeout(r,600))
await b.evaluate(`(()=>{
 Error.stackTraceLimit=30;
 const s=roofWallScene(),gl=s.gl.getContext(),compile=gl.compileShader.bind(gl),link=gl.linkProgram.bind(gl),render=s.gl.render.bind(s.gl);
 const knownSources=new Set(s.gl.info.programs.flatMap(p=>[gl.getShaderSource(p.vertexShader),gl.getShaderSource(p.fragmentShader)]));
 window.modellingShaderSources={};window.modellingEditTrace={compiles:0,links:0,shaders:[]};
 gl.linkProgram=program=>{modellingEditTrace.links++;return link(program)};
 gl.compileShader=shader=>{
  const source=gl.getShaderSource(shader)||'';let hash=2166136261;
  for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
  modellingShaderSources[hash>>>0]=source;
  modellingEditTrace.shaders.push({hash:hash>>>0,known:knownSources.has(source),
   type:gl.getShaderParameter(shader,gl.SHADER_TYPE)===gl.FRAGMENT_SHADER?'fragment':'vertex',
   phase:s.scene.userData.modellingLighting?.stats?.state,stack:new Error().stack,
   defines:source.split(String.fromCharCode(10)).filter(line=>line.trim().startsWith('#define '))});
  knownSources.add(source);modellingEditTrace.compiles++;return compile(shader)
 };
 s.gl.render=(scene,camera)=>{const result=render(scene,camera);
  if(modellingEditTrace.started&&(scene===s.scene||scene.userData.retainedViewport)){
   let changed=false;scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&!modellingEditTrace.oldGeometries.has(o.geometry))changed=true});
   if(changed&&!modellingEditTrace.geometryMs)modellingEditTrace.geometryMs=performance.now()-modellingEditTrace.started
  }return result
 }
})()`)
for(const delta of [.25,-.25,.25]){
 const before=await metrics(),wallStart=Date.now()
 await b.evaluate(`(()=>{const s=roofWallScene();modellingEditTrace.started=performance.now();modellingEditTrace.geometryMs=0;modellingEditTrace.compiles=0;modellingEditTrace.links=0;modellingEditTrace.shaders=[];modellingEditTrace.oldGeometries=new Set();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')modellingEditTrace.oldGeometries.add(o.geometry)});regressionMoveWindow(${delta})})()`)
 await wait(`(${ready})&&window.roofWallScene().scene.userData.modellingLighting.publications>${before.model.publications}`)
 const after=await metrics(),timings=await b.evaluate('({geometryMs:modellingEditTrace.geometryMs,totalMs:performance.now()-modellingEditTrace.started,compiles:modellingEditTrace.compiles,links:modellingEditTrace.links,shaders:modellingEditTrace.shaders})')
 const result={before:before.model,after:after.model,oldProbeGeneration:after.probe?.generation,oldProbeFaces:after.probe?.capturedFaces??0,oldProbeCompleted:after.probe?.completed??0,workerMessages:after.workers,...timings,wallClockMs:Date.now()-wallStart}
 report.moves.push(result);console.log('Move',JSON.stringify({geometryMs:result.geometryMs,totalMs:result.totalMs,
  lightingMs:after.model.stats?.firstVisibleMs,compiles:result.compiles,workerMessages:after.workers.length}))
 assert.equal(after.workers.length,0,'modelling mode must never submit a legacy probe worker request')
 assert.equal(after.probe?.capturedFaces??0,0,'modelling edits must not capture legacy probe faces')
 assert.equal(after.probe?.generation,before.probe?.generation,'modelling edits must not restart the suspended probe generation')
 assert.ok(result.geometryMs>0,'updated opening geometry must reach the displayed scene')
 assert.equal(after.model.state,'ready')
 if(report.moves.length>1){
  assert.equal(result.compiles,0,'warm architectural edits must reuse compiled shader programs')
  assert.equal(result.links,0,'warm architectural edits must reuse linked shader programs')
 }
 assert.equal(await b.evaluate('roofWallScene().gl.getContext().getError()'),0)
}
await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
await wait(`!!document.querySelector('[aria-label="Lighting mode"]')`)
const choose=value=>b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Lighting mode"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
await choose('existing')
await wait(`window.roofWallScene().scene.userData.modellingLighting.state==='disabled'&&window.modellingWorkerMessages.length>0`)
report.cancellation={running:await metrics()}
await choose('modelling')
await wait(`window.roofWallScene().scene.userData.indirectLighting.state==='suspended'`)
report.cancellation.suspended=await metrics()
await wait(ready)
await new Promise(resolve=>setTimeout(resolve,1500))
report.cancellation.settled=await metrics()
assert.equal(report.cancellation.settled.workers.length,report.cancellation.suspended.workers.length,'suspended legacy worker receives no further work')
assert.equal(report.cancellation.settled.probe.generation,report.cancellation.suspended.probe.generation,'cancelled probe generation stays suspended')
assert.equal(report.cancellation.settled.probe.capturedFaces??0,report.cancellation.suspended.probe.capturedFaces??0,'cancelled probe capture cannot resume')
assert.ok(report.cancellation.running.workers.some(message=>message.kind==='prepare'),'existing mode must still prepare probes')
assert.equal(report.cancellation.running.probe.state,'preparing','switch back while the previous bake is unfinished')
// Switch while cooperative GPU preparation is actually running. A browser-frame
// observer catches the short warm preparation window without adding fake delays.
report.reverseCancellation={preparing:await b.evaluate(`new Promise((resolve,reject)=>{
 const started=performance.now(),requests=roofWallScene().scene.userData.modellingLighting.requests;
 regressionMoveWindow(-.25);
 const observe=()=>{
  const model=roofWallScene().scene.userData.modellingLighting;
  if(model.requests>requests&&model.stats?.state==='preparing'){
   const before=JSON.parse(JSON.stringify(model)),e=document.querySelector('[aria-label="Lighting mode"]');
   e.value='existing';e.dispatchEvent(new Event('change',{bubbles:true}));resolve(before);return
  }
  if(performance.now()-started>15000){reject(Error('No active modelling preparation observed'));return}
  requestAnimationFrame(observe)
 };requestAnimationFrame(observe)
})`)}
await wait(`roofWallScene().scene.userData.modellingLighting.state==='disabled'&&roofWallScene().scene.userData.modellingLighting.stats.state==='idle'`)
report.reverseCancellation.disabled=await metrics()
await new Promise(resolve=>setTimeout(resolve,1000))
report.reverseCancellation.idle=await metrics()
const reverse=report.reverseCancellation
assert.ok(reverse.disabled.model.stats.revision>reverse.preparing.stats.revision,'deactivation cancels the in-progress model generation')
assert.equal(reverse.idle.model.stats.revision,reverse.disabled.model.stats.revision,'deactivated model stays cancelled')
assert.equal(reverse.idle.model.publications,reverse.preparing.publications,'cancelled model preparation cannot publish')
assert.equal(reverse.idle.model.stats.capturePreparations,reverse.disabled.model.stats.capturePreparations,'cancelled preparation cannot resume capture')
assert.equal(reverse.idle.model.pending,false)
await choose('modelling')
await wait(ready)
report.reverseCancellation.resumed=await metrics()
assert.equal(report.reverseCancellation.resumed.probe.state,'suspended')
assert.ok(report.reverseCancellation.resumed.model.publications>reverse.preparing.publications,'modelling resumes after cancellation')
report.summary={
 coldLightingMs:report.initial.model.stats?.firstVisibleMs,
 edits:report.moves.map(move=>({displayedGeometryMs:move.geometryMs,lightingConvergenceMs:move.after.stats?.firstVisibleMs,
  fullEditMs:move.totalMs,shaderCompiles:move.compiles,programLinks:move.links,legacyWorkerRequests:move.workerMessages.length,
  legacyCapturedFaces:move.oldProbeFaces})),
 cancellation:{workerRequestsBeforeSuspend:report.cancellation.suspended.workers.length,
  workerRequestsAfterIdle:report.cancellation.settled.workers.length,probeState:report.cancellation.settled.probe.state},
 reverseCancellation:{cancelledState:reverse.disabled.model.stats.state,
  cancelledRevision:reverse.disabled.model.stats.revision,idleRevision:reverse.idle.model.stats.revision,
  resumedState:reverse.resumed.model.state}
}
for(const [hash,source] of Object.entries(await b.evaluate('window.modellingShaderSources')??{}))writeFileSync(`${out}/compiled-${hash}.glsl`,source)
assert.deepEqual(b.errors,[])
report.passed=true
}catch(error){report.error=String(error);report.final=await metrics();throw error}finally{report.errors=b.errors;writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,...report.summary,error:report.error,errors:report.errors}));b.close()}
