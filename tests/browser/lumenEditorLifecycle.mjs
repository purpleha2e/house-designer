import {writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {roomViews} from './lumenRoomViews.mjs'
import {springfieldRoute} from './lumenSpringfieldRoute.mjs'
import {auditWallSelection} from './lumenSelectionAudit.mjs'
import {runLumenResolutionMatrix} from './lumenResolutionAudit.mjs'
import {auditVisibilityEdits} from './lumenVisibilityEdits.mjs'
const origin=process.env.LUMEN_ORIGIN??'http://127.0.0.1:5188',tag=process.argv[2]??'after'
const landing=process.argv.includes('--landing'),pose=landing?roomViews.landing:roomViews.room
const name=landing?'springfield_14':'lighting-test'
const tour=landing&&process.argv.includes('--tour')
const designBaseline=process.argv.includes('--design-baseline')
const pipeline=process.argv.includes('--pipeline-audit')
const folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url);await mkdir(folder,{recursive:true})
const report={project:name,controls:[]},b=await lightingBrowser({onEvent:e=>{if(e.method==='Page.javascriptDialogOpening')console.log('Dialog',e.params.message)}})
const save=()=>writeFile(new URL('editor-'+tag+(landing?'-landing':'')+'.json',folder),JSON.stringify(report,null,2))
const run=(fn,...args)=>b.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
async function menu(){await b.evaluate("if(!document.querySelector('[aria-label=\"GI backend\"]'))document.querySelector('[aria-label=\"3D view menu\"]').click()");await b.wait('!!document.querySelector(\'[aria-label="GI backend"]\')')}
async function indirect(on){await menu();await run(on=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Indirect lighting (GI)').querySelector('input');if(e.checked!==on)e.click();document.querySelector('[aria-label="3D view menu"]').click()},on)}
async function option(label,value){
 await menu()
 await run((label,value)=>{const e=document.querySelector(`[aria-label="${label}"]`);e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="3D view menu"]').click()},label,value)
}
async function captureResolution(name){
 const meta=await run(async()=>{
   const s=perfScene(),u=s.scene.userData
   for(let i=0;i<4 || (i<90 && u.lumenGI?.refining);i++){u.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}
   const r=s.gl.domElement.getBoundingClientRect()
   return {camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),width:s.gl.domElement.width,height:s.gl.domElement.height,
     clip:{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}}
 })
 const {data}=await b.call('Page.captureScreenshot',{format:'png',clip:meta.clip})
 await writeFile(new URL(name+'.png',folder),Buffer.from(data,'base64'))
 report.views??={}
 report.views[name]=meta
}
const ready="perfScene()?.scene.userData.progressiveStartup?.phase==='full'&&!perfScene().scene.userData.shaderWarmupPending"
async function sample(label,profile=false,moving=false){
 const r=await run(async({profile,moving})=>{const p=await audit.sample(2400,moving,profile);return {frame:p.frameMs,gpu:p.gpuFrameMs,cpu:p.cpuFrameMs,presentedFPS:p.presentedFPS,passes:profile?p.passes.map(x=>({name:x.name,gpu:x.gpuMs,perFrame:x.executionsPerFrame,draws:x.drawCallsPerFrame,triangles:x.trianglesPerFrame})):undefined}},{profile,moving})
 report.controls.push({label,...r});await save()
}
async function walk(arm){
 report.walk??=[]
 for(const segment of springfieldRoute){
  const row=await run(async({points,designBaseline})=>{
   const s=perfScene(),camera=s.camera,from=camera.position.clone(),to=from.clone()
   const before={...s.scene.userData.lumenGI},nativeBefore={...s.scene.userData.viewportShaderAudit.totals}
   const lengths=points.slice(1).map((p,i)=>Math.hypot(...p.map((v,k)=>v-points[i][k])))
   const distance=lengths.reduce((n,x)=>n+x,0)
   const pointAt=(travel,out)=>{
    let i=0;while(i<lengths.length-1 && travel>lengths[i])travel-=lengths[i++]
    const next=points[i+1],f=Math.min(1,travel/lengths[i]);return out.set(...points[i].map((v,k)=>v+(next[k]-v)*f))
   }
   const nativeAim=camera.quaternion.clone(),aim=nativeAim.clone()
   const p=await audit.sample(designBaseline?3800:Math.max(2400,distance/1.6*1000),(camera,f)=>{
    pointAt(distance*f,from);pointAt(Math.min(distance,distance*f+(designBaseline ? .42 : .45)),to)
    camera.position.copy(from)
    if(from.distanceToSquared(to)>.00001){to.y=from.y-.12;camera.lookAt(to);aim.copy(camera.quaternion)}
    if(!designBaseline)camera.quaternion.copy(nativeAim).slerp(aim,Math.min(1,f*10))
    else if(from.distanceToSquared(to)<=.00001)camera.quaternion.copy(nativeAim)
    camera.updateMatrixWorld(true)
   },false,false)
   const after=s.scene.userData.lumenGI,native=s.scene.userData.viewportShaderAudit.totals
   return {frame:p.frameMs,gpu:p.gpuFrameMs,cpu:p.cpuFrameMs,presentedFPS:p.presentedFPS,lumenEnabled:!!s.scene.userData.lumenOptions?.enabled,cache:{builds:after.geometryBuilds-before.geometryBuilds,
    bvhBuilds:after.bvhBuilds-before.bvhBuilds,hits:(after.cacheHits??0)-(before.cacheHits??0),misses:(after.cacheMisses??0)-(before.cacheMisses??0),
    daylightReady:after.daylightReady,bounceReady:after.bounceReady,retainedBytes:after.retainedBytes},shader:{compiles:native.compileShader-nativeBefore.compileShader,links:native.linkProgram-nativeBefore.linkProgram}}
  },{points:segment.points,designBaseline})
  report.walk.push({arm,name:segment.name,...row});await save();console.log(arm,segment.name,row.presentedFPS.toFixed(1))
 }
}
async function depthStudy(){
 report.depthStudy=await b.evaluate(`(async()=>{
   const trial=await audit.createDepthStudy(),rows=[],ambientOcclusion=[]
   try{
     trial.set(true);await audit.sample(1200,true)
     for(const withPrepass of [false,true,true,false,false,true,true,false]){
       trial.set(withPrepass);const row=await audit.sample(2000,true)
       rows.push({withPrepass,fps:row.presentedFPS,gpu:row.gpuFrameMs,cpu:row.cpuFrameMs,frame:row.frameMs})
     }
     trial.set(false)
     for(const ao of [true,false,false,true]){
       await audit.configure({ao});const row=await audit.sample(2000,true)
       ambientOcclusion.push({ao,fps:row.presentedFPS,gpu:row.gpuFrameMs,cpu:row.cpuFrameMs})
     }
     await audit.configure()
     const baselinePasses=(await audit.sample(2400,true,true)).passes.map(row=>({name:row.name,gpu:row.gpuMs,executionsPerFrame:row.executionsPerFrame}))
     return {meshes:trial.meshes,rows,ambientOcclusion,baselinePasses}
   }finally{trial.dispose()}
 })()`);await save()
}
async function measureLiveSun(){
 await menu()
 const shaderTotals=()=>b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
 const nativeBefore=await shaderTotals()
 const pad=await b.evaluate(`(()=>{
   const pad=document.querySelector('[aria-label="Move light source"]')
   if(!pad)return null
   const r=pad.getBoundingClientRect();return {x:r.x+r.width*.68,y:r.y+r.height*.36}
 })()`)
 const begin=()=>run(()=>{
   const g=perfScene().scene.userData.lumenGI
   window.sunProbe={at:performance.now(),frame:g.sunFrames,draws:g.cacheProfile.sunAtlasDraws,builds:g.geometryBuilds}
 })
 const finish=async()=>{
  await b.wait('perfScene().scene.userData.lumenGI.sunFrames>window.sunProbe.frame',8000)
  return run(async()=>{
   const s=perfScene(),g=s.scene.userData.lumenGI,p=window.sunProbe,gl=s.gl.getContext()
   const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush()
   let fence=null
   if(sync){try{
     let state=gl.clientWaitSync(sync,0,0)
     while(state===gl.TIMEOUT_EXPIRED && performance.now()-p.at<7000){await new Promise(requestAnimationFrame);state=gl.clientWaitSync(sync,0,0)}
     if(state===gl.ALREADY_SIGNALED || state===gl.CONDITION_SATISFIED)fence=performance.now()-p.at
   }finally{gl.deleteSync(sync)}}
   return {submissionMs:g.lastSunFrameAt-p.at,fenceObservedMs:fence,
     shadowAtlasDraws:g.cacheProfile.sunAtlasDraws-p.draws,cacheBuilds:g.geometryBuilds-p.builds}
  })
 }
 await begin()
 await run(()=>{
   const select=document.querySelector('[aria-label="Sun strength"]')
   if(!select)throw Error('Sun strength control is absent')
   select.value=select.value==='1'?'0.5':'1';window.sunProbe.at=performance.now()
   select.dispatchEvent(new Event('change',{bubbles:true}))
 })
 report.liveSunStrength=await finish()
 await save()
 if(pad){
   await run(()=>document.querySelector('[aria-label="Move light source"]').addEventListener('pointerdown',()=>{window.sunProbe.at=performance.now()},{capture:true,once:true}))
   await begin()
   await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pad})
   try{report.liveSunDirection=await finish()}finally{await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pad})}
 }
 report.liveSunShaders={before:nativeBefore,after:await shaderTotals()}
 await save()
 assert.deepEqual(report.liveSunShaders.after,nativeBefore,'Native shader activity during sun input')
}
async function benchmark(){
 await b.call('Emulation.setDeviceMetricsOverride',{width:landing?1279:1585,height:landing?900:934,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:'('+installNativeAudit.toString()+')()'})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:projectFileInputFixtureSource+';window.confirm=()=>false;window.alert=m=>console.error(m);'})
 await b.call('Page.navigate',{url:origin+'/tests/browser/editorRegression.html?lightingModel=existing&lightingView=custom&giBackend=lumen&giShaderAudit'})
 await b.wait('!!window.perfScene?.() && !!document.querySelector(\'[aria-label="Project menu"]\')',180000)
 await indirect(false)
 console.log('Editor opened; GI disabled')
 await run(async({pose,name,designBaseline})=>{window.projectFileFixture=async()=>{
   const s=await(await fetch('/'+name+'.json')).json()
   s.threeDView.camera={position:Object.fromEntries(['x','y','z'].map((k,i)=>[k,pose.position[i]])),quaternion:Object.fromEntries(['x','y','z','w'].map((k,i)=>[k,pose.quaternion[i]]))}
   if(!designBaseline){
     for(const f of s.floors)for(const m of f.models)m.lightEnabled=false
     s.threeDView.ambientLighting={...s.threeDView.ambientLighting,daylight:true,ambientTerm:0,nightAmbientTerm:0}
     s.threeDView.exposureStops=0
   }
   delete s.indirectLighting
   return [{getFile:async()=>new File([JSON.stringify(s)],name+'.json')}]
 };const {watchEditorLoad}=await import('/tests/browser/lumenLifecycle.js');window.stopLifecycle=watchEditorLoad(pose)},{pose,name,designBaseline})
 await b.evaluate("document.querySelector('[aria-label=\"Project menu\"]').click()")
 await b.wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Load')")
 await b.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Load').click()")
 console.log('Project load requested')
 await b.wait("(()=>{const discard=[...document.querySelectorAll('dialog button')].find(e=>/discard changes and open/i.test(e.textContent));discard?.click();return Math.abs(perfScene()?.camera?.position.z-"+pose.position[2]+")<.1})()",180000)
 console.log('Matched camera loaded')
 await indirect(false)
 if(!await b.evaluate('!!document.fullscreenElement')){
   await b.call('Runtime.evaluate',{expression:"document.querySelector('[aria-label=\"Enter fullscreen\"]')?.click()",userGesture:true})
 }
 if(designBaseline)await b.wait(`perfScene().gl.domElement.width>=${landing?1278:1584}`,30000)
 await b.wait(ready,360000);await b.evaluate('new Promise(r=>setTimeout(r,1200))')
 await indirect(false)
 await b.wait("!perfScene().scene.userData.lumenGI || perfScene().scene.userData.lumenGI.state==='inactive'")
 report.lifecycle=await b.evaluate('stopLifecycle()');await save();console.log('Load phases',report.lifecycle.phases)
 await run(async()=>{const s=perfScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js');window.audit=await installRendererAudit(s)})
 report.fullNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
 await sample('GI disabled after renderer preparation')
 if(designBaseline){
   await run(p=>{const s=perfScene();s.camera.position.fromArray(p.position);s.camera.quaternion.fromArray(p.quaternion)
     s.camera.fov=p.fov;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);s.invalidate()
     const style=document.createElement('style');style.textContent='body *{visibility:hidden} body canvas{visibility:visible}';document.head.append(style)
   },pose)
   await sample('Fully shaded existing renderer, GI disabled',false,true)
   await sample('Fully shaded existing passes, GI disabled',true,true)
   await captureResolution('editor-'+tag+(landing?'-landing':''))
   if(tour) await walk('Fully shaded existing renderer')
   report.hardware=await b.evaluate('audit.snapshot().hardware')
   report.resources=await b.evaluate('(()=>{const s=audit.snapshot();return {textures:s.three.textures,canvas:s.canvas,errors:s.errors}})()')
   await save();return
 }
 if(pipeline){await sample('Fully shaded, GI disabled',false,true);await sample('GI disabled pass costs',true,true)}
 if(process.argv.includes('--depth-study')){await depthStudy();return}
 if(tour){
   await walk('GI disabled')
   assert.ok(report.walk.every(row=>!row.lumenEnabled && row.cache.builds===0 && row.cache.hits===0),'GI performed work during the disabled control route')
   await run(pose=>{const s=perfScene();s.camera.position.fromArray(pose.position);s.camera.quaternion.fromArray(pose.quaternion);s.camera.updateMatrixWorld(true);s.invalidate()},pose)
 }
 await run(async pose=>{const {watchEditorLoad}=await import('/tests/browser/lumenLifecycle.js');window.finishGIUpdate=watchEditorLoad(pose);window.giStartedAt=performance.now()},pose)
 if(process.argv.includes('--prep-profile')){await b.call('Profiler.enable');await b.call('Profiler.setSamplingInterval',{interval:2000});await b.call('Profiler.start')}
 await indirect(true)
 if(tag.startsWith('phase3')||pipeline){
   await b.wait("perfScene().scene.userData.lumenGI?.cacheProfile?.firstDaylightMs>0",240000)
   report.firstApproximateDaylightSubmissionMs=await b.evaluate('perfScene().scene.userData.lumenGI.cacheProfile.firstDaylightAt-giStartedAt')
 }
 await b.wait("perfScene().scene.userData.lumenGI?.daylightReady&&perfScene().scene.userData.lumenGI?.state==='ready'",240000)
 report.firstDaylightMs=await b.evaluate('performance.now()-giStartedAt')
 if(process.argv.includes('--sun-ui-only')){await measureLiveSun();return}
 await b.wait("perfScene().scene.userData.lumenGI?.bounceReady!==false",240000)
 report.cache=await b.evaluate('({...perfScene().scene.userData.lumenGI})')
 report.preparation=await b.evaluate('({...finishGIUpdate(),elapsed:performance.now()-giStartedAt})')
 if(process.argv.includes('--prep-profile')){
   const {profile}=await b.call('Profiler.stop'),times=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]))
   for(let i=0;i<profile.samples.length;i++){const f=nodes.get(profile.samples[i]).callFrame,k=f.functionName+' '+f.url.split('/').at(-1).split('?')[0];times.set(k,(times.get(k)??0)+profile.timeDeltas[i]/1000)}
   report.preparation.cpuProfile=Array.from(times).sort((a,b)=>b[1]-a[1]).slice(0,24);await b.call('Profiler.disable')
 }
 report.readyNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
 await save()
 if(process.argv.includes('--world-performance')){
   const gi='perfScene().scene.userData.lumenGI',settled=`${gi}?.bounceReady && !${gi}.refining`
   await run(p=>{const s=perfScene();s.camera.position.fromArray(p.position);s.camera.quaternion.fromArray(p.quaternion)
     s.camera.fov=p.fov;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);s.invalidate()
   },pose)
   await b.wait(settled,240000)
   report.pose=await b.evaluate('(()=>{const s=perfScene();return {camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),size:[s.gl.domElement.width,s.gl.domElement.height]}})()')
   await sample('Default quarter-resolution GI',false,true)
   await sample('Default quarter-resolution pass costs',true,true)
   report.traceStages=await b.evaluate('audit.sampleTraceStages()')
   if(process.argv.includes('--timing-only')){
     await b.evaluate('audit.lumenPass().displayMaterial.uniforms.filterFeedback.value=false;audit.lumenPass().resetHistory()')
     try{
       await sample('Nearest-patch lookup control',false,true)
       await sample('Nearest-patch lookup pass costs',true,true)
       report.nearestTraceStages=await b.evaluate('audit.sampleTraceStages()')
     }finally{await b.evaluate('audit.lumenPass().displayMaterial.uniforms.filterFeedback.value=true;audit.lumenPass().resetHistory()')}
     report.afterInteractionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
     assert.deepEqual(report.fullNative,report.afterInteractionNative)
     await save();return
   }
   await option('Lumen GI view',22);await b.wait(`perfScene().scene.userData.lumenOptions.diagnostic===22 && ${settled}`,240000)
   await option('Lumen GI view',0);await b.wait(`perfScene().scene.userData.lumenOptions.diagnostic===0 && ${settled}`,240000)
   report.afterInteractionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
   assert.deepEqual(report.fullNative,report.afterInteractionNative)
   await measureLiveSun()
   await b.wait(settled,240000)
   report.selection=await auditWallSelection(b,false)
   assert.ok(report.selection.some(row=>row.surface?.type?.startsWith('wall-')))
   assert.ok(report.selection.every(row=>row.counters.builds===row.trial.counters.builds))
   assert.deepEqual(await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})'),report.fullNative)
   if(process.argv.includes('--visibility-edits'))await auditVisibilityEdits(b,report,save)
   await save();return
 }
 if(process.argv.includes('--selection-audit')){
   await b.wait('!perfScene().scene.userData.lumenGI?.refining',240000)
   report.selection=await auditWallSelection(b,!process.argv.includes('--no-cpu-profile'));await save()
   assert.ok(report.selection.every(row=>row.surface?.type?.startsWith('wall-')||row.wall),'Actual canvas click must select a wall')
   for(const row of report.selection){
     const persistent=({textures,buffers,...state})=>state
     assert.deepEqual(persistent(row.counters),persistent(row.trial.counters),'Selection changed cached lighting or shader state')
   }
   return
 }
 if(process.argv.includes('--resolution-matrix')){
   await run(p=>{const s=perfScene();s.camera.position.fromArray(p.position);s.camera.quaternion.fromArray(p.quaternion)
     s.camera.fov=p.fov;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);s.invalidate()
     const style=document.createElement('style');style.textContent='body *{visibility:hidden} body canvas{visibility:visible}';document.head.append(style)
   },pose)
   const status='perfScene().scene.userData.lumenGI'
   await b.wait(`${status}.bounceReady&&!${status}.refining`,240000)
   await runLumenResolutionMatrix({browser:b,evaluate:run,capture:captureResolution,report,save,status,originScene:'perfScene',mode:'editor-'+tag})
   return
 }
 if(pipeline){
   const gi='perfScene().scene.userData.lumenGI',settled=`${gi}?.bounceReady && !${gi}.refining`
   await b.wait(settled,240000)
   await sample('Surface patches final',false,true);await sample('Surface patches pass costs',true,true)
   await option('Lumen GI view',21)
   await b.wait(`perfScene().scene.userData.lumenOptions.diagnostic===21 && ${settled}`,240000)
   await sample('Surface patches +4 EV',false,true);await sample('Diagnostic pass costs',true,true)
   await option('Lumen GI view',0)
   const started=performance.now()
   await option('Lumen trace method','sdf')
   await b.wait(`${gi}?.trace==='sdf' && ${settled}`,360000)
   report.distance={elapsedMs:performance.now()-started,cache:await b.evaluate(`({...${gi}})`)}
   await sample('Distance field final',false,true);await sample('Distance field pass costs',true,true)
   report.hardware=await b.evaluate('audit.snapshot().hardware')
   report.afterInteractionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
   await save();assert.deepEqual(report.afterInteractionNative,report.readyNative)
   await measureLiveSun()
   return
 }
 if(process.argv.includes('--preparation-only'))return
 if(tour){
   await walk('GI enabled')
   report.geometry=await b.evaluate('audit.sampleGeometry()')
   report.hardware=await b.evaluate('audit.snapshot().hardware')
   report.afterInteractionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})');await save()
   assert.deepEqual(report.afterInteractionNative,report.readyNative,'New programs during the full-house walk')
   await measureLiveSun()
   return
 }
 if(process.argv.includes('--capture')){
   const image=await b.call('Page.captureScreenshot',{format:'png'})
   await writeFile(new URL('editor-'+tag+'.png',folder),Buffer.from(image.data,'base64'))
 }
 await sample('Settled camera')
 for(let pair=0;pair<4;pair++)for(const on of pair%2?[true,false]:[false,true]){
  const row=await run(async on=>{const p=await audit.sampleLumenControl(on,false,true);return {frame:p.frameMs,cpu:p.cpuFrameMs,gpu:p.gpuFrameMs,presentedFPS:p.presentedFPS}},on)
  report.controls.push({label:on?'GI on':'Pass bypassed',pair,...row});await save()
 }
 await sample('Camera movement',false,true);await sample('Pass costs',true,true)
 report.traceStages=await b.evaluate('audit.sampleTraceStages()');await save()
 report.geometry=await b.evaluate('audit.sampleGeometry()')
 report.hardware=await b.evaluate('audit.snapshot().hardware')
 report.afterInteractionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})')
 await save()
 assert.deepEqual(report.afterInteractionNative,report.readyNative,'New shader activity after the room was ready')
 await menu()
 await b.evaluate("(()=>{const e=document.querySelector('[aria-label=\"GI backend\"]');e.value='production';e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label=\"3D view menu\"]').click()})()")
 await b.wait("(()=>{const i=perfScene()?.scene.userData.indirectLighting;return i?.state==='ready'&&!i.pendingUpdate&&!i.volumePending})()",360000)
 await sample('Production GI',false,true)
 report.productionNative=await b.evaluate('({...perfScene().scene.userData.viewportShaderAudit.totals})');await save()
}
try{await benchmark()}catch(e){report.failure=String(e);report.browserErrors=b.errors;await save();throw e}finally{b.close()}
