import fs from 'node:fs'
import crypto from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/bedroom-daylight';fs.mkdirSync(out,{recursive:true})
const frozen=JSON.parse(fs.existsSync(`${out}/project.json.gz`)?gunzipSync(fs.readFileSync(`${out}/project.json.gz`)):fs.readFileSync('tmp/gi-l2-house-project.json'));frozen.indirectLighting.projectKey='bedroom-daylight-fresh';frozen.sunPosition.strength=1;frozen.indirectLighting.settings.skyStrength=1
const bytes=JSON.stringify(frozen);fs.writeFileSync('tmp/bedroom-daylight-project.json',bytes)
fs.writeFileSync(`${out}/inputs.json`,JSON.stringify({frozenSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),authoredProjectSHA256:crypto.createHash('sha256').update(fs.readFileSync('colin_house_v2.json')).digest('hex'),base:JSON.parse(fs.readFileSync('docs/gi-l2-physics/house/inputs.json')),smoothingCm:10,notes:'Same frozen authored geometry and original bedroom camera/lighting metadata as L1/L2 audit. Only isolated fixture settings change. Existing 10 cm display filter enabled for every image.'},null,2))
const save=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2))
const ready=`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`
for(const sky of [1,0,2]){
 const b=await lightingBrowser()
 try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
  await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&skyStrength=${sky}&lightingProfile=1`})
  await b.wait('!!window.roofWallScene?.()?.scene.userData.indirectLighting',600000)
  await b.evaluate(`import('/tests/browser/bedroomDaylight.ts').then(m=>{window.bedroom=m;window.bedroomTrace=m.installBedroomTrace(roofWallScene());return true})`)
  await b.wait(ready,600000)
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
  await b.wait(`!!document.querySelector('[aria-label="Sun strength"]')`)
  const dropdown=await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Sun strength"]');return{value:e.value,options:Array.from(e.options,o=>({value:o.value,text:o.text}))}})()`)
  assert.equal(dropdown.value,'1');save(`dropdown-sky-${sky}`,dropdown)
  await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Soft floor GI radius"]');e.value='10';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`,300000)
  if(sky===1){const screenshot=await b.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${out}/sun-strength-dropdown.png`,Buffer.from(screenshot.data,'base64'))}
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
  let seenSunOne=false
  for(const sun of sky===1?[1,0,2,4,1]:[1]){
   const name=sky===1?`sun-${sun}`:`sky-${sky}`,repeat=sky===1&&sun===1&&seenSunOne,key=repeat?`${name}-repeat`:name
   if(sun===1)seenSunOne=true
   let update
   if(sky===1&&(sun!==1||repeat)){
    await b.evaluate(`bedroomTrace.reset();document.querySelector('[aria-label="3D view menu"]').click();true`)
    await b.wait(`!!document.querySelector('[aria-label="Sun strength"]')`)
    const before=await b.evaluate(`(()=>{const s=roofWallScene();window.bedroomUpdateAt=performance.now();const before={generation:s.scene.userData.indirectLighting.generation,profile:s.scene.userData.getLightingPerformance().version,programs:s.gl.info.programs.length};const e=document.querySelector('[aria-label="Sun strength"]');e.value='${sun}';e.dispatchEvent(new Event('change',{bubbles:true}));return before})()`)
    await b.wait(`regressionSunPosition.strength===${sun}`)
    await b.wait(`(()=>{const g=roofWallScene().scene.userData.indirectLighting;return g.generation>${before.generation}||g.pendingLighting||g.pendingUpdate||roofWallScene().scene.userData.getLightingPerformance().version>${before.profile}})()`,30000)
    await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
    await b.wait(ready,600000);await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`,300000)
    update=await b.evaluate(`({elapsedMs:performance.now()-bedroomUpdateAt,before:${JSON.stringify(before)},programs:roofWallScene().gl.info.programs.length})`)
   }
   const data=await b.evaluate('bedroom.measureBedroom(roofWallScene())');data.trace=await b.evaluate('bedroomTrace.state()');data.gi=await b.evaluate('({...roofWallScene().scene.userData.indirectLighting})');data.update=update
   assert.equal(data.order,1);assert.equal(data.probeCount,301);assert.equal(data.filter.cm,10);assert.equal(data.calibration.settings.diffuseBounces,6)
   assert.ok(Math.abs(data.calibration.sunIntensity-1.3*sun)<1e-8)
   assert.ok(data.calibration.skyCapture.every((v,c)=>Math.abs(v-[.65,.72,.82][c]*3.5*sky)<1e-8))
   if(data.trace.lastSun)assert.ok(data.trace.lastSun.rgb.every((v,c)=>Math.abs(v-data.calibration.sunIrradiance[c]*3.5)<1e-7))
   save(key,data);console.log(key,'complete',data.points.map(p=>p.irradiance[0]))
   if(!repeat){
    await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.bedroomView=m.softGIView(roofWallScene());return true})`)
    const camera=await b.evaluate('bedroomView.camera()')
    for(const view of ['window','sunlit-wall']){
     if(view==='sunlit-wall')await b.evaluate(`bedroomView.setCamera({position:[2.15,4,13.7],lookAt:[-.7,3.9,11.8],fov:65});true`)
     const frame=await b.evaluate('bedroomView.capture(false)');save(`${key}-${view}-camera`,frame.camera);fs.writeFileSync(`${out}/${key}-${view}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
     const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});fs.writeFileSync(`${out}/${key}-${view}.png`,Buffer.from(png.data,'base64'))
    }
    await b.evaluate(`bedroomView.setCamera(${JSON.stringify(camera)});true`);save(`${key}-frames`,await b.evaluate('bedroomView.frames()'));await b.evaluate('bedroomView.dispose();true')
   }
   if(sky===1&&repeat){
    const original=JSON.parse(fs.readFileSync(`${out}/sun-1.json`));assert.ok(data.points.every((p,i)=>p.irradiance.every((v,c)=>Math.abs(v-original.points[i].irradiance[c])<.001)),'Restored baseline differs materially')
    fs.writeFileSync(`${out}/completed-baseline-cache.json.gz`,gzipSync(JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()'))))
    await b.evaluate(`window.bedroomReferenceResult=null;window.bedroomReferenceError=null;bedroom.bedroomReference(roofWallScene(),bedroomTrace).then(r=>window.bedroomReferenceResult=r).catch(e=>window.bedroomReferenceError=String(e));true`)
    await b.wait('!!window.bedroomReferenceResult||!!window.bedroomReferenceError',1800000)
    assert.equal(await b.evaluate('window.bedroomReferenceError'),null)
    save('reference',await b.evaluate('window.bedroomReferenceResult'));console.log('independent reference complete; reconstruction uses verified restored 1x field')
   }
  }
  assert.deepEqual(b.errors,[])
 }catch(error){save(`failure-sky-${sky}`,{error:String(error),errors:b.errors});throw error}finally{save(`browser-errors-sky-${sky}`,b.errors);await b.close()}
}
