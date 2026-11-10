import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import sharp from 'sharp'
const aoRecovery=process.argv.includes('--ao-recovery')
const matrixReference=process.argv.includes('--matrix-reference')
const port=process.argv.find(v=>v.startsWith('--port='))?.slice(7)??'5191'
const outputDirectory=process.argv.find(v=>v.startsWith('--outdir='))?.slice(9)??'tmp/renderer-audit'
const b=await lightingBrowser(),out=`${outputDirectory}/lifecycle${aoRecovery?'-ao-recovery':''}${matrixReference?'-reference':''}.json`,report={states:[],matrixReference}
mkdirSync(outputDirectory,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const state=()=>b.evaluate(`(()=>{const s=rendererRecovery.state();let sun,inputSun,tempModel=false,changedFinish=false;s?.scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')sun={position:o.position.toArray(),intensity:o.intensity,shadowWidth:o.shadow.camera.right-o.shadow.camera.left,mapSize:o.shadow.mapSize.toArray()}});const visit=f=>{if(!f)return;const p=f.memoizedProps;if(p?.lightDirection&&p.shadowMapSize)inputSun=p.lightDirection;if(p?.model?.id==='renderer-audit-temporary-model')tempModel=true;if(Array.isArray(p?.surfaceAssignments)&&p.surfaceAssignments.some(a=>a.customColor==='#778899'))changedFinish=true;visit(f.child);visit(f.sibling)};visit(window.auditFiber?.());return{sun,inputSun,tempModel,changedFinish,view:rendererRecovery.view,phase:s?.scene.userData.progressiveStartup,warm:s?.scene.userData.shaderWarmupPending,gi:s?.scene.userData.indirectLighting,health:s?.scene.userData.getRendererHealth?.(true),contexts:rendererAuditContexts.map(n=>({createdAt:n.createdAt,live:Object.fromEntries(Object.entries(n.live).map(([k,v])=>[k,v.size])),events:n.events,compileCalls:n.compileCalls,linkCalls:n.linkCalls,textureUploads:n.textureUploads,bufferUploads:n.bufferUploads})),workers:rendererAuditWorkers.map(w=>({...w}))}})()`)
const save=()=>writeFileSync(out,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
async function ready(label){const at=Date.now();let logged=0;while(Date.now()-at<240000){const s=await state();if(s.phase?.phase==='full'&&!s.warm&&!s.gi?.preparing&&!s.gi?.warming&&!s.gi?.volumePending&&(!aoRecovery||(s.health?.canvas.connected&&!s.health.disposed))){report.states.push({label,elapsedMs:Date.now()-at,...s});save();console.log('READY',label,JSON.stringify(s.contexts.map(c=>c.live)));return}if(Date.now()-logged>15000){console.log('WAITING',label,JSON.stringify({phase:s.phase,warm:s.warm,blocked:s.gi?.blocked}));logged=Date.now()}await pause(250)}throw Error('Timeout '+label)}
async function applied(label,predicate){
 const at=Date.now();while(Date.now()-at<60000){const s=await state();if(predicate(s))return;await pause(250)}
 if(aoRecovery&&process.argv.includes('--continue-after-deferred-edit')){
  report.deferredEditStalls??=[];report.deferredEditStalls.push({label,state:await state()});save()
  console.log('DEFERRED-EDIT-LIMITATION',label,'remounting before continuing')
  await b.evaluate('rendererRecovery.setVisible(false)');await pause(2000)
  await b.evaluate('rendererRecovery.setVisible(true)');await pause(1000);await ready('remounted after deferred '+label)
  assert.ok(predicate(await state()),'fixture input must be applied after remount: '+label);return
 }
 throw Error('Deferred input not applied: '+label)
}
async function visible(label){
 const shot=await b.call('Page.captureScreenshot',{format:'png'}),png=Buffer.from(shot.data,'base64')
 writeFileSync(`${outputDirectory}/lifecycle-ao-${label}.png`,png)
 const pixels=await sharp(png).stats();assert.ok(pixels.channels.slice(0,3).some(c=>c.stdev>5),'viewport must contain scene detail')
 const s=await state();assert.equal(s.health.lost,false);assert.equal(s.health.framebuffer,36053);assert.deepEqual(s.health.errors,[])
 assert.ok(!s.health.events.some(e=>/webgl-error|invalid-framebuffer|render-exception|shader-failure|context-lost/.test(e.type)),JSON.stringify(s.health.events))
 report.states.push({label:'visible '+label,...s});save()
}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await b.call('Log.enable')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})()`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererAudit=1&rendererRecoverContext=1&view=building`})
 await b.wait('!!window.rendererRecovery?.state()');await b.evaluate(`(async()=>{const m=await import('/tests/browser/rendererTestModules.ts');window.auditFiber=m.getEditorFiber})()`);await ready('initial building')
 if(matrixReference){const {installAORecovery}=await import('./rendererAORecovery.mjs');await installAORecovery(b);await b.evaluate('aoRecovery.set(false)')}
 const initialSun=report.states.at(-1).sun.position
 const sunDistance=s=>s.sun?Math.hypot(...s.sun.position.map((v,i)=>v-initialSun[i])):Infinity
 await b.evaluate('rendererRecovery.testSun(true)');await applied('sun move',s=>sunDistance(s)>1e-5);await ready('sun changed')
 assert.notDeepEqual(report.states.at(-1).sun.position,initialSun,'sun edit must actually move the light')
 await b.evaluate('rendererRecovery.testSun(false)')
 try{await applied('sun restore',s=>sunDistance(s)<1e-5);await ready('sun restored');report.sunRestore={passed:!report.deferredEditStalls?.some(e=>e.label==='sun restore')}}
 catch(error){
  report.sunRestore={passed:false,error:String(error),state:await state()};save()
  if(!process.argv.includes('--continue-after-sun-restore'))throw error
  console.log('BASELINE-LIMITATION sun restore; remounting fixture to continue independent checks')
  await b.evaluate('rendererRecovery.setVisible(false)');await pause(2000)
  await b.evaluate('rendererRecovery.setVisible(true)');await pause(1000);await ready('sun restored by remount')
 }
 assert.ok(sunDistance(report.states.at(-1))<1e-5,'restored sun must match the baseline')
 await b.evaluate('rendererRecovery.testFurniture(true)');await applied('furniture added',s=>s.tempModel);await ready('added existing furniture type')
 await b.evaluate('rendererRecovery.testFurniture(false)');await applied('furniture removed',s=>!s.tempModel);await ready('removed temporary furniture')
 await b.evaluate('rendererRecovery.testFinish(true)');await applied('finish changed',s=>s.changedFinish);await ready('changed finish colour')
 await b.evaluate('rendererRecovery.testFinish(false)');await applied('finish restored',s=>!s.changedFinish);await ready('restored finish colour')
 if(aoRecovery){
  for(const change of [true,false]){
   await b.evaluate(`rendererRecovery.testTransforms(${change})`)
   await b.wait(`(()=>{const s=rendererRecovery.state(),t=rendererRecovery.transformTest,o=s.scene.getObjectByName('model-transform-'+t.id);return o&&Math.abs(o.matrixWorld.elements[12]-t.originalX-${change ? 0.1 : 0})<1e-5})()`)
   await ready(change?'moved cabinet':'restored cabinet');await visible(change?'cabinet-moved':'cabinet-restored')
  }
  for(const change of [true,false]){
   await b.evaluate(`rendererRecovery.testOpenings(${change})`)
   await b.wait(`(()=>{let applied=false;const t=rendererRecovery.openingTest,visit=f=>{if(!f)return;const p=f.memoizedProps;for(const floor of p?.floors??(p?.floor?[p.floor]:[])){const o=floor.walls?.flatMap(w=>w.openings??[]).find(o=>o.id===t.id);if(o&&Math.abs(o.width-t.originalWidth-${change ? 0.02 : 0})<1e-5)applied=true}visit(f.child);visit(f.sibling)};visit(auditFiber());return applied})()`)
   await pause(1500);await ready(change?'changed door and window widths':'restored door and window widths');await visible(change?'openings-changed':'openings-restored')
  }
  await b.call('Emulation.setDeviceMetricsOverride',{width:1100,height:650,deviceScaleFactor:1,mobile:false});await pause(1500);await visible('resized')
  await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await pause(1500);await visible('size-restored')
 }
 // Change one runtime material clone, never the saved finish definition.
 await b.evaluate(`(()=>{const s=rendererRecovery.state();let m;s.scene.traverse(o=>{if(!m&&o.isMesh&&!Array.isArray(o.material)&&o.material.isMeshStandardMaterial)m=o});window.auditMaterial={mesh:m,original:m.material};m.material=m.material.clone();m.material.roughness=.6;m.material.needsUpdate=true;s.invalidate()})()`)
 await pause(1500);report.states.push({label:'runtime material clone',...await state()});save()
 if(aoRecovery){
  await b.evaluate('auditMaterial.mesh.material.transparent=true;auditMaterial.mesh.material.opacity=.45;auditMaterial.mesh.material.depthWrite=false;auditMaterial.mesh.material.needsUpdate=true;rendererRecovery.state().invalidate()')
  await pause(1000);await visible('transparent-no-depth-write')
  await b.evaluate('auditMaterial.mesh.material.depthWrite=true;rendererRecovery.state().invalidate()')
  await pause(1000);await visible('transparent-depth-write')
  await b.evaluate('auditMaterial.visible=auditMaterial.mesh.visible;auditMaterial.mesh.visible=false;rendererRecovery.state().invalidate()')
  await pause(500);await visible('visibility-hidden')
  await b.evaluate('auditMaterial.mesh.visible=auditMaterial.visible;rendererRecovery.state().invalidate()')
 }
 await b.evaluate('auditMaterial.mesh.material.dispose();auditMaterial.mesh.material=auditMaterial.original;rendererRecovery.state().invalidate()');await pause(500)
 for(const view of aoRecovery?['walk','building','walk','building']:['walk','building']){
  await b.evaluate('rendererRecovery.setVisible(false)');await pause(2000);report.states.push({label:'unmounted before '+view,...await state()});save()
  await b.evaluate(`rendererRecovery.setView('${view}');rendererRecovery.setVisible(true)`);await pause(1000);await ready('remounted '+view)
  if(aoRecovery)await visible('remounted-'+view+'-'+report.states.length)
 }
 if(!aoRecovery){
 await b.evaluate(`(()=>{const s=rendererRecovery.state();window.auditLoss=s.gl.getContext().getExtension('WEBGL_lose_context');auditLoss.loseContext()})()`);await pause(1000)
 report.states.push({label:'forced context lost',...await state()});save()
 await b.evaluate('auditLoss.restoreContext()');await pause(1000);await ready('context restored (DEV prototype)')
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${outputDirectory}/lifecycle-restored.png`,Buffer.from(shot.data,'base64'))
 }
 await b.evaluate('rendererRecovery.setVisible(false)');await pause(2000);report.states.push({label:'final unmount',...await state()});save()
 if(aoRecovery){assert.deepEqual(b.errors,[]);assert.ok(report.states.at(-1).contexts.every(c=>Object.values(c.live).every(n=>n===0)),'all owned WebGL resources released after final unmount')}
}catch(error){report.failure=String(error);try{report.failureState=await state()}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
