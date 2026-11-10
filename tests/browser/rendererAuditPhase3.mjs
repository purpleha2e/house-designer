// Phase 3 driver for the established renderer audit, not a second profiler.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
const [suite='baseline',devPort='5193',productionPort='5194']=process.argv.slice(2)
const out='tmp/renderer-phase3',b=await lightingBrowser({uncapped:true}),report={suite,started:new Date().toISOString(),runs:[],failures:[]}
mkdirSync(out,{recursive:true})
const save=()=>writeFileSync(`${out}/${suite}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function clickControl(selector,text){
 await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 await b.evaluate(`Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`)
 const p=await b.evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text?`a.find(e=>e.textContent.trim()===${JSON.stringify(text)})`:'a[0]'};if(!e||e.disabled)throw Error('Audit control unavailable');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Audit control is obscured: '+e.textContent);return{x,y}})()`)
 for(const event of [{type:'mouseMoved',buttons:0},{type:'mousePressed',button:'left',buttons:1,clickCount:1},{type:'mouseReleased',button:'left',buttons:0,clickCount:1}])await b.call('Input.dispatchMouseEvent',{...event,...p})
 await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
}
async function setAuditCamera(camera){
 if(await b.evaluate("!!document.querySelector('.viewer-options')")){
  if(!await b.evaluate("document.querySelector('.viewer-options').classList.contains('is-open')"))await clickControl('.viewer-menu-toggle')
  if(camera.floorName&&await b.evaluate("document.querySelector('[aria-label=\"Current floor\"]').textContent")!==camera.floorName){
   await clickControl('[aria-label="Floor navigation"] button',camera.floorName.includes('0')?'Downstairs':'Upstairs')
   await b.wait(`document.querySelector('[aria-label="Current floor"]').textContent===${JSON.stringify(camera.floorName)}`)
  }
  await clickControl('[aria-label="Navigation mode"] button','Fly')
  await clickControl('.viewer-menu-toggle')
  await b.wait(`(async()=>{const {getEditorFiber}=await rendererRecovery.modules();let ready=false;const visit=f=>{if(!f)return;if(f.memoizedProps?.mode==='fly'&&f.memoizedProps?.floorElevation!==undefined)ready=true;visit(f.child);visit(f.sibling)};visit(getEditorFiber());return ready})()`)
  await b.wait(`(()=>{const u=rendererRecovery.state().scene.userData,g=u.indirectLighting;return !u.shaderWarmupPending&&g?.state==='ready'&&!g.preparing&&!g.pendingUpdate&&!g.volumePending&&u.softFloorGI?.state==='ready'})()`,240000)
 }
 const assigned=await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,v=${JSON.stringify(camera)};c.position.fromArray(v.position);if(v.quaternion)c.quaternion.fromArray(v.quaternion);else c.lookAt(...v.lookAt);if(v.fov!==undefined)c.fov=v.fov;c.updateProjectionMatrix();c.updateMatrixWorld();return{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov}})()`)
 await b.evaluate('rendererAudit.sample(3000,false)')
 const actual=await b.evaluate('rendererAudit.snapshot().camera')
 assert.ok(actual.position.every((n,i)=>Math.abs(n-camera.position[i])<1e-8),'Camera controller overwrote the requested audit pose')
 assert.ok(actual.quaternion.every((n,i)=>Math.abs(n-assigned.quaternion[i])<1e-8),'Camera controller overwrote the requested audit orientation')
 return actual
}
async function prepare(build,view,label,query='',overridePort){
 const port=overridePort??(build==='development'?devPort:productionPort)
 const response=await fetch(`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html`,{signal:AbortSignal.timeout(5000)});assert.ok(response.ok)
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererShadows=single&rendererShadowSize=2048&view=${view}${query}`})
 const at=Date.now();let logged=0,state
 while(Date.now()-at<240000){
  state=await b.evaluate(`(()=>{const s=window.rendererRecovery?.state();if(!s)return null;const u=s.scene.userData;return{development:rendererRecovery.development,models:rendererRecovery.projectModels,phase:u.progressiveStartup,warm:u.shaderWarmupPending,gi:u.indirectLighting,softFloor:u.softFloorGI,preparation:u.viewportPreparation,shaderFailures:s.gl.getContext().__rendererAudit?.failures}})()`)
  if(b.errors.length||state?.shaderFailures?.length)throw Error('Preparation error '+label+': '+JSON.stringify({errors:b.errors,state}))
  const gi=state?.gi
  if(state?.phase?.phase==='full'&&!state.warm&&(view!=='walk'||(gi?.state==='ready'&&!gi.pendingUpdate&&!gi.preparing&&!gi.warming&&!gi.volumePending&&state.softFloor?.state==='ready')))break
  if(Date.now()-logged>15000){logged=Date.now();console.log('PREPARING',label,JSON.stringify({ms:Date.now()-at,phase:state?.phase?.phase,warm:state?.warm,gi:gi?.state,softFloor:state?.softFloor?.state}));report.preparing={label,ms:Date.now()-at,state};save()}
  await pause(250)
 }
 assert.equal(state?.phase?.phase,'full');assert.equal(state?.warm,false)
 if(view==='walk'){assert.equal(state.gi.state,'ready');assert.equal(state.gi.source,'saved');assert.equal(state.gi.capturedFaces,0);assert.equal(state.softFloor.state,'ready')}
 assert.equal(state.models,68);assert.equal(state.development,build==='development')
 await b.evaluate('rendererRecovery.installAudit().then(a=>window.rendererAudit=a)')
 await b.evaluate('rendererAudit.configure({})')
 await b.evaluate('rendererAudit.sample(10000,true)')
 const initial=await b.evaluate('rendererAudit.snapshot()')
 assert.deepEqual(initial.canvas,{width:1280,height:720,dpr:1});assert.equal(initial.lost,false);assert.deepEqual(initial.errors,[])
 return{label,build,view,preparationMs:Date.now()-at,state,initial,samples:{}}
}
async function shot(name,sceneOnly=false){
 if(sceneOnly)await b.evaluate(`(()=>{const style=document.createElement('style');style.id='audit-shot-style';style.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(style)})()`)
 try{const s=await b.call('Page.captureScreenshot',{format:'png'});const buffer=Buffer.from(s.data,'base64');writeFileSync(`${out}/${name}.png`,buffer);return buffer}
 finally{if(sceneOnly)await b.evaluate("document.getElementById('audit-shot-style')?.remove()")}
}
function brief(sample){return{fps:sample.presentedFPS,medianMs:sample.frameMs.median,p95Ms:sample.frameMs.p95,p99Ms:sample.frameMs.p99,cpuMs:sample.cpuFrameMs.mean,gpuMs:sample.gpuFrameMs.mean,drawCalls:sample.passes.reduce((n,p)=>n+p.drawCallsPerFrame,0),triangles:sample.passes.reduce((n,p)=>n+p.trianglesPerFrame,0),programs:sample.after.three.programs,heap:sample.after.heap,newPrograms:sample.newPrograms,newWorkers:sample.newWorkerMessages}}
async function compareImages(a,z,name){
 const p=await sharp(a).ensureAlpha().raw().toBuffer({resolveWithObject:true}),q=await sharp(z).ensureAlpha().raw().toBuffer(),diff=Buffer.alloc(q.length);let changed=0,max=0,total=0
 for(let i=0;i<q.length;i+=4){let different=false;for(let c=0;c<3;c++){const d=Math.abs(p.data[i+c]-q[i+c]);different||=d>0;max=Math.max(max,d);total+=d;diff[i+c]=Math.min(255,d*16)}changed+=Number(different);diff[i+3]=255}
 await sharp(diff,{raw:p.info}).png().toFile(`${out}/${name}-diff.png`)
 return{changedPixels:changed,maxChannelError:max,meanAbsoluteError:total/(q.length/4*3)}
}
try{
 report.browser=await b.browserCall('Browser.getVersion')
 report.system=await b.browserCall('SystemInfo.getInfo')
 report.houseSha256=createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex')
 report.conditions={width:1280,height:720,dpr:1,shadow:'single',shadowSize:2048,uncapped:true,nativeAudit:true,appRendererHealth:false,clockAndTemperature:'not reliably available; uncontrolled'}
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Log.enable')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})()`})
 if(suite==='baseline'){
  for(const view of ['building','walk'])for(const [build,repeat]of [['development',1],['production',1],['development',2],['production',2]]){
   const label=`${view}-${build}-${repeat}`,run=await prepare(build,view,label);report.runs.push(run);save()
   await shot(label+'-before')
   for(const moving of [false,true]){
    const key=moving?'moving':'stationary';console.log('SAMPLING',label,key)
    const result=await b.evaluate(`rendererAudit.sample(30000,${moving})`)
    assert.ok(result.durationMs>=30000);assert.equal(result.after.lost,false);assert.deepEqual(result.after.errors,[])
    run.samples[key]=result;save();console.log('MEASURED',label,key,JSON.stringify(brief(result)))
   }
   run.final=await b.evaluate('rendererAudit.snapshot()');await shot(label+'-after');save()
  }
  report.visualComparisons=[]
  for(const view of ['building','walk']){
   const a=await sharp(`${out}/${view}-development-1-before.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true}),z=await sharp(`${out}/${view}-production-1-before.png`).ensureAlpha().raw().toBuffer(),diff=Buffer.alloc(z.length)
   let changed=0,max=0,total=0
   for(let i=0;i<z.length;i+=4){let different=false;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-z[i+c]);different||=d>0;max=Math.max(max,d);total+=d;diff[i+c]=Math.min(255,d*16)}changed+=Number(different);diff[i+3]=255}
   await sharp(diff,{raw:a.info}).png().toFile(`${out}/${view}-development-production-diff.png`)
   report.visualComparisons.push({view,changedPixels:changed,maxChannelError:max,meanAbsoluteError:total/(z.length/4*3)})
  }
 }else if(suite==='final-benchmark'){
  for(const view of ['building','walk'])for(const [label,port]of [['reference-before',devPort],['candidate-1',productionPort],['reference-after',devPort],['candidate-2',productionPort]]){
   const run=await prepare('production',view,`${view}-${label}`,'',port);report.runs.push(run);save()
   for(const moving of [false,true]){
    const key=moving?'moving':'stationary';console.log('FINAL SAMPLING',view,label,key)
    run.samples[key]=await b.evaluate(`rendererAudit.sample(30000,${moving})`);save();console.log('FINAL RESULT',view,label,key,JSON.stringify(brief(run.samples[key])))
   }
  }
 }else if(suite==='gallery'||suite==='gallery-glass'){
  report.comparisons=[]
  const verified=JSON.parse(readFileSync('docs/lighting-correctness/verified/results.json')).map(r=>r.camera)
  const cameras=[
   {id:'timeless-bedroom',position:[3.9,4.25,8.1],lookAt:[1.88,3.9,5.8],fov:55,floorName:'Floor 1'},
   {id:'sunlit-bedroom',position:[2.15,4,13.7],lookAt:[-.7,3.9,11.8],fov:55,floorName:'Floor 1'},
   {...verified.find(c=>c.id==='02-kitchen-inward'),id:'kitchen-metal',floorName:'Floor 0'},
   {id:'bathroom-glass',position:[7.653287577309174,4.5,5.369930839817445],quaternion:JSON.parse(readFileSync(`${out}/baseline.json`)).runs.find(r=>r.view==='walk').initial.camera.quaternion,fov:55,floorName:'Floor 1'},
   {id:'stairs-opening',position:[4.8,4.3,15.7],lookAt:[5.2,1.2,15.3],fov:55,floorName:'Floor 1'},
   {...verified.find(c=>c.id==='02-kitchen-inward'),id:'furniture-wall',position:[2.6,1.6,5.0],floorName:'Floor 0'}
  ]
  for(const view of suite==='gallery-glass'?['walk']:['building','walk']){
   const referenceImages=new Map()
   for(const [label,port]of [['reference',devPort],['candidate',productionPort]]){
    const run=await prepare('production',view,`${view}-gallery-${label}`,'',port);report.runs.push(run);run.cameras=[];save()
    const requested=suite==='gallery-glass'?[await b.evaluate(`(async()=>{const {Box3,Vector3}=await rendererRecovery.modules(),o=rendererRecovery.state().scene.getObjectByName('model-transform-dcca9ce0-c90a-4bb4-8d17-32134b8c2cab');if(!o)throw Error('Bathroom window missing');const box=new Box3().setFromObject(o),p=box.getCenter(new Vector3());return{id:'bathroom-window-glass',position:[p.x+.45,p.y+.15,p.z+1.3],lookAt:p.toArray(),fov:65,floorName:'Floor 1',bounds:{min:box.min.toArray(),max:box.max.toArray()}}})()`)]:[{id:'default',...run.initial.camera},...cameras]
    for(const camera of requested){
     const actual=await setAuditCamera(camera),png=await shot(`gallery-${view}-${camera.id}-${label}`,true)
     run.cameras.push({camera,actual,state:await b.evaluate('rendererAudit.snapshot()')})
     if(label==='reference')referenceImages.set(camera.id,png)
     else report.comparisons.push({view,id:camera.id,...await compareImages(referenceImages.get(camera.id),png,`gallery-${view}-${camera.id}`)})
     save();console.log('GALLERY',view,label,camera.id)
    }
   }
  }
 }else if(suite==='analysis'){
  for(const view of ['building','walk']){
   const run=await prepare('production',view,`${view}-production-analysis`);report.runs.push(run);save()
   run.passProfile=await b.evaluate('rendererAudit.sample(30000,true,true)');save()
   run.operations=await b.evaluate('rendererAudit.countSceneOperations(true)');save()
   run.mainScene=await b.evaluate('rendererRecovery.profileMain(5000,true)');save()
   run.samplers=await b.evaluate('rendererAudit.captureSamplers()');save()
   await b.call('Profiler.enable');await b.call('Profiler.setSamplingInterval',{interval:1000});await b.call('Profiler.start')
   run.profileWindow=await b.evaluate('rendererAudit.sample(10000,true)')
   const p=await b.call('Profiler.stop');writeFileSync(`${out}/${view}-production.cpuprofile`,JSON.stringify(p.profile));await b.call('Profiler.disable');save()
  }
 }else if(suite==='gpu'){
  const run=await prepare('production','walk','walk-production-gpu','&mainFeatures=1');report.runs.push(run);run.features=[];save()
  run.instrumentation=await b.evaluate(`rendererRecovery.pairedRender(60000,{configure:reference=>{rendererRecovery.state().gl.getContext().__rendererAudit.enabled=reference}},true)`)
  await b.evaluate('rendererRecovery.state().gl.getContext().__rendererAudit.enabled=true');save()
  const kitchen=JSON.parse(readFileSync('docs/lighting-correctness/verified/results.json')).find(r=>r.camera.id==='02-kitchen-inward').camera
  const cases=[['normal/bump perturbation',1],['environment specular reflections',2],['shadow sampling',3],['room classification and visibility',4],['direct GGX specular BRDF',5],['PBR evaluation after base/alpha',8],['zero-light early exit candidate',7],['packed roughness/metalness reuse candidate',6]]
  for(const camera of [{id:'bathroom'},kitchen]){
   if(camera.position)await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,v=${JSON.stringify(camera)};c.position.fromArray(v.position);c.quaternion.fromArray(v.quaternion);c.fov=v.fov;c.updateProjectionMatrix();c.updateMatrixWorld()})()`)
   await b.evaluate('rendererMainFeatures.set(0);rendererAudit.sample(5000,false)')
   const packed=await b.evaluate('rendererMainFeatures.validatePacked(rendererRecovery.state())'),before=await shot('gpu-'+camera.id+'-reference',true)
   for(const [name,code]of cases){
    console.log('GPU FEATURE',camera.id,name)
    const paired=await b.evaluate(`rendererRecovery.pairedRender(60000,{configure:reference=>rendererMainFeatures.set(reference?0:${code})},false)`)
    await b.evaluate(`rendererMainFeatures.set(${code});rendererAudit.sample(1000,false)`)
    const png=await shot('gpu-'+camera.id+'-'+code,true),a=await sharp(before).ensureAlpha().raw().toBuffer(),z=await sharp(png).ensureAlpha().raw().toBuffer();let changed=0,max=0,sum=0
    for(let i=0;i<z.length;i+=4){let different=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-z[i+c]);different||=d>0;max=Math.max(max,d);sum+=d}changed+=Number(different)}
    await b.evaluate('rendererMainFeatures.set(0);rendererAudit.sample(1000,false)')
    const entry={camera,name,code,paired,packed:code===6?packed:undefined,visual:{changedPixels:changed,maxChannelError:max,meanAbsoluteError:sum/(z.length/4*3)},restored:await b.evaluate('rendererAudit.snapshot()')};run.features.push(entry);save()
    console.log('GPU RESULT',camera.id,code,JSON.stringify({cpu:paired.pairedOnMinusOff.cpu.mean,gpu:paired.pairedOnMinusOff.gpu.mean,pairs:paired.pairedOnMinusOff.gpu.count,disjoint:paired.disjoint,pending:paired.pending,visual:entry.visual}))
   }
  }
  run.patchStats=await b.evaluate('rendererMainFeatures.stats');run.final=await b.evaluate('rendererMainFeatures.restore();rendererAudit.snapshot()');save()
 }else if(['arrays-experiment','windows-experiment','zero-experiment'].includes(suite)){
  const kind=suite.split('-')[0]
  for(const view of ['building','walk']){
   const run=await prepare('production',view,`${view}-${suite}`,kind==='zero'?'&mainFeatures=1':'');report.runs.push(run);run.paired={};save()
   if(kind==='arrays')await b.evaluate('rendererRecovery.uniformExperiment().then(e=>window.phase3Experiment=e)')
   if(kind==='windows'){
    run.windowSetup=await b.evaluate(`(async()=>{window.phase3Experiment=await rendererRecovery.windowExperiment();const e=phase3Experiment,a=e.signature();e.set(true);const z=e.signature();e.set(false);return{windows:e.windows,sources:e.sources,batches:e.renderBatches,identicalGISource:a===z}})()`)
    assert.equal(run.windowSetup.identicalGISource,true);assert.ok(run.windowSetup.sources>run.windowSetup.batches)
   }
   await b.evaluate(kind==='zero'?`window.phase3Select=value=>rendererMainFeatures.set(value?7:0)`:`window.phase3Select=value=>phase3Experiment.set(value)`)
   await b.evaluate('phase3Select(true);rendererAudit.sample(5000,true)')
   await b.wait('!rendererRecovery.state().scene.userData.shaderWarmupPending',240000)
   await b.evaluate('phase3Select(false);rendererAudit.sample(5000,true)')
   run.prepared=await b.evaluate('rendererAudit.snapshot()');save()
   const reference=await shot(`${view}-${suite}-reference`,true)
   for(const moving of [false,true]){
    console.log('PAIR EXPERIMENT',view,kind,moving?'moving':'stationary')
    const result=await b.evaluate(`rendererRecovery.pairedRender(60000,{counterbalance:true,configure:reference=>phase3Select(!reference)},${moving})`)
    run.paired[moving?'moving':'stationary']=result;save()
    console.log('EXPERIMENT RESULT',view,kind,moving,JSON.stringify({cpu:result.pairedOnMinusOff.cpu.mean,gpu:result.pairedOnMinusOff.gpu.mean,drawsBefore:result.on.drawCalls.mean,drawsAfter:result.off.drawCalls.mean,counterbalanced:result.counterbalanced,errors:result.errors}))
   }
   await b.evaluate('phase3Select(true);rendererAudit.sample(1500,false)');const candidate=await shot(`${view}-${suite}-candidate`,true)
   await b.evaluate('phase3Select(false);rendererAudit.sample(1500,false)');const repeat=await shot(`${view}-${suite}-repeat`,true)
   run.visual=await compareImages(reference,candidate,`${view}-${suite}`);run.controlVisual=await compareImages(reference,repeat,`${view}-${suite}-control`)
   if(kind==='zero'){
    // A nonzero-light control must exercise the original arithmetic too. These
    // fixture-only mutations are identical in both arms and restored in finally.
    run.positiveLightControl={}
    await b.evaluate(`(()=>{window.phase3PositiveLights=[];rendererRecovery.state().scene.traverse(l=>{if(l.isPointLight||l.isSpotLight){phase3PositiveLights.push({l,color:l.color.clone(),intensity:l.intensity});l.color.setRGB(1,1,1);l.intensity=3}})})()`)
    try{
     await b.evaluate('rendererMainFeatures.set(0);rendererAudit.sample(3000,false)')
     const lit=await shot(`${view}-zero-positive-reference`,true)
     run.positiveLightControl.affectsImage=await compareImages(reference,lit,`${view}-zero-positive-light-effect`)
     assert.ok(run.positiveLightControl.affectsImage.changedPixels>100,'Positive-light branch must visibly contribute')
     run.positiveLightControl.paired=await b.evaluate('rendererRecovery.pairedRender(30000,{counterbalance:true,configure:reference=>rendererMainFeatures.set(reference?0:7)},false)')
     await b.evaluate('rendererMainFeatures.set(7);rendererAudit.sample(1000,false)')
     run.positiveLightControl.visual=await compareImages(lit,await shot(`${view}-zero-positive-candidate`,true),`${view}-zero-positive`)
     assert.equal(run.positiveLightControl.visual.changedPixels,0,'Nonzero light output must be identical')
    }finally{await b.evaluate('for(const {l,color,intensity}of phase3PositiveLights){l.color.copy(color);l.intensity=intensity};rendererMainFeatures.set(0);rendererAudit.sample(1000,false)')}
    save()
   }
   // Contiguous A/B/A windows on the editor, supplemented by counterbalanced
   // stationary/moving pairs on both editor and completed-GI walkthrough.
   if(view==='building')for(const [label,enabled]of [['reference-before',false],['candidate',true],['reference-after',false]]){
    await b.evaluate(`phase3Select(${enabled});rendererAudit.sample(3000,true)`)
    for(const moving of [false,true]){const key=label+'-'+(moving?'moving':'stationary');console.log('WINDOW EXPERIMENT',kind,key);run.samples[key]=await b.evaluate(`rendererAudit.sample(30000,${moving})`);save();console.log('WINDOW RESULT',kind,key,JSON.stringify(brief(run.samples[key])))}
   }
   await b.evaluate('phase3Select(false)');run.final=await b.evaluate('rendererAudit.snapshot()')
   if(kind==='arrays')run.cacheStats=await b.evaluate('({...phase3Experiment.stats})')
   if(kind==='windows')assert.equal(run.final.gi.generation,run.prepared.gi.generation,'render-only batching must not invalidate the GI source')
   if(kind!=='zero')await b.evaluate('phase3Experiment.dispose()')
   run.afterCleanup=await b.evaluate('rendererAudit.snapshot()');save()
  }
 }else if(suite==='pair-controls'||suite==='kitchen-controls'){
  const run=await prepare('production','walk','counterbalanced-pair-controls','&mainFeatures=1');report.runs.push(run);save()
  if(suite==='pair-controls'){
  run.nullStationary=await b.evaluate('rendererRecovery.pairedRender(60000,{counterbalance:true,configure:()=>rendererMainFeatures.set(0)},false)');save()
  run.nullMoving=await b.evaluate('rendererRecovery.pairedRender(60000,{counterbalance:true,configure:()=>rendererMainFeatures.set(0)},true)');save()
  run.nativeBookkeeping=await b.evaluate('rendererRecovery.pairedRender(60000,{counterbalance:true,configure:reference=>{rendererMainFeatures.set(0);rendererRecovery.state().gl.getContext().__rendererAudit.enabled=reference}},true)')
  await b.evaluate('rendererRecovery.state().gl.getContext().__rendererAudit.enabled=true');save()
  }
  const camera={...JSON.parse(readFileSync('docs/lighting-correctness/verified/results.json')).find(r=>r.camera.id==='02-kitchen-inward').camera,floorName:'Floor 0'}
  run.actualCamera=await setAuditCamera(camera);run.features=[]
  const reference=await shot('gpu-kitchen-correct-reference',true),packed=await b.evaluate('rendererMainFeatures.validatePacked(rendererRecovery.state())')
  for(const [name,code]of [['normal/bump perturbation',1],['environment specular reflections',2],['shadow sampling',3],['room classification and visibility',4],['direct GGX specular BRDF',5],['PBR evaluation after base/alpha',8],['zero-light early exit candidate',7],['packed roughness/metalness reuse candidate',6]]){
   console.log('COUNTERBALANCED KITCHEN',name)
   const paired=await b.evaluate(`rendererRecovery.pairedRender(60000,{counterbalance:true,configure:reference=>rendererMainFeatures.set(reference?0:${code})},false)`)
   await b.evaluate(`rendererMainFeatures.set(${code});rendererAudit.sample(1000,false)`);const candidate=await shot('gpu-kitchen-correct-'+code,true)
   const visual=await compareImages(reference,candidate,'gpu-kitchen-correct-'+code)
   await b.evaluate('rendererMainFeatures.set(0);rendererAudit.sample(1000,false)')
   run.features.push({name,code,camera,actualCamera:run.actualCamera,paired,visual,packed:code===6?packed:undefined});save()
   console.log('KITCHEN RESULT',code,JSON.stringify({cpu:paired.pairedOnMinusOff.cpu.mean,gpu:paired.pairedOnMinusOff.gpu.mean,visual}))
  }
 }else throw Error('Unknown suite '+suite)
 report.finished=new Date().toISOString();assert.deepEqual(b.errors,[]);save()
}catch(error){report.failure=String(error);try{report.last=await b.evaluate('window.rendererRecovery?.state()?.scene.userData.viewportPreparation')}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
