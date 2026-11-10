import fs from 'node:fs'
import crypto from 'node:crypto'
import {gzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/gi-l2-physics/house';fs.mkdirSync(out,{recursive:true})
const original=JSON.parse(fs.readFileSync('docs/bedroom-sun-audit/baseline.json')),source=fs.readFileSync('colin_house_v2.json'),project=JSON.parse(source)
project.sunPosition=original.sun;project.threeDView.camera=original.camera;project.indirectLighting={...project.indirectLighting,settings:original.settings,projectKey:'gi-l2-force-fresh'}
const frozen=JSON.stringify(project);fs.writeFileSync('tmp/gi-l2-house-project.json',frozen)
fs.writeFileSync(`${out}/inputs.json`,JSON.stringify({sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),frozenSHA256:crypto.createHash('sha256').update(frozen).digest('hex'),original,notes:'Current authored geometry/materials frozen once; original screenshot camera and lighting metadata restored only in isolated fixture. Saved GI deliberately invalidated. Original historical project bytes are unavailable.'},null,2))
const xyz=o=>[o.x,o.y,o.z],q=o=>[o.x,o.y,o.z,o.w]
const door=JSON.parse(fs.readFileSync('docs/door-confidence/original-capture.json')).camera
const cameras=[
 {id:'bedroom-window',position:xyz(original.camera.position),quaternion:q(original.camera.quaternion),fov:65},
 {id:'bedroom-sunlit-wall',position:[2.15,4.0,13.7],lookAt:[-.7,3.9,11.8],fov:65},
 {id:'bedroom-opposite-corner',position:[2.2,4.15,11.5],lookAt:[.1,3.8,13.7],fov:65},
 {id:'kitchen',position:[4.65,1.6,9.95],lookAt:[2.1,1.25,4.95],fov:60},
 {id:'staircase',position:[3.5,2.4,16.8],lookAt:[4.6,.05,15.25],fov:65},
 {id:'doors',position:door.position,quaternion:door.quaternion,fov:45},
 {id:'hallway',position:[3.6,1.6,16],lookAt:[4.1,1.3,11],fov:65},
 {id:'living-room',position:[7.9,1.6,12],lookAt:[6.3,1.1,16],fov:65},
]
for(const order of [1,2]){
 const b=await lightingBrowser(),save=(name,data)=>fs.writeFileSync(`${out}/l${order}-${name}.json`,JSON.stringify(data,null,2))
 try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
  const nav=await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&gi-l2-house&giSH=${order}&lightingProfile=1`});assert.ok(!nav.errorText,nav.errorText)
  const ready=`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`
  await b.wait(ready,600000);console.log('L'+order,'fresh house ready')
  save('baseline',await b.evaluate(`(()=>{const s=roofWallScene(),f=s.scene.userData.getLightingField();return{selection:s.scene.userData.indirectSHExperiment,gi:s.scene.userData.indirectLighting,profile:s.scene.userData.getLightingPerformance(),exposure:s.gl.toneMappingExposure,fill:s.scene.userData.getIndirectUniforms().hdGIIndoorFill.value,settings:s.scene.userData.getBakedIndirectLighting()?.settings,order:f.shOrder,probes:f.probes.length}})()`))
  assert.equal(await b.evaluate('roofWallScene().scene.userData.getLightingField().shOrder'),order)
  save('receivers',await b.evaluate(`import('/tests/browser/giL2HouseView.ts').then(m=>m.giL2HousePoints(roofWallScene()))`))
  await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.l2View=m.softGIView(roofWallScene());return true})`)
  for(const camera of cameras){
   save(camera.id+'-camera',await b.evaluate(`l2View.setCamera(${JSON.stringify(camera)})`))
   for(const white of [false,true]){
    const frame=await b.evaluate(`l2View.capture(${white})`),name=`l${order}-${camera.id}-${white?'white':'authored'}`
    fs.writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
    const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});fs.writeFileSync(`${out}/${name}.png`,Buffer.from(png.data,'base64'))
    console.log('capture',name)
   }
  }
  await b.evaluate(`l2View.setCamera(${JSON.stringify(cameras[0])});true`);save('steady-frames',await b.evaluate('l2View.frames()'))
  await b.evaluate('l2View.dispose();true')
  assert.deepEqual(b.errors,[])
 }catch(error){save('failure',{error:String(error),errors:b.errors});throw error}finally{save('browser-errors',b.errors);b.close()}
}
