import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const out=process.argv[2]??'docs/colin-contact-fix/iteration-7',port=process.argv[3]??5180
const cameras=JSON.parse(readFileSync('docs/colin-contact-shading/verified/cameras.json')).filter(c=>c.id!=='sofa-kitchen'),results={}
// Separate browsers and scene geometries include actual refinement overhead.
// The two cases run sequentially on the same hardware.
for(const mode of ['legacy','local']){
 const b=await lightingBrowser()
 try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
  const cache=JSON.parse(readFileSync(mode==='local'?`${out}/field-cache.json`:'docs/gi-spatial-accuracy/baseline/field-cache.json'))
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&giContacts=${mode==='local'?'local':'off'}&saved-gi`})
  await b.wait('!!window.roofWallScene?.()',300000)
  await b.wait(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,900000)
  await b.evaluate(`(async()=>{const s=roofWallScene(),style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate();window.contact=(await import('/tests/browser/giSpatialHouse.ts')).spatialHouseView(s);const probes=s.scene.getObjectByName('indirect-lighting-probes');if(probes)probes.visible=false})()`)
  const metadata=await b.evaluate(`(()=>{const s=roofWallScene(),roots=[];s.scene.traverse(o=>{if(o.userData.indirectReceiverSafety)roots.push(o.userData.indirectReceiverSafety)});const u=s.scene.userData.getIndirectUniforms();return{source:s.scene.userData.indirectLighting.source,contacts:s.scene.userData.indirectContactReceivers,mode:u.hdGIContactMode.value,receiverBytes:roots.reduce((sum,r)=>sum+r.bytes,0),contactTextureBytes:u.hdGIContactTexture.value.image.data.byteLength}})()`)
  assert.equal(metadata.source,'saved','measure restored converged lighting')
  results[mode]={metadata,views:{}}
  for(const camera of cameras){
   await b.evaluate(`contact.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`)
   results[mode].views[camera.id]=await b.evaluate('contact.performance()')
   writeFileSync(`${out}/performance.json`,JSON.stringify(results,null,2));console.log('TIMED',mode,camera.id)
  }
  assert.deepEqual(b.errors,[])
 }finally{b.close()}
}
for(const camera of cameras){const a=results.legacy.views[camera.id].cases['unchanged normal renderer'],b=results.local.views[camera.id].cases['unchanged normal renderer'],mean=c=>(c.before.gpuExecutionMeanMs+c.changed.gpuExecutionMeanMs+c.after.gpuExecutionMeanMs)/3;console.log(camera.id,'GPU delta ms',mean(b)-mean(a))}
