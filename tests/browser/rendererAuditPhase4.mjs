// Phase 4: reuse the established production audit and its camera/readiness checks.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installPhase4UploadAudit} from './rendererAuditPhase4Diagnostics.js'
const [suite='baseline',devPort='5193',productionPort='5194']=process.argv.slice(2)
const out='tmp/renderer-phase4',b=await lightingBrowser({uncapped:true}),report={suite,started:new Date().toISOString(),runs:[],failures:[]}
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
 await b.evaluate('phase4Sample(3000,false)')
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
 await b.evaluate(`(()=>{window.phase4LongTasks=[];new PerformanceObserver(l=>phase4LongTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});window.phase4Sample=async(...args)=>{const at=performance.now(),uploads=rendererRecovery.state().gl.getContext().__rendererPhase4Uploads,before={...uploads},r=await rendererAudit.sample(...args);r.extendedUploads=Object.fromEntries(Object.entries(uploads??{}).map(([k,v])=>[k,v-(before[k]??0)]));r.longTasks=phase4LongTasks.filter(e=>e.start>=at);r.wallClockEnd=new Date().toISOString();return r}})()`)
 await b.evaluate('rendererAudit.configure({})')
 await b.evaluate('phase4Sample(10000,true)')
 const initial=await b.evaluate('rendererAudit.snapshot()')
 assert.deepEqual(initial.canvas,{width:1280,height:720,dpr:1});assert.equal(initial.lost,false);assert.deepEqual(initial.errors,[])
 return{label,build,view,preparationMs:Date.now()-at,state,initial,samples:{}}
}
async function shot(name,sceneOnly=false){
 if(sceneOnly)await b.evaluate(`(()=>{const style=document.createElement('style');style.id='audit-shot-style';style.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(style)})()`)
 try{const s=await b.call('Page.captureScreenshot',{format:'png'});const buffer=Buffer.from(s.data,'base64');writeFileSync(`${out}/${name}.png`,buffer);return buffer}
 finally{if(sceneOnly)await b.evaluate("document.getElementById('audit-shot-style')?.remove()")}
}
function assertSteady(sample,view){
 assert.ok(sample.durationMs>=30000);assert.equal(sample.after.lost,false);assert.deepEqual(sample.after.errors,[])
 for(const key of ['newPrograms','newWorkerMessages','newTextureUploads','newBufferUploads'])assert.equal(sample[key],0,key+' in steady timing window')
 assert.ok(typeof sample.extendedUploads.bufferSubData==='number'&&typeof sample.extendedUploads.texSubImage2D==='number','Complete upload counters must be present')
 if(view==='walk'){assert.equal(sample.after.gi.state,'ready');assert.equal(sample.after.gi.source,'saved');assert.equal(sample.after.gi.capturedFaces,0);assert.equal(sample.after.softFloor.state,'ready')}
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
 report.system=await b.browserCall('SystemInfo.getInfo');report.processesAtStart=await b.browserCall('SystemInfo.getProcessInfo')
 report.houseSha256=createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex')
 report.conditions={width:1280,height:720,dpr:1,shadow:'single',shadowSize:2048,uncapped:true,nativeAudit:true,appRendererHealth:false,clockAndTemperature:'not reliably available; uncontrolled'}
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Log.enable')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installPhase4UploadAudit.toString()})()`})
 if(suite==='baseline'){
  for(const [view,repeat] of [['building',1],['walk',1],['walk',2],['building',2]]){const build='production';
   const label=`${view}-${build}-${repeat}`,run=await prepare(build,view,label);report.runs.push(run);save()
   await shot(label+'-before')
   for(const moving of (repeat===1?[false,true]:[true,false])){
    const key=moving?'moving':'stationary';console.log('SAMPLING',label,key)
    const result=await b.evaluate(`phase4Sample(30000,${moving})`)
    assert.ok(result.durationMs>=30000);assert.equal(result.after.lost,false);assert.deepEqual(result.after.errors,[])
    run.samples[key]=result;save();console.log('MEASURED',label,key,JSON.stringify(brief(result)))
   }
   run.final=await b.evaluate('rendererAudit.snapshot()');await shot(label+'-after');save()
  }
 }else if(suite==='final-benchmark'){
  for(const view of ['building','walk'])for(const [label,port]of [['reference-before',devPort],['candidate-1',productionPort],['candidate-2',productionPort],['reference-after',devPort]]){
   const run=await prepare('production',view,`${view}-${label}`,'',port);report.runs.push(run);run.processesBefore=await b.browserCall('SystemInfo.getProcessInfo');save()
   for(const moving of (label==='candidate-2'||label==='reference-after'?[true,false]:[false,true])){
    const key=moving?'moving':'stationary';console.log('FINAL SAMPLING',view,label,key)
    run.samples[key]=await b.evaluate(`phase4Sample(30000,${moving})`);assertSteady(run.samples[key],view);save();console.log('FINAL RESULT',view,label,key,JSON.stringify(brief(run.samples[key])))
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
   run.passProfile=await b.evaluate('phase4Sample(30000,true,true)');save()
   run.operations=await b.evaluate('rendererAudit.countSceneOperations(true)');save()
   run.mainScene=await b.evaluate('rendererRecovery.profileMain(5000,true)');save()
   run.samplers=await b.evaluate('rendererAudit.captureSamplers()');save();
   const {phase4Diagnostics}=await import('./rendererAuditPhase4Diagnostics.js');run.phase4=await b.evaluate('('+phase4Diagnostics.toString()+')()');save()
   await b.call('Profiler.enable');await b.call('Profiler.setSamplingInterval',{interval:1000});await b.call('Profiler.start')
   run.profileWindow=await b.evaluate('phase4Sample(10000,true)')
   const p=await b.call('Profiler.stop');writeFileSync(`${out}/${view}-production.cpuprofile`,JSON.stringify(p.profile));await b.call('Profiler.disable');save()
  }
 }else if(suite==='opening-experiment'){
  const experimentSource=readFileSync('tests/browser/rendererAuditOpeningUniforms.js','utf8').replace('export function','function')
  for(const view of ['building','walk']){
   const run=await prepare('production',view,view+'-opening-experiment');report.runs.push(run);run.paired={};save()
   await b.evaluate(experimentSource+';window.phase4Opening=installOpeningUniformExperiment(rendererRecovery.state().gl)')
   run.nullControl=await b.evaluate('rendererRecovery.pairedRender(30000,{counterbalance:true,configure:()=>phase4Opening.set(false)},true)');save()
   for(const moving of [false,true]){
    const key=moving?'moving':'stationary';console.log('OPENING PAIRS',view,key)
    run.paired[key]=await b.evaluate(`rendererRecovery.pairedRender(60000,{counterbalance:true,configure:reference=>phase4Opening.set(!reference)},${moving})`);save()
    console.log('OPENING DELTA',view,key,JSON.stringify(run.paired[key].pairedOnMinusOff))
   }
   for(const [label,enabled]of [['reference-before',false],['candidate',true],['reference-after',false]]){
    await b.evaluate(`phase4Opening.set(${enabled});phase4Sample(2000,false)`)
    for(const moving of (label==='reference-after'?[true,false]:[false,true])){
     const key=label+'-'+(moving?'moving':'stationary');run.samples[key]=await b.evaluate(`phase4Sample(30000,${moving})`);save();console.log('OPENING WINDOW',view,key,JSON.stringify(brief(run.samples[key])))
    }
   }
   await b.evaluate('phase4Opening.set(false);phase4Sample(2000,false)');const reference=await shot(view+'-opening-reference',true)
   await b.evaluate('phase4Opening.set(true);phase4Sample(2000,false)');run.visual=await compareImages(reference,await shot(view+'-opening-candidate',true),view+'-opening');assert.equal(run.visual.changedPixels,0)
   run.stats=await b.evaluate('({...phase4Opening.stats})');await b.evaluate('phase4Opening.dispose()');save()
  }
 }else if(suite==='stair-experiment'){
  const {installStairOcclusionExperiment}=await import('./rendererAuditStairOcclusion.js')
  const run=await prepare('production','walk','walk-stair-experiment');report.runs.push(run);save()
  const {phase4Diagnostics}=await import('./rendererAuditPhase4Diagnostics.js');run.supplement=await b.evaluate('('+phase4Diagnostics.toString()+')()');save()
  await b.evaluate('('+installStairOcclusionExperiment.toString()+')().then(e=>window.phase4Stairs=e)')
  await b.evaluate('phase4Stairs.pair(true,true)');run.nullControlWindow=await b.evaluate('phase4Sample(30000,true)');run.nullControl=await b.evaluate('phase4Stairs.records.splice(0)');save()
  await b.evaluate('phase4Stairs.pair(true)');run.queryPairWindow=await b.evaluate('phase4Sample(60000,true)');run.queryPairs=await b.evaluate('phase4Stairs.records.splice(0)');save()
  assert.ok(run.queryPairs.length>100);assert.ok(run.queryPairs.every(p=>p.equal),'Early-exit occlusion must agree for every same-ray comparison')
  await b.evaluate('phase4Stairs.pair(false)')
  for(const [label,enabled]of [['reference-before',false],['candidate-1',true],['candidate-2',true],['reference-after',false]]){
   await b.evaluate(`phase4Stairs.set(${enabled});phase4Sample(2000,false)`)
   for(const moving of (label==='reference-after'||label==='candidate-2'?[true,false]:[false,true])){
    const key=label+'-'+(moving?'moving':'stationary');run.samples[key]=await b.evaluate(`phase4Sample(30000,${moving})`);save();console.log('STAIR WINDOW',key,JSON.stringify(brief(run.samples[key])))
   }
  }
  run.overlayComparisons=[]
  const poses=await b.evaluate(`(async()=>{const {Raycaster,Vector3}=await rendererRecovery.modules(),s=rendererRecovery.state(),c=s.camera,p=new Vector3(...phase4Stairs.anchor()),original={id:'occluded',position:c.position.toArray(),quaternion:c.quaternion.toArray()},ray=new Raycaster();let visible;for(const [x,z]of [[.3,.3],[.3,-.3],[-.3,.3],[-.3,-.3],[.6,0],[0,.6]]){c.position.set(p.x+x,original.position[1],p.z+z);c.lookAt(p);c.updateMatrixWorld();ray.set(c.position,p.clone().sub(c.position).normalize());const hits=ray.intersectObject(s.scene,true);if(!hits.length||p.distanceTo(c.position)<hits[0].distance){visible={id:'visible',position:c.position.toArray(),quaternion:c.quaternion.toArray()};break}}if(!visible)throw Error('No unobstructed stair-label test pose');c.rotateY(Math.PI);const behind={id:'behind',position:c.position.toArray(),quaternion:c.quaternion.toArray()};return[original,visible,behind]})()`)
  await b.evaluate(`(()=>{const style=document.createElement('style');style.id='phase4-stair-shot';style.textContent='body *{visibility:hidden!important}canvas,.viewer-stair-button{visibility:visible!important}';document.head.appendChild(style)})()`)
  for(const pose of poses){
   const images=[],visibility=[]
   for(const enabled of [false,true]){
    await b.evaluate(`(()=>{const s=rendererRecovery.state(),p=${JSON.stringify(pose)};phase4Stairs.set(${enabled});s.camera.position.fromArray(p.position);s.camera.position.x+=.001;s.camera.quaternion.fromArray(p.quaternion);s.camera.updateMatrixWorld()})()`)
    await b.evaluate('phase4Sample(300,false)')
    await b.evaluate(`(()=>{const s=rendererRecovery.state();s.camera.position.fromArray(${JSON.stringify(pose.position)});s.camera.updateMatrixWorld()})()`)
    await b.evaluate('phase4Sample(2000,false)')
    visibility.push(await b.evaluate('document.querySelector(".viewer-stair-button").getClientRects().length>0'))
    images.push(await shot('walk-stair-'+pose.id+'-'+(enabled?'candidate':'reference')))
   }
   const comparison={pose,visibility,...await compareImages(images[0],images[1],'walk-stair-'+pose.id)};run.overlayComparisons.push(comparison);save();assert.deepEqual(visibility,[pose.id==='visible',pose.id==='visible']);assert.equal(comparison.changedPixels,0)
  }
  await b.evaluate(`document.getElementById('phase4-stair-shot').remove()`)
  run.stats=await b.evaluate('({...phase4Stairs.stats})');await b.evaluate('phase4Stairs.dispose()');save()
 }else if(suite==='stair-gallery'){
  report.comparisons=[];const images=new Map(),anchor=JSON.parse(readFileSync(out+'/analysis.json')).runs.find(r=>r.view==='walk').phase4.stairLabels[0].position;let poses
  const chooseVisible=point=>b.evaluate(`(async()=>{const {Raycaster,Vector3}=await rendererRecovery.modules(),s=rendererRecovery.state(),c=s.camera,p=new Vector3(...${JSON.stringify(point)}),height=c.position.y,ray=new Raycaster();for(const [x,z]of [[.3,.3],[.3,-.3],[-.3,.3],[-.3,-.3],[.6,0],[0,.6]]){c.position.set(p.x+x,height,p.z+z);c.lookAt(p);c.updateMatrixWorld();ray.set(c.position,p.clone().sub(c.position).normalize());const hits=ray.intersectObject(s.scene,true);if(!hits.length||p.distanceTo(c.position)<hits[0].distance)return{position:c.position.toArray(),quaternion:c.quaternion.toArray()}}throw Error('No visible stair pose')})()`)
  const assign=async pose=>{await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,p=${JSON.stringify(pose)};c.position.fromArray(p.position);c.position.x+=.001;c.quaternion.fromArray(p.quaternion);c.updateMatrixWorld()})()`);await b.evaluate('phase4Sample(300,false)');await b.evaluate(`(()=>{const c=rendererRecovery.state().camera;c.position.fromArray(${JSON.stringify(pose.position)});c.updateMatrixWorld()})()`);await b.evaluate('phase4Sample(2000,false)')}
  for(const [label,port]of [['reference',devPort],['candidate',productionPort]]){
   const run=await prepare('production','walk','stair-gallery-'+label,'',port);report.runs.push(run);save()
   if(!poses){const visible=await chooseVisible(anchor),behind=await b.evaluate('(()=>{const c=rendererRecovery.state().camera;c.rotateY(Math.PI);return{position:c.position.toArray(),quaternion:c.quaternion.toArray()}})()');poses=[{id:'occluded',...run.initial.camera},{id:'visible',...visible},{id:'behind',...behind}];report.poses=poses}
   await b.evaluate(`(()=>{const style=document.createElement('style');style.id='phase4-stair-shot';style.textContent='body *{visibility:hidden!important}canvas,.viewer-stair-button{visibility:visible!important}';document.head.appendChild(style)})()`)
   run.overlays=[]
   for(const pose of poses){await assign(pose);const visible=await b.evaluate('document.querySelector(".viewer-stair-button").getClientRects().length>0'),png=await shot('production-stair-'+pose.id+'-'+label);run.overlays.push({pose,visible});assert.equal(visible,pose.id==='visible');if(label==='reference')images.set(pose.id,png);else{const diff=await compareImages(images.get(pose.id),png,'production-stair-'+pose.id);report.comparisons.push({pose:pose.id,...diff});assert.equal(diff.changedPixels,0)}save()}
   await b.evaluate(`document.getElementById('phase4-stair-shot').remove()`)
   if(label==='candidate'){
    run.samplers=await b.evaluate('rendererAudit.captureSamplers()');assert.ok(run.samplers.programs.filter(p=>p.observedAtDraw).every(p=>p.stageUnits.fragment.length<=16&&p.stageUnits.fragment.every(u=>u>=0&&u<16)&&p.conflicts.length===0));save()
    run.navigation=[];await assign(poses.find(p=>p.id==='visible'));await clickControl('.viewer-stair-button')
    for(const floor of ['Floor 0','Floor 1']){
     await b.wait(`document.querySelector('[aria-label="Current floor"]').textContent===${JSON.stringify(floor)}`)
     await b.wait(`(()=>{const u=rendererRecovery.state().scene.userData,g=u.indirectLighting;return u.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&g?.state==='ready'&&g.source==='saved'&&!g.preparing&&!g.pendingUpdate&&!g.volumePending&&u.softFloorGI?.state==='ready'})()`,240000)
     run.navigation.push({floor,state:await b.evaluate('rendererAudit.snapshot()')});save()
     if(floor==='Floor 0'){
      const point=await b.evaluate(`(()=>{const s=rendererRecovery.state();let p;s.scene.traverse(o=>{if(o.name.startsWith('viewer-stair-label-'))p=o.position.toArray()});if(!p)throw Error('New stair label missing');return p})()`)
      await assign(await chooseVisible(point));assert.ok(await b.evaluate('document.querySelector(".viewer-stair-button").getClientRects().length>0'));await clickControl('.viewer-stair-button')
     }
    }
   }
  }
 }else if(suite==='null-controls'){
  for(const view of ['building','walk']){
   const run=await prepare('production',view,view+'-null-controls');report.runs.push(run);run.paired={};save()
   for(const moving of [false,true]){run.paired[moving?'moving':'stationary']=await b.evaluate(`rendererRecovery.pairedRender(30000,{counterbalance:true,configure:()=>{}},${moving})`);save()}
  }
 }else if(suite==='retention'){
  const run=await prepare('production','building','bounded-real-edit-retention');report.runs.push(run);run.cycles=[];save()
  await b.evaluate(`rendererRecovery.modules().then(m=>window.p4fiber=m.getEditorFiber)`)
  const resource=()=>b.evaluate(`(()=>{const s=rendererRecovery.state(),r=s.gl,n=r.getContext().__rendererAudit;return{utc:new Date().toISOString(),three:{...r.info.memory,programs:r.info.programs.length},live:Object.fromEntries(Object.entries(n.live).map(([k,v])=>[k,v.size])),bufferBytes:[...n.buffers.values()].filter(b=>!b.deletedAt).reduce((n,b)=>n+(b.bytes??0),0),heap:performance.memory?.usedJSHeapSize,lost:r.getContext().isContextLost(),warm:s.scene.userData.shaderWarmupPending}})()`)
  await b.evaluate(`(()=>{let sun;rendererRecovery.state().scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')sun=o.position.toArray()});window.phase4OldSun=sun;window.phase4EditState=()=>{let position,finish=false;const s=rendererRecovery.state();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')position=o.position.toArray()});const visit=f=>{if(!f)return;if(f.memoizedProps?.surfaceAssignments?.some(a=>a.customColor==='#778899'))finish=true;visit(f.child);visit(f.sibling)};visit(p4fiber());return{Sun:position?.some((v,i)=>Math.abs(v-phase4OldSun[i])>1e-5),Furniture:!!s.scene.getObjectByName('model-transform-renderer-audit-temporary-model'),Finish:finish}}})()`)
  run.initial=await resource();save()
  for(let cycle=1;cycle<=12;cycle++){
   const steps=[]
   for(const [kind,enabled] of [['Sun',true],['Sun',false],['Furniture',true],['Furniture',false],['Finish',true],['Finish',false]]){
    const at=Date.now();await b.evaluate(`rendererRecovery.test${kind}(${enabled});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    await b.wait(`(()=>{const s=rendererRecovery.state(),u=s.scene.userData;return u.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.viewportPreparation?.pending})()`,240000)
    await b.wait(`phase4EditState()[${JSON.stringify(kind)}]===${enabled}`,60000)
    steps.push({kind,enabled,ms:Date.now()-at})
   }
   await b.evaluate('phase4Sample(2000,false)')
   const entry={cycle,steps,settled:await resource()};run.cycles.push(entry);save()
   if(cycle%3===0){await b.call('HeapProfiler.collectGarbage');entry.afterGC=await resource();save()}
   console.log('RETENTION',cycle,JSON.stringify(entry.settled))
  }
  await b.evaluate('phase4Sample(10000,false)');run.final=await resource();save()
 }else throw Error('Unknown suite '+suite)
 if(['gallery','gallery-glass','stair-gallery'].includes(suite))assert.ok(report.comparisons.every(c=>c.changedPixels===0),'Every matched image must be pixel-identical')
 report.finished=new Date().toISOString();assert.deepEqual(b.errors,[]);save()
}catch(error){report.failure=String(error);try{report.last=await b.evaluate('window.rendererRecovery?.state()?.scene.userData.viewportPreparation')}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
