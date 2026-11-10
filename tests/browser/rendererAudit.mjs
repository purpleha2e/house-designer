// Diagnostic only. Never writes a saved project or changes production settings.
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {mkdirSync,writeFileSync} from 'node:fs'
const [mode='single',view='walk',size='2048',suite='full',port='5191']=process.argv.slice(2)
const out='tmp/renderer-audit';mkdirSync(out,{recursive:true})
const name=`${view}-${mode}-${size}-${suite}`,b=await lightingBrowser()
const report={mode,view,size,suite,date:new Date().toISOString(),samples:{},preparation:[]}
const save=()=>writeFileSync(`${out}/${name}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Log.enable')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})()`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererAudit=1&rendererShadows=${mode}&rendererShadowSize=${size}&view=${view}`})
 const deadline=Date.now()+240000;let logged=0,ready=false
 while(Date.now()<deadline){
  const state=await b.evaluate(`(()=>{const s=window.rendererRecovery?.state();if(!s)return null;const u=s.scene.userData;return{phase:u.progressiveStartup,warm:u.shaderWarmupPending,gi:u.indirectLighting,softFloor:u.softFloorGI,health:u.getRendererHealth?.(false),failures:s.gl.getContext().__rendererAudit?.failures}})()`)
  report.lastState=state
  if(b.errors.some(e=>/Failed to load portal|Uncaught|TypeError|ReferenceError/i.test(e))){report.preparationFailure=true;break}
  if(state?.failures?.length){report.preparationFailure=true;break}
  const gi=state?.gi
  if(state?.phase?.phase==='full'&&!state.warm&&(view!=='walk'||(gi?.state==='ready'&&!gi.pendingUpdate&&!gi.volumePending&&!gi.preparing&&!gi.warming&&state.softFloor?.state==='ready'))){ready=true;break}
  if(Date.now()-logged>15000){logged=Date.now();report.preparation.push(state);console.log('PREPARING',name,JSON.stringify({phase:state?.phase,gi:gi&&{state:gi.state,source:gi.source,completed:gi.completed,total:gi.total,probes:gi.probes}}));save()}
  await pause(250)
 }
 report.initialResources=await b.evaluate(`(()=>{const s=window.rendererRecovery?.state(),g=s?.gl.getContext(),n=g?.__rendererAudit,d=g?.getExtension('WEBGL_debug_renderer_info');return{hardware:g&&{renderer:g.getParameter(d?d.UNMASKED_RENDERER_WEBGL:g.RENDERER),limits:Object.fromEntries(['MAX_TEXTURE_IMAGE_UNITS','MAX_VERTEX_TEXTURE_IMAGE_UNITS','MAX_COMBINED_TEXTURE_IMAGE_UNITS','MAX_3D_TEXTURE_SIZE','MAX_ARRAY_TEXTURE_LAYERS','MAX_TEXTURE_SIZE','MAX_COLOR_ATTACHMENTS','MAX_DRAW_BUFFERS'].map(k=>[k,g.getParameter(g[k])]))},live:n&&Object.fromEntries(Object.entries(n.live).map(([k,v])=>[k,v.size])),textures:n&&[...n.textures.values()],failures:n?.failures,health:s?.scene.userData.getRendererHealth?.(true),models:window.rendererRecovery?.projectModels}})()`)
 save();if(!ready)throw Error('Preparation failed or timed out; no valid frame-rate measurement')
 await b.evaluate(`(async()=>{const s=rendererRecovery.state();s.camera.position.y=4.5;s.camera.updateMatrixWorld();const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js');window.rendererAudit=await installRendererAudit(s)})()`)
 report.pipeline=await b.evaluate('rendererAudit.composerPasses');report.initial=await b.evaluate('rendererAudit.snapshot()')
 console.log('READY',name,JSON.stringify({gi:report.initial.gi,three:report.initial.three}));save()
 if(suite==='ao-visual'){
  const {runAOVisual}=await import('./rendererAOVisual.mjs')
  await runAOVisual(b,report,save,out,name)
 }else if(suite==='ao-recovery'||suite==='ao-pair'){
  const {runAORecovery}=await import('./rendererAORecovery.mjs')
  await runAORecovery(b,report,save,out,name)
  const {runAOVisual}=await import('./rendererAOVisual.mjs')
  await runAOVisual(b,report,save,out,name)
 }else if(suite==='pair'){
  report.pairedGI=await b.evaluate(`(async()=>{const {pairedGI}=await import('/tests/browser/rendererAuditPair.js');return pairedGI(rendererRecovery.state(),60000)})()`);save()
 }else if(suite==='prepare'){report.samplers=await b.evaluate('rendererAudit.captureSamplers()');save()}
 else{
  const cases=suite==='ao'?[['ao-off-enforced',{ao:false}],['post-off-aces',{postprocess:false}],['gi-contribution-off-enforced',{probeGI:false}],['gi-shader-bypass-enforced',{giShader:false}]]:[['baseline',{}],...(suite==='full'?[['ao-off',{ao:false}],['post-off',{postprocess:false}],...(view==='walk'?[['gi-contribution-off',{probeGI:false}],['gi-shader-bypass',{giShader:false}]]:[]),['baseline-repeat',{}]]:[])]
  for(const [label,options]of cases){
   await b.evaluate(`rendererAudit.configure(${JSON.stringify(options)})`)
   await b.evaluate('rendererAudit.sample(3000,true)') // excluded warm-up
   for(const moving of [false,true]){
    console.log('SAMPLING',name,label,moving?'moving':'stationary')
    const result=await b.evaluate(`rendererAudit.sample(30000,${moving})`)
    report.samples[`${label}-${moving?'moving':'stationary'}`]=result;save()
    console.log('MEASURED',JSON.stringify({label,moving,fps:result.presentedFPS,p95:result.frameMs.p95,cpu:result.cpuFrameMs.mean,gpu:result.gpuFrameMs.mean,newPrograms:result.newPrograms,workers:result.newWorkerMessages}))
   }
  }
  await b.evaluate('rendererAudit.configure({})')
  report.passProfile=await b.evaluate('rendererAudit.sample(5000,true,true)');save()
  report.samplers=await b.evaluate('rendererAudit.captureSamplers()');save()
  await b.call('Profiler.enable');await b.call('Profiler.start');await b.evaluate('rendererAudit.sample(6000,true)')
  const profile=await b.call('Profiler.stop');writeFileSync(`${out}/${name}.cpuprofile`,JSON.stringify(profile.profile));await b.call('Profiler.disable')
 }
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(shot.data,'base64'))
 report.final=await b.evaluate('rendererAudit.snapshot()');save()
}catch(error){report.failure=String(error);save();console.error(error);process.exitCode=1}finally{b.close()}
