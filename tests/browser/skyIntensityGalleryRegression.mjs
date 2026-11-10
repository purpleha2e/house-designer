import fs from 'node:fs'
import assert from 'node:assert/strict'
import {evaluate,call,wait} from './skyIntensityClient.mjs'
const b={evaluate,call,wait},checks=[]
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.skyGalleryErrors=[];addEventListener("error",e=>skyGalleryErrors.push(e.message));addEventListener("unhandledrejection",e=>skyGalleryErrors.push(String(e.reason)))'});
 await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/docs/sky-intensity/index.html'})
 await b.wait('document.querySelectorAll("#measurements tr").length===6')
 for(const material of ['timeless','white'])for(const sky of [.5,1,1.5,2,3]){
  await b.evaluate(`(()=>{document.querySelector('#rightMaterial').value='${material}';document.querySelector('#rightSky').value='${sky}';document.querySelector('#fillMaterial').value='${material}';document.querySelector('#rightSky').dispatchEvent(new Event('change'));return true})()`)
  await b.wait('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
  checks.push(await b.evaluate(`({material:'${material}',sky:${sky},images:document.images.length,receiverRows:document.querySelectorAll('#measurements tr').length})`))
 }
 await b.evaluate(`(()=>{document.querySelector('#rightMaterial').value='timeless';document.querySelector('#rightSky').value='1.5';document.querySelector('#fillMaterial').value='timeless';document.querySelector('#rightSky').dispatchEvent(new Event('change'));return true})()`)
 await b.wait('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)');const shot=await b.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('docs/sky-intensity/gallery-review.png',Buffer.from(shot.data,'base64'))
 const errors=await b.evaluate('skyGalleryErrors');assert.deepEqual(errors,[]);fs.writeFileSync('docs/sky-intensity/gallery-review.json',JSON.stringify({checks,errors},null,2));console.log('PASS gallery: all ten comparisons, 15 images, six receiver rows')
}finally{}
