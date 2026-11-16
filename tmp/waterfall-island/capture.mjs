import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const browser=await lightingBrowser()
try{
 await browser.call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false})
 await browser.call('Page.navigate',{url:'http://127.0.0.1:5187/tests/browser/waterfallIslandPreview.html'})
 await browser.wait('!!window.islandPreview || !!window.islandPreviewError')
 assert.equal(await browser.evaluate('window.islandPreviewError'),undefined)
 const stats=await browser.evaluate('(({bounds,meshes,triangles,textures})=>({bounds,meshes,triangles,textures}))(islandPreview)')
 assert.equal(stats.meshes,5);assert.equal(stats.textures.length,1);assert.equal(stats.textures[0].compressed,true)
 const check=await browser.evaluate(`(async()=>{
   const {modelsById}=await import('/src/models/modelLibrary.ts');
   const {THREE:{Raycaster,Vector3}}=await import('/tests/browser/waterfallIslandPreview.js');
   const definition=modelsById.get('waterfall-shaker-island');
   islandPreview.model.updateMatrixWorld(true);
   const hits=new Raycaster(new Vector3(.35,2,.3),new Vector3(0,-1,0)).intersectObject(islandPreview.model,true);
   return {name:definition?.name,source:definition?.sourceUrl,width:definition?.width,
     firstSinkHitY:hits[0]?.point.y,thumbnailStatus:(await fetch(definition.previewUrl)).status};
 })()`)
 assert.equal(check.name,'Ivory Waterfall Shaker Island');assert.equal(check.width,2.4)
 assert.equal(check.thumbnailStatus,200);assert.ok(check.firstSinkHitY>.70&&check.firstSinkHitY<.74,'Sink opening reaches its recessed bowl')
 await new Promise(r=>setTimeout(r,1500))
 for(const [name,position]of [['front',[-3.7,2.45,4.15]],['back',[3.5,2.6,-4]],['sink',[1.5,3.2,2.4]]]){
   await browser.evaluate(`islandPreview.camera.position.set(...${JSON.stringify(position)});islandPreview.controls.update();true`)
   await new Promise(r=>setTimeout(r,350))
   const shot=await browser.call('Page.captureScreenshot',{format:'png'})
   writeFileSync(`tmp/waterfall-island/${name}.png`,Buffer.from(shot.data,'base64'))
 }
 assert.deepEqual(browser.errors,[])
 writeFileSync('tmp/waterfall-island/preview-report.json',JSON.stringify({stats,check},null,2));console.log({stats,check})
}finally{browser.close()}
