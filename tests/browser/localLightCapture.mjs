import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gzipSync,gunzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic flag required')
const out='docs/local-light',cache=JSON.parse(fs.readFileSync('docs/door-confidence/original-field.json')),door=JSON.parse(fs.readFileSync('docs/door-confidence/original-capture.json')).camera
const projectPath=`${out}/door-project.json.gz`
if(!fs.existsSync(projectPath))fs.writeFileSync(projectPath,gzipSync(fs.readFileSync('tmp/render-artefacts/project.json')))
const project=JSON.parse(gunzipSync(fs.readFileSync(projectPath)));project.indirectLighting=cache
fs.writeFileSync('tmp/local-light-door-project.json',JSON.stringify(project))
const b=await lightingBrowser(),save=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=(url,...args)=>nativeFetch(typeof url==='string'&&url==='/tmp/render-artefacts/project.json'?'/tmp/local-light-door-project.json':url,...args);window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}};addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.append(style)})`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-gi&artefact-audit&diagnostic-local-light'})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 save('capture-loaded-state',await b.evaluate('(()=>{const s=roofWallScene(),c=s.scene.userData.getBakedIndirectLighting();return{gi:s.scene.userData.indirectLighting,geometryKey:c.geometryKey,assetKey:c.assetKey,settings:c.settings,coefficients:c.coefficients,door:s.scene.getObjectByName("model-transform-a05cbb5f-52ea-4231-94ef-19667bc1c609")?.matrixWorld.toArray()}})()'))
 assert.deepEqual(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting().coefficients'),cache.coefficients,'No recomputed field may enter screenshot comparisons')
 assert.equal(await b.evaluate('roofWallScene().scene.userData.indirectLighting.source'),'saved')
 await b.evaluate(`import('/tests/browser/localLightView.ts').then(m=>{window.localView=m.localLightView(roofWallScene());return true})`)
 const uploads=[],frames=[]
 for(const camera of [{id:'door',position:door.position,quaternion:door.quaternion,fov:45},{id:'staircase',position:[3.5,2.4,16.8],lookAt:[4.6,.05,15.25],fov:65}]){
  save(camera.id+'-camera',await b.evaluate(`localView.setCamera(${JSON.stringify(camera)})`))
  for(const mode of ['baseline','conservative','masked','baseline-10cm','conservative-10cm','masked-10cm']){
   uploads.push(await b.evaluate(`localView.setLocalMode('${mode}')`));await b.evaluate('localView.capture(false).then(r=>({camera:r.camera,generationUnchanged:r.generationUnchanged,coefficientsUnchanged:r.coefficientsUnchanged,originalFloorUnchanged:r.originalFloorUnchanged}))')
   const clip=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip})
   fs.writeFileSync(`${out}/${camera.id}-${mode}.png`,Buffer.from(png.data,'base64'))
   if(camera.id==='door')frames.push({mode,frames:await b.evaluate('localView.frames()')})
   console.log('captured',camera.id,mode)
  }
 }
 save('gpu-performance',{uploads,frames,state:await b.evaluate('localView.state()'),errors:b.errors});assert.deepEqual(b.errors,[]);await b.evaluate('localView.dispose();true')
}catch(e){save('capture-failure',{error:String(e),errors:b.errors});throw e}finally{b.close()}
