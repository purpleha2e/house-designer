import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync}from'node:fs'
import {lightingBrowser}from'./lightingHarness.mjs'
const b=await lightingBrowser(),out=process.argv[3]??'docs/gi-kitchen-diagnostics/interpolation-before',reuse=process.argv.includes('--reuse'),verify=process.argv.includes('--verify')
mkdirSync(out,{recursive:true})
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync('tmp/gi-kitchen-baseline-cache.json','utf8')}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi&preview-lighting`})
  await b.wait(`!!window.roofWallScene?.()&&roofWallScene().scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting.state==='ready'`,240000)
  await b.evaluate(`(async()=>{const s=roofWallScene();s.setFrameloop('never');window.interpolationBeforeFloors=JSON.parse(JSON.stringify(regressionFloors));window.interpolationSource=await import('/src/indirectVisibility.ts');window.interpolationFields=await import('/src/indirectLighting.ts');window.interpolationProfileWorker=new Worker(new URL('/tests/browser/interpolationProfile.worker.ts',location.href),{type:'module'});window.runInterpolationProfile=(reuse,verify,changes)=>new Promise((resolve,reject)=>{const field=s.scene.userData.getLightingField();interpolationProfileWorker.onmessage=e=>e.data.ok?resolve(e.data):reject(Error(e.data.error));interpolationProfileWorker.onerror=e=>reject(Error(e.message));interpolationProfileWorker.postMessage({field:interpolationFields.serializeIndirectField(field),coefficients:field.coefficients,geometry:interpolationSource.snapshotIndirectGeometry(s.scene),reuse,verify,changes})})})()`)
  const initial=await b.evaluate('runInterpolationProfile(false,false)');writeFileSync(`${out}/initial.json`,JSON.stringify(initial,null,2));console.log('INITIAL',JSON.stringify(initial))
  await b.evaluate(`roofWallScene().setFrameloop('always');regressionMoveWindow(.25)`)
  await new Promise(r=>setTimeout(r,800))
  await b.wait(`(async()=>{const w=await import('/src/wallEngine/wallRoofClipClient.ts'),r=await import('/src/roofAssemblyClient.ts'),s=roofWallScene();return !w.isWallClippingPending()&&!r.isRoofAssemblyPending()&&!s.scene.userData.shaderWarmupPending&&!s.scene.userData.indirectScanPending})()`,120000)
  await new Promise(r=>setTimeout(r,500))
  const changes=await b.evaluate(`(async()=>{roofWallScene().setFrameloop('never');const m=await import('/src/indirectLightingZones.ts');return m.indirectLocalChanges(JSON.stringify({floors:interpolationBeforeFloors,modelAssetVersion:1}),JSON.stringify({floors:regressionFloors,modelAssetVersion:1}))})()`);assert.ok(changes?.length)
  const edit=await b.evaluate(`runInterpolationProfile(${reuse},${verify},${JSON.stringify(changes)})`);writeFileSync(`${out}/window-edit.json`,JSON.stringify({changes,...edit},null,2));console.log('WINDOW',JSON.stringify(edit))
  if(verify)assert.equal(edit.verification.differentHalfFloatValues,0,'incremental interpolation is byte-identical to fresh geometry visibility')
  assert.deepEqual(b.errors,[]);console.log('PASS real Colin interpolation profile, fixed scene and 0.25 m window edit')
}finally{b.close()}
