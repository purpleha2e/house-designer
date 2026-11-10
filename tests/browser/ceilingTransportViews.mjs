import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gzipSync,gunzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const candidate=process.argv.includes('--exterior-sky-candidate'),out='docs/ceiling-transport'+(candidate?'/exterior-sky-candidate':''),cache=JSON.parse(gunzipSync(fs.readFileSync(`${out}/completed-cache.json.gz`))),project=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/project.json.gz')))
project.sunPosition.strength=1;project.indirectLighting=cache
fs.writeFileSync('tmp/ceiling-transport-view-project.json',JSON.stringify(project))
const original=JSON.parse(fs.readFileSync('docs/bedroom-daylight/sun-1-window-camera.json'))
const cameras=[{...original,id:'bedroom-window'},
 {id:'bedroom-sunlit-wall',position:[2.15,4,13.7],lookAt:[-.7,3.9,11.8],fov:65},
 {id:'bedroom-opposite-corner',position:[2.2,4.15,11.5],lookAt:[.1,3.8,13.7],fov:65},
 {id:'kitchen',position:[4.65,1.6,9.95],lookAt:[2.1,1.25,4.95],fov:60},
 {id:'living-room',position:[2.7,1.6,14.1],lookAt:[.2,1.1,11.5],fov:65}]
const b=await lightingBrowser(),save=(n,d)=>fs.writeFileSync(`${out}/${n}.json`,JSON.stringify(d,null,2))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeFetch=window.fetch;window.fetch=(url,...args)=>nativeFetch(typeof url==='string'&&url==='/tmp/bedroom-daylight-project.json'?'/tmp/ceiling-transport-view-project.json':url,...args);`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&lightingProfile=1'})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 assert.deepEqual(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting().coefficients'),cache.coefficients)
 assert.equal(await b.evaluate('roofWallScene().scene.userData.indirectLighting.source'),'saved')
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`);await b.wait(`!!document.querySelector('[aria-label="Soft floor GI radius"]')`)
 await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Soft floor GI radius"]');e.value='10';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
 await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`,300000)
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
 save('view-measured',await b.evaluate(`import('/tests/browser/bedroomDaylight.ts').then(m=>m.measureBedroom(roofWallScene()))`))
 await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.append(style);return true})()`)
 await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.ceilingView=m.softGIView(roofWallScene());return true})`)
 for(const camera of cameras){
  save(camera.id+'-camera',await b.evaluate(`ceilingView.setCamera(${JSON.stringify(camera)})`))
  for(const white of [false,true]){
   // The normal renderer binds this display-only filter around composer.render.
   // A manual diagnostic render must use the same binding explicitly.
   const frame=await b.evaluate(`(async()=>{const restore=roofWallScene().scene.userData.bindSoftFloorGI();try{return await ceilingView.capture(${white})}finally{restore()}})()`),name=camera.id+(white?'-white':'-authored')
   fs.writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
   const clip=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip})
   fs.writeFileSync(`${out}/${name}.png`,Buffer.from(png.data,'base64'));console.log('view',name)
  }
 }
 await b.evaluate(`ceilingView.setCamera(${JSON.stringify(cameras[0])});true`)
 save('gpu-frames',await b.evaluate('(async()=>{const restore=roofWallScene().scene.userData.bindSoftFloorGI();try{return await ceilingView.frames()}finally{restore()}})()'))
 save('view-state',await b.evaluate('ceilingView.state()'));assert.deepEqual(b.errors,[]);save('view-browser-errors',b.errors)
 await b.evaluate('ceilingView.dispose();true')
}finally{b.close()}
