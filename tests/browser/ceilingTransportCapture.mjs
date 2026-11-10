import fs from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const candidate=process.argv.includes('--exterior-sky-candidate'),out=candidate?'docs/ceiling-transport/exterior-sky-candidate':'docs/ceiling-transport',audit=JSON.parse(fs.readFileSync('docs/ceiling-transport/baseline-audit.json')),project=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/project.json.gz')))
fs.mkdirSync(out,{recursive:true})
project.sunPosition.strength=1;project.indirectLighting.settings.skyStrength=1
project.indirectLighting.projectKey='ceiling-transport-force-fresh'
fs.writeFileSync('tmp/ceiling-transport-project.json',JSON.stringify(project))
const b=await lightingBrowser(),save=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=(url,...args)=>nativeFetch(typeof url==='string'&&url==='/tmp/bedroom-daylight-project.json'?'/tmp/ceiling-transport-project.json':url,...args);`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&ceiling-transport&lightingProfile=1'})
 await b.wait('!!window.roofWallScene?.()?.scene.userData.getLightingField',600000)
 await b.evaluate(`import('/tests/browser/ceilingTransportTrace.ts').then(m=>{window.ceilingTrace=m.ceilingTransportTrace(roofWallScene(),${JSON.stringify([...new Set([...audit.selected,321,442,332,453])])});return true})`)
 console.log('transport tracing installed')
 await b.wait(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 const trace=await b.evaluate('ceilingTrace.state()');assert.deepEqual(trace.passes.map(p=>p.pass),[1,2,3,4,5,6]);save('production-trace',trace)
 fs.writeFileSync(`${out}/completed-cache.json.gz`,gzipSync(JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()'))))
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`);await b.wait(`!!document.querySelector('[aria-label="Soft floor GI radius"]')`)
 await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Soft floor GI radius"]');e.value='10';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
 await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`,300000);await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
 const measured=await b.evaluate(`import('/tests/browser/bedroomDaylight.ts').then(m=>m.measureBedroom(roofWallScene()))`);save('baseline-measured',measured)
 assert.equal(measured.order,1);assert.equal(measured.probeCount,301);assert.equal(measured.filter.cm,10);assert.equal(measured.calibration.settings.diffuseBounces,6)
 assert.equal(measured.calibration.settings.daylightBounceStrength,3.5);assert.equal(measured.calibration.fill,.18)
 const error=measured.points.map((p,i)=>p.irradiance.map((v,c)=>v-audit.points[i].storedField[c]));save('baseline-reproduction',{error,max:Math.max(...error.flat().map(Math.abs)),errors:b.errors})
 if(!candidate)assert.ok(error.flat().every(v=>Math.abs(v)<.001),'Fresh transport must reproduce saved baseline')
 save('profile',await b.evaluate('({gi:roofWallScene().scene.userData.indirectLighting,profile:roofWallScene().scene.userData.getLightingPerformance()})'))
 if(process.argv.includes('--incremental')){
  const updates=[]
  for(const strength of [0,1]){
   await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`);await b.wait(`!!document.querySelector('[aria-label="Sun strength"]')`)
   const before=await b.evaluate(`(()=>{const s=roofWallScene();window.ceilingUpdateAt=performance.now();const state={generation:s.scene.userData.indirectLighting.generation,profile:s.scene.userData.getLightingPerformance().version,programs:s.gl.info.programs.length};const e=document.querySelector('[aria-label="Sun strength"]');e.value='${strength}';e.dispatchEvent(new Event('change',{bubbles:true}));return state})()`)
   await b.wait(`regressionSunPosition.strength===${strength}`)
   await b.wait(`roofWallScene().scene.userData.indirectLighting.generation>${before.generation}||roofWallScene().scene.userData.getLightingPerformance().version>${before.profile}`)
   await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
   await b.wait(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.softFloorGI?.state==='ready'})()`,600000)
   updates.push(await b.evaluate(`({strength:${strength},before:${JSON.stringify(before)},elapsedMs:performance.now()-ceilingUpdateAt,programs:roofWallScene().gl.info.programs.length,profile:roofWallScene().scene.userData.getLightingPerformance()})`))
  }
  const restored=await b.evaluate(`import('/tests/browser/bedroomDaylight.ts').then(m=>m.measureBedroom(roofWallScene()))`)
  const max=Math.max(...restored.points.flatMap((p,i)=>p.irradiance.map((v,c)=>Math.abs(v-measured.points[i].irradiance[c]))));save('incremental',{updates,restored,maxDifference:max});assert.ok(max<.001,'Incremental relighting must restore the full-bake result')
 }
 assert.deepEqual(b.errors,[]);console.log(candidate?'six candidate passes captured':'six passes captured; baseline verified')
}catch(e){save('capture-failure',{error:String(e),errors:b.errors});throw e}finally{b.close()}
