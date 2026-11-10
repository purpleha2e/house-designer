import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
import {auditCameras} from './lightingCorrectnessDriver.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,stage=process.argv.includes('--candidate')?'candidate':'baseline',out=`docs/gi-spatial-accuracy/${stage}/house`
mkdirSync(out,{recursive:true})
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 const saved=JSON.parse(readFileSync('colin_house_v2.json','utf8')).indirectLighting
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify({...saved,projectKey:'spatial-full-bake-no-restore'})}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&lightingProfile&saved-gi${stage==='candidate'?'&giSpatial=occluder-local':''}`})
 await b.wait('!!window.roofWallScene?.()',120000)
 await b.evaluate(`(async()=>{const s=roofWallScene(),m=await import('/tests/browser/giSpatialHouse.ts');window.spatialAtlas=m.attachSpatialAtlas(s);const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate();window.spatialStarted=performance.now()})()`)
 const started=Date.now();let last=0
 while(true){
  const status=await b.evaluate(`({gi:roofWallScene().scene.userData.indirectLighting,startup:roofWallScene().scene.userData.progressiveStartup,shader:roofWallScene().scene.userData.shaderWarmupPending})`)
  if(Date.now()-last>15000){console.log(stage,'BAKE',JSON.stringify({state:status.gi?.state,completed:status.gi?.completed,probes:status.gi?.probes,pass:status.gi?.pass,stage:status.gi?.prepareStage,firstPreviewMs:status.gi?.firstPreviewMs}));last=Date.now()}
  if(status.gi?.state==='ready'&&!status.gi.pendingUpdate&&!status.gi.volumePending&&!status.gi.saving&&status.startup?.phase==='full'&&!status.shader)break
  assert.ok(Date.now()-started<900000,'full house bake completes');assert.deepEqual(b.errors,[]);await new Promise(r=>setTimeout(r,500))
 }
 await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',300000)
 const cache=await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()');writeFileSync(`tmp/gi-spatial-${stage}-cache.json`,JSON.stringify(cache))
 await b.evaluate(`(async()=>{window.spatialBakeMs=performance.now()-roofWallScene().scene.userData.indirectLighting.bakeStartedAt;const m=await import('/tests/browser/giSpatialHouse.ts');window.spatialView=m.spatialHouseView(roofWallScene())})()`)
 const status=await b.evaluate('({...spatialView.status(),bakeMs:spatialBakeMs})');writeFileSync(`${out}/status.json`,JSON.stringify(status,null,2));assert.equal(status.positions.length,301);assert.equal(status.diagnosticsLoaded,false)
 for(const camera of auditCameras){
  const dir=`${out}/${camera.id}`;mkdirSync(dir,{recursive:true});await b.evaluate(`spatialView.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},${camera.fov})`)
  for(const neutral of [false,true]){
   const name=neutral?'neutral':'authored',frame=await b.evaluate(`spatialView.capture(${neutral})`),rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')
   writeFileSync(`${dir}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')));const png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${dir}/${name}.png`,Buffer.from(png.data,'base64'))
  }console.log(stage,'CAPTURE',camera.id)
 }
 await b.evaluate(`spatialView.setCamera(${JSON.stringify(auditCameras[0].position)},${JSON.stringify(auditCameras[0].lookAt)},60)`)
 const projection=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giSpatialProjection.ts');return m.captureHouseProjection(roofWallScene(),spatialAtlas.atlas())})()`);writeFileSync(`${out}/projection.json`,JSON.stringify(projection,null,2))
 const performance=await b.evaluate('spatialView.performance()');writeFileSync(`${out}/performance.json`,JSON.stringify(performance,null,2))
 const old=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json','utf8')),points=old.results.map(p=>({name:p.name,camera:p.camera,pixel:p.pixel,position:p.position,normal:p.normal,geometricNormal:p.geometricNormal})),references=old.results.map(p=>p.reference)
 console.log(stage,'REFERENCE probes and 39 retained identical receivers')
 const experiment=await b.evaluate(`spatialView.inspect(${JSON.stringify(points)},${JSON.stringify(references)},spatialAtlas.atlas())`);writeFileSync(`${out}/experiment.json`,JSON.stringify(experiment,null,2))
 const gpuReceivers=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giSpatialReceiverGPU.ts');return m.sampleSpatialReceiversGPU(roofWallScene(),${JSON.stringify(points)})})()`);writeFileSync(`${out}/gpu-receivers.json`,JSON.stringify(gpuReceivers,null,2))
 await b.evaluate('spatialView.dispose();spatialAtlas.dispose()')
 console.log(stage,'EDIT 0.25m window')
 const edit=await b.evaluate(`(async()=>{const s=roofWallScene(),before=s.scene.userData.indirectLighting.generation,start=performance.now(),oldField=s.scene.userData.getLightingField();regressionMoveWindow(.25);let firstMs=0;while(true){const g=s.scene.userData.indirectLighting;if(g.generation>before&&!firstMs&&s.scene.userData.getLightingField()!==oldField)firstMs=performance.now()-start;if(g.generation>before&&g.state==='ready'&&!g.volumePending&&!g.pendingUpdate&&!g.saving)return{elapsedMs:performance.now()-start,firstUsefulMs:firstMs,gi:{...g},memory:s.gl.info.memory,glError:s.gl.getContext().getError()};if(performance.now()-start>180000)throw Error('House local edit timed out');await new Promise(r=>setTimeout(r,50))}})()`)
 writeFileSync(`${out}/window-edit.json`,JSON.stringify(edit,null,2));assert.equal(edit.glError,0)
 assert.deepEqual(b.errors,[]);console.log('PASS',stage,JSON.stringify({bakeMs:status.bakeMs,editMs:edit.elapsedMs,firstUsefulMs:edit.firstUsefulMs,programs:status.gi.probes}))
}finally{b.close()}
