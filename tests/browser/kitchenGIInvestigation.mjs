// Controlled Colin kitchen capture. The source model is never changed.
import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const port=process.argv[2]??5180,out=process.argv[3]??'docs/gi-kitchen-diagnostics/before',browser=await lightingBrowser()
const restoring=process.argv.find(a=>a.startsWith('--restore='))?.slice(10)
const diagnosticMode=process.argv.includes('--diagnostics')
const surfacesOnly=process.argv.includes('--surfaces-only')
const shOrder=process.argv.includes('--l2')?2:1
const stairwell=process.argv.includes('--stairwell')
mkdirSync(out,{recursive:true})
try{
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.kitchenRun={workerJobs:[],longTasks:[]};
    new PerformanceObserver(list=>kitchenRun.longTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});
    const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,...args){super(url,...args);this.gi=String(url).includes('indirectLighting.worker');this.jobs=new Map();if(this.gi)this.addEventListener('message',e=>{const j=this.jobs.get(e.data.id);if(j&&e.data.ok!==undefined){j.ms=performance.now()-j.at;j.ok=e.data.ok;j.profile=e.data.value?.interpolationProfile;this.jobs.delete(e.data.id)}})}postMessage(m,...args){if(this.gi&&m.kind!=='lampResult'&&m.kind!=='lampPorts'){const j={kind:m.kind,at:performance.now()};this.jobs.set(m.id,j);kitchenRun.workerJobs.push(j)}return super.postMessage(m,...args)}};
  `})
  if(restoring)await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync(restoring,'utf8')}}}`})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&${stairwell?'stairwell':'kitchen'}-diagnostics&${diagnosticMode?'lightingDiagnostics&':''}lightingProfile&${process.argv.includes('--both-views')?'fullReference&':''}giSH=${shOrder}&${restoring?`saved-gi&${process.argv.includes('--automatic')?'':'preview-lighting'}`:'saved-colin'}`})
  await browser.wait('!!window.roofWallScene?.()',120000)
  await browser.evaluate(`(async()=>{
    const style=document.createElement('style');style.textContent='html,body,#root{width:1200px!important;min-width:0!important;height:850px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:850px!important}[aria-label="Lighting diagnostics"]{visibility:hidden!important}';document.head.appendChild(style);
    const s=roofWallScene();s.gl.setPixelRatio(1);s.invalidate();
    const m=await import('/tests/browser/rendererTestModules.ts');window.kitchenThree=m;
    const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)window.kitchenComposer=v;visit(f.child);visit(f.sibling)};visit(m.getEditorFiber());
    window.kitchenFixedCamera={position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:s.camera.fov};
    const frames=await import('/tests/browser/kitchenFrameMeasurements.ts');window.kitchenLiveFrames=frames.installKitchenLiveFrames(s);
  })()`)
  await browser.wait('roofWallScene().gl.domElement.height===850&&roofWallScene().gl.domElement.width===1199',30000)
  const settings=await browser.evaluate(`({camera:kitchenFixedCamera,sun:regressionSunPosition,exposure:roofWallScene().gl.toneMappingExposure,toneMapping:roofWallScene().gl.toneMapping,dpr:roofWallScene().gl.getPixelRatio(),width:roofWallScene().gl.domElement.width,height:roofWallScene().gl.domElement.height,hardware:navigator.hardwareConcurrency})`)
  writeFileSync(`${out}/settings.json`,JSON.stringify(settings,null,2));console.log('SETTINGS',JSON.stringify(settings))
  const start=Date.now();let last=0,ready
  while(Date.now()-start<600000){
    await new Promise(r=>setTimeout(r,200))
    const s=await browser.evaluate(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return {gi:g,startup:s.scene.userData.progressiveStartup?.phase}})()`)
    if(Date.now()-last>15000){console.log('GI',JSON.stringify({state:s.gi?.state,source:s.gi?.source,completed:s.gi?.completed,total:s.gi?.total,pass:s.gi?.pass,stage:s.gi?.prepareStage,full:s.gi?.fullPassPublications,startup:s.startup}));last=Date.now()}
    if(browser.errors.length)throw Error(browser.errors.join('\n'))
    const g=s.gi
    if(g?.state==='fallback')throw Error(JSON.stringify(g))
    if(s.startup==='full'&&g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.pendingLighting&&!g.saving&&(restoring||g.fullPassPublications>=6)){
      ready=await browser.evaluate(`({status:{...roofWallScene().scene.userData.indirectLighting},environment:roofWallScene().scene.userData.daylightEnvironment,performance:roofWallScene().scene.userData.getLightingPerformance(),jobs:kitchenRun.workerJobs,longTasks:kitchenRun.longTasks})`);break
    }
  }
  assert.ok(ready,'full six-pass kitchen GI must finish')
  if(stairwell){
    settings.camera=await browser.evaluate(`(()=>{const s=roofWallScene();s.camera.fov=55;s.camera.updateProjectionMatrix();s.camera.position.x+=.00001;s.invalidate();return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:s.camera.fov}})()`)
    writeFileSync(`${out}/settings.json`,JSON.stringify(settings,null,2))
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  await browser.evaluate(`(()=>{const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)window.kitchenComposer=v;visit(f.child);visit(f.sibling)};visit(kitchenThree.getEditorFiber())})()`)
  ready.visibilityAudit=await browser.evaluate(`(async()=>{const m=await import('/tests/browser/geometryChangeProfile.ts');return m.geometrySnapshotAudit(roofWallScene())})()`)
  writeFileSync(`${out}/lighting-performance.json`,JSON.stringify(ready,null,2));console.log('READY',JSON.stringify({totalMs:ready.performance.totalMs,probes:ready.status.probes,fullPasses:ready.status.fullPassPublications}))
  if(!restoring){
    const cache=await browser.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()');assert.ok(cache,'save the completed field for repeatable same-light comparisons');writeFileSync('tmp/gi-kitchen-baseline-cache.json',JSON.stringify(cache))
  }
  const before={generation:ready.status.generation,faces:ready.status.capturedFaces}
  async function captureModes(targetDir){
  for(const mode of surfacesOnly?['Sky lighting only','Indirect reflected only','Final composite']:['Direct lighting only','Sky lighting only','Indirect reflected only','Final composite','Albedo','World normals','Matte white','Probe irradiance','Probe visibility']){
    console.log('DIAGNOSTIC',mode)
    await browser.evaluate(`houseDesignerLighting.setMode('${mode}')`);await browser.wait(`houseDesignerLighting.mode==='${mode}'`)
    if(mode==='Sky lighting only')await browser.wait('roofWallScene().scene.userData.getIndirectUniforms().hdDiagnosticSkyReady.value===1',180000)
    if(mode==='Indirect reflected only')await browser.wait('!!houseDesignerLighting.components().packed',180000)
    await new Promise(r=>setTimeout(r,500))
    const status=await browser.evaluate('({...roofWallScene().scene.userData.indirectLighting,glError:roofWallScene().gl.getContext().getError()})')
    assert.equal(status.generation,before.generation);assert.equal(status.capturedFaces,before.faces);assert.equal(status.glError,0)
    const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${targetDir}/${mode.toLowerCase().replaceAll(' ','-')}.png`,Buffer.from(png.data,'base64'))
    console.log('CAPTURED',mode)
  }
  }
  if(diagnosticMode)await captureModes(out)
  if(diagnosticMode)await browser.evaluate(`houseDesignerLighting.setMode('Final composite')`)
  await new Promise(r=>setTimeout(r,300))
  const finalImage=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/final-composite.png`,Buffer.from(finalImage.data,'base64'))
  async function measureEdit(targetDir){
    if(process.argv.includes('--geometry-profile'))await browser.evaluate(`(async()=>{const m=await import('/tests/browser/geometryChangeProfile.ts');window.giBeforeGeometry=m.snapshotGeometryChangeInput(roofWallScene());window.giBeforeGeometryAudit=m.geometrySnapshotAudit(roofWallScene())})()`)
    await browser.evaluate(`(()=>{delete window.giEditResult;delete window.giEditError;void (async()=>{const m=await import('/tests/browser/kitchenWindowEdit.ts');return m.measureKitchenWindowEdit(roofWallScene(),()=>regressionMoveWindow(.25))})().then(r=>window.giEditResult=r).catch(e=>window.giEditError=String(e))})()`)
    let edited,editStart=Date.now(),lastProgress=0
    while(Date.now()-editStart<900000){
      await new Promise(r=>setTimeout(r,500))
      const p=await browser.evaluate('({result:window.giEditResult,error:window.giEditError,status:roofWallScene().scene.userData.indirectLighting})')
      if(p.error)throw Error(p.error)
      if(p.result){edited=p.result;break}
      if(Date.now()-lastProgress>15000){writeFileSync(`${targetDir}/edit-progress.json`,JSON.stringify(p.status,null,2));console.log('EDIT PROGRESS',JSON.stringify({state:p.status.state,completed:p.status.completed,total:p.status.total,stage:p.status.prepareStage,warming:p.status.warming}));lastProgress=Date.now()}
    }
    assert.ok(edited,'background edit must complete')
    writeFileSync(`${targetDir}/window-edit-performance.json`,JSON.stringify(edited,null,2));console.log('EDIT',JSON.stringify(edited))
    const image=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${targetDir}/after-window-edit.png`,Buffer.from(image.data,'base64'))
    if(process.argv.includes('--geometry-profile')){
      const profile=await browser.evaluate(`(async()=>{const m=await import('/tests/browser/geometryChangeProfile.ts');const r=await m.compareGeometryChangeInputs(giBeforeGeometry,m.snapshotGeometryChangeInput(roofWallScene()));delete window.giBeforeGeometry;return {...r,audit:{before:window.giBeforeGeometryAudit,after:m.geometrySnapshotAudit(roofWallScene())}}})()`)
      writeFileSync(`${targetDir}/geometry-change-profile.json`,JSON.stringify(profile,null,2));console.log('GEOMETRY CHANGE',JSON.stringify(profile))
    }
  }
  if(process.argv.includes('--edit'))await measureEdit(out)
  // Kept separate so the measured normal renderer is also reusable without
  // diagnostics in a later controlled frame-rate run.
  async function measureSurfaces(measureView,targetDir){
    await browser.evaluate(`(()=>{delete window.giMeasurementResult;delete window.giMeasurementError;void (async()=>{const m=await import('/tests/browser/kitchenSurfaceMeasurements.ts?measurement=${Date.now()}');return m.collectKitchenMeasurements(roofWallScene(),'${measureView}')})().then(result=>window.giMeasurementResult=result).catch(error=>window.giMeasurementError=String(error))})()`)
    let measurements,measurementStart=Date.now(),lastStage=0
    while(Date.now()-measurementStart<900000){
      await new Promise(resolve=>setTimeout(resolve,500))
      const progress=await browser.evaluate('({result:window.giMeasurementResult,error:window.giMeasurementError,stage:roofWallScene().scene.userData.referenceMeasurementProgress})')
      if(progress.error)throw Error(progress.error)
      if(progress.result){measurements=progress.result;break}
      if(Date.now()-lastStage>10000){console.log('MEASURING',JSON.stringify(progress.stage));lastStage=Date.now()}
    }
    assert.ok(measurements,'independent receiver measurements must finish')
    writeFileSync(`${targetDir}/surface-measurements.json`,JSON.stringify(measurements,null,2))
  }
  if(diagnosticMode)await measureSurfaces(stairwell?'stairwell':'kitchen',out)
  const live=await browser.evaluate(`(()=>{const r=kitchenLiveFrames.report();kitchenLiveFrames.dispose();return r})()`)
  writeFileSync(`${out}/live-frame-performance.json`,JSON.stringify(live,null,2))
  if(!surfacesOnly&&!process.argv.includes('--no-frames')){const frames=await browser.evaluate(process.argv.includes('--room-visibility-experiment')?`(async()=>{const m=await import('/tests/browser/roomVisibilityExperiment.ts');return m.measureRoomVisibilityExperiment(roofWallScene(),kitchenComposer)})()`:`(async()=>{const m=await import('/tests/browser/kitchenFrameMeasurements.ts');return m.measureKitchenFrames(roofWallScene(),kitchenComposer,{cases:[['unchanged production renderer',()=>{}]],restore:()=>{}})})()`)
    writeFileSync(`${out}/frame-performance.json`,JSON.stringify(frames,null,2));if(process.argv.includes('--room-visibility-experiment'))assert.equal(frames.pixels.different,0,'zero-contribution culling must preserve every composed pixel')}
  if(diagnosticMode&&stairwell&&process.argv.includes('--both-views')){
    const kitchenOut=`${out}/kitchen`;mkdirSync(kitchenOut,{recursive:true})
    const kitchenCamera=await browser.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(4.65001,1.6,9.95);s.camera.lookAt(2.1,1.25,4.95);s.camera.fov=45;s.camera.updateProjectionMatrix();s.invalidate();return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:s.camera.fov}})()`)
    writeFileSync(`${kitchenOut}/settings.json`,JSON.stringify({...settings,camera:kitchenCamera},null,2))
    await captureModes(kitchenOut);await browser.evaluate(`houseDesignerLighting.setMode('Final composite')`)
    const frames=process.argv.includes('--no-frames')?undefined:await browser.evaluate(`(async()=>{const m=await import('/tests/browser/kitchenFrameMeasurements.ts');return m.measureKitchenFrames(roofWallScene(),kitchenComposer,{cases:[['unchanged production renderer',()=>{}]],restore:()=>{}})})()`)
    if(frames)writeFileSync(`${kitchenOut}/frame-performance.json`,JSON.stringify(frames,null,2))
    await measureSurfaces('kitchen',kitchenOut)
  }
  if(process.argv.includes('--edit-after')){
    await browser.evaluate(`regressionSetLightingMode('automatic')`);await new Promise(r=>setTimeout(r,500))
    const editOut=`${out}/edit`;mkdirSync(editOut,{recursive:true});await measureEdit(editOut)
    if(process.argv.includes('--edit-twice')){const repeatOut=`${out}/edit-repeat`;mkdirSync(repeatOut,{recursive:true});await measureEdit(repeatOut)}
  }
  if(process.argv.includes('--geometry-experiment')){
    await browser.evaluate(`regressionSetLightingMode('preview')`);await new Promise(r=>setTimeout(r,500))
    await browser.evaluate(`(async()=>{const m=await import('/tests/browser/geometryChangeProfile.ts');window.giBeforeGeometry=m.snapshotGeometryChangeInput(roofWallScene());window.giBeforeGeometryAudit=m.geometrySnapshotAudit(roofWallScene());regressionMoveWindow(.25)})()`)
    await new Promise(r=>setTimeout(r,1000))
    await browser.wait(`(async()=>{const w=await import('/src/wallEngine/wallRoofClipClient.ts'),r=await import('/src/roofAssemblyClient.ts');return !w.isWallClippingPending()&&!r.isRoofAssemblyPending()&&!roofWallScene().scene.userData.shaderWarmupPending})()`,180000)
    await browser.evaluate(`roofWallScene().setFrameloop('never')`)
    const profile=await browser.evaluate(`(async()=>{const m=await import('/tests/browser/geometryChangeProfile.ts');return {...await m.compareGeometryChangeInputs(giBeforeGeometry,m.snapshotGeometryChangeInput(roofWallScene())),audit:{before:giBeforeGeometryAudit,after:m.geometrySnapshotAudit(roofWallScene())}}})()`)
    writeFileSync(`${out}/geometry-change-profile.json`,JSON.stringify(profile,null,2));console.log('GEOMETRY CHANGE',JSON.stringify(profile))
  }
  assert.deepEqual(browser.errors,[]);console.log('PASS controlled kitchen diagnostics, fixed camera, surface measurements and frames')
}finally{browser.close()}
