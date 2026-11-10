import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/gi-l2-physics/house',bed='5e6c5ebd-32a2-4b47-9f48-9ad7c124d2f5'
for(const order of [1,2]){
 const b=await lightingBrowser(),save=(name,data)=>fs.writeFileSync(`${out}/l${order}-${name}.json`,JSON.stringify(data,null,2))
 try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
  await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&gi-l2-house&giSH=${order}&lightingProfile=1`})
  const ready=`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`
  await b.wait(ready,600000);assert.equal(await b.evaluate('roofWallScene().scene.userData.getLightingField().shOrder'),order)
  save('cold-repeat',await b.evaluate('roofWallScene().scene.userData.getLightingPerformance()'));console.log('L'+order,'cold repeat ready')
  await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.l2View=m.softGIView(roofWallScene());return true})`)
  save('original-window-camera',await b.evaluate('l2View.camera()'))
  for(const neutral of [false,true]){await b.evaluate(`l2View.capture(${neutral}).then(()=>true)`);const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});fs.writeFileSync(`${out}/l${order}-original-window-${neutral?'white':'authored'}.png`,Buffer.from(png.data,'base64'))}
  save('original-window-steady',await b.evaluate('l2View.frames()'));await b.evaluate('l2View.dispose();true')
  if(order===1)save('path-reference',await b.evaluate(`import('/tests/browser/giL2HouseView.ts').then(m=>m.giL2HouseReference(roofWallScene()))`))
  for(const [name,code] of [
   ['sun-cold',`window.originalSun={...regressionSunPosition};updateRegressionSunPosition({...originalSun,azimuth:originalSun.azimuth+.03})`],
   ['sun-warm',`updateRegressionSunPosition({...originalSun,azimuth:originalSun.azimuth+.06})`],
   ['sun-restore',`updateRegressionSunPosition(originalSun)`],
   ['furniture-cold',`window.originalFloors=regressionFloors;updateRegressionFloors(regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id==='${bed}'?{...m,position:{...m.position,x:m.position.x+.1}}:m)})))`],
   ['furniture-warm',`updateRegressionFloors(originalFloors)`],
  ]){
   const before=await b.evaluate(`(()=>{const s=roofWallScene();window.updateStarted=performance.now();window.updateVersion=s.scene.userData.getLightingPerformance().version;window.updateGeneration=s.scene.userData.indirectLighting.generation;${code};return{version:updateVersion,generation:updateGeneration}})()`)
   await b.wait(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return s.scene.userData.getLightingPerformance().version>${before.version}||g.generation>${before.generation}||g.pendingUpdate||g.pendingLighting})()`,30000)
   await b.wait(ready,600000)
   save(name,await b.evaluate(`(()=>{const s=roofWallScene();return{elapsedMs:performance.now()-updateStarted,gi:s.scene.userData.indirectLighting,profile:s.scene.userData.getLightingPerformance(),order:s.scene.userData.getLightingField().shOrder}})()`));console.log('L'+order,name,'complete')
  }
  assert.deepEqual(b.errors,[])
 }catch(error){save('updates-failure',{error:String(error),errors:b.errors});throw error}finally{save('updates-errors',b.errors);b.close()}
}
