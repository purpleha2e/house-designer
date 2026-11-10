import fs from 'node:fs'
import os from 'node:os'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/gi-l2-physics'
for(const order of [1,2]){
 const b=await lightingBrowser()
 try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
  await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&gi-l2-house&giSH=${order}&lightingProfile=1`})
  await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
  assert.equal(await b.evaluate('roofWallScene().scene.userData.getLightingField().shOrder'),order)
  const browser=await b.evaluate(`(()=>{const g=roofWallScene().gl.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{userAgent:navigator.userAgent,renderer:g.getParameter(g.RENDERER),unmaskedRenderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null,webgl:g.getParameter(g.VERSION),hardwareConcurrency:navigator.hardwareConcurrency}})()`)
  fs.writeFileSync(`${out}/environment.json`,JSON.stringify({node:process.version,os:os.type()+' '+os.release(),cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,totalSystemMemory:os.totalmem(),browser},null,2))
  await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.l2View=m.softGIView(roofWallScene());return true})`)
  const result={order,camera:await b.evaluate('l2View.camera()'),modes:{}}
  for(const mode of ['authored','white']){
   await b.evaluate(`l2View.capture(${mode==='white'}).then(()=>true)`)
   await b.evaluate('l2View.frames().then(()=>true)') // discard one warmup batch
   result.modes[mode]=await b.evaluate('l2View.frames()')
  }
  await b.evaluate('l2View.dispose();true')
  result.errors=b.errors;assert.deepEqual(b.errors,[])
  fs.writeFileSync(`${out}/house/l${order}-final-steady.json`,JSON.stringify(result,null,2))
  console.log('L'+order,'authored/white GPU frames complete')
 }finally{b.close()}
}
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://localhost:5181/docs/gi-l2-physics/index.html'})
 await b.wait('document.querySelectorAll("img").length===18')
 const checks=[]
 for(const mode of ['authored','white']){
  await b.evaluate(`(()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager');const s=document.querySelector('#mode');s.value='${mode}';s.dispatchEvent(new Event('change'));return true})()`)
  await b.wait('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)',30000)
  checks.push(await b.evaluate(`({mode:'${mode}',images:Array.from(document.images).map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,height:i.naturalHeight}))})`))
 }
 await b.evaluate(`(()=>{const s=document.querySelector('#mode');s.value='authored';s.dispatchEvent(new Event('change'));return true})()`)
 await b.wait('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
 const screenshot=await b.call('Page.captureScreenshot',{format:'png'})
 fs.writeFileSync(`${out}/gallery-review.png`,Buffer.from(screenshot.data,'base64'))
 assert.deepEqual(b.errors,[])
 fs.writeFileSync(`${out}/gallery-review.json`,JSON.stringify({checks,errors:b.errors},null,2))
 console.log('Gallery: all 36 images and both material selections pass')
}finally{b.close()}
