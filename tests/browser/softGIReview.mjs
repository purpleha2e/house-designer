import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/docs/soft-gi/index.html'})
 await b.wait(`Array.from(document.images).length===2&&Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)`)
 const screenshot=await b.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('docs/soft-gi/comparison-page.png',Buffer.from(screenshot.data,'base64'))
 const views=['door','staircase','kitchen-junction','kitchen-windows','bedroom','limited-daylight']
 for(const view of views)for(const material of ['white','authored'])for(const radius of ['5cm','10cm','20cm'])for(const difference of [false,true]){
  await b.evaluate(`(()=>{document.getElementById('view').value='${view}';document.getElementById('material').value='${material}';document.getElementById('difference').checked=${difference};document.querySelector('[data-radius="${radius}"]').click();return true})()`)
  await b.wait(`Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)`)
 }
 const worker=await b.evaluate(`import('/tests/browser/softGIWorkerRegression.ts').then(m=>m.checkSoftGIWorker())`)
 fs.writeFileSync('docs/soft-gi/app-worker.json',JSON.stringify(worker,null,2));assert(worker.allBitExact)
 assert.deepEqual(b.errors,[]);console.log('PASS comparison page images and real worker: local coefficient edits, moved thin door, two storeys, rapid radii, immutable source')
}finally{b.close()}
