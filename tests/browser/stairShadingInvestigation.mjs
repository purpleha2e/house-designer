// Read-only inspection of the saved stairwell camera; never saves the project.
import { readFileSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'
const project=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
const child=spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0',
 '--no-first-run','--no-default-browser-check','--window-size=1440,1050',
 `--user-data-dir=${createBrowserTestProfile('stair-shading-')}`,'about:blank'],{windowsHide:true})
let ws
try{
 const endpoint=await new Promise((resolve,reject)=>{child.stderr.on('data',d=>{const m=String(d).match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1])});child.on('error',reject)})
 ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map()
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params.exceptionDetails))})
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}))})
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
 const call=(m,p)=>send(m,p,sessionId),pause=ms=>new Promise(r=>setTimeout(r,ms))
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
 await call('Runtime.enable');await call('Page.enable')
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:${JSON.stringify(project)}}`})
  const geometryOnly=process.argv.includes('--geometry')
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5186}/tests/browser/roofWallRegression.html?colin&materials&${geometryOnly?'basic-scene&pbr-materials':'saved-gi'}`})
  if(geometryOnly){
   for(let i=0;i<1800;i++){await pause(100);if(await evaluate(`!!window.roofWallScene?.()?.scene.getObjectByName('model-transform-4754e096-adee-4b9b-aa2e-f6dfec283712')`))break}
   await pause(3000)
   await evaluate(`(async()=>{const s=roofWallScene();s.setFrameloop('never');const {createOpaqueViewportScene}=await import('/src/opaqueViewportScene.ts');window.slabJoinDisplay=createOpaqueViewportScene(s.scene);s.gl.setRenderTarget(null);s.gl.render(slabJoinDisplay.scene,s.camera)})()`)
   console.log('Rays',JSON.stringify(await evaluate(`(async()=>{const {Raycaster,Vector2,Vector3}=await import('/node_modules/.vite/deps/three.js'),s=roofWallScene();s.scene.updateMatrixWorld(true);const meshes=[];s.scene.traverse(o=>{if(!o.isMesh)return;let p=o;while(p){if(!p.visible)return;p=p.parent}const m=Array.isArray(o.material)?o.material:[o.material];if(m.some(m=>m.colorWrite&&m.opacity>0.01))meshes.push(o)});return[[735,300],[660,300],[720,135],[827,605],[430,520],[1090,70]].map(([x,y])=>{const r=new Raycaster();r.setFromCamera(new Vector2(x/1440*2-1,1-y/900*2),s.camera);const hits=r.intersectObjects(meshes).slice(0,8);return{x,y,hits:hits.map(h=>({distance:h.distance,point:h.point.toArray(),name:h.object.name,role:h.object.userData.houseDesignerRole,material:(Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material).name,normal:h.face.normal.toArray()}))}})})()`)))
   writeFileSync('.tmp-viewer-stair-shading-geometry.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
   if(process.argv.includes('--slab-joins')) {

    for(const [name,position,lookAt] of [
     ['below',[5.65,2.05,15.65],[6.22,2.6,16.18]],
     ['above',[5.8,3.1,15.65],[6.22,2.68,16.18]],
    ]) {
     await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(...${JSON.stringify(position)});s.camera.lookAt(...${JSON.stringify(lookAt)});s.camera.updateMatrixWorld();s.gl.setRenderTarget(null);s.gl.render(slabJoinDisplay.scene,s.camera)})()`)
     await pause(100)
     writeFileSync(`.tmp-viewer-stair-slab-${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    }
   }
  }else{
 let ready=false
 for(let i=0;i<4800;i++){await pause(100);const state=await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting');if(i%100===0)console.log('Loading',JSON.stringify(state));if(state?.state==='ready'&&state.volumeSamplingVersion>=1){ready=true;break}}
 if(!ready)throw Error('Saved scene never settled')
 console.log('Ready',await evaluate('JSON.stringify(roofWallScene().scene.userData.indirectLighting)'))
 if(process.argv.includes('--stair-top')) await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(4.05,3.85,14.88);s.camera.lookAt(5.8,1.45,15.6);s.camera.updateMatrixWorld()})()`)

 await evaluate(`(async()=>{const {getIndirectLightingUniforms}=await import('/src/indirectLightingShader');const s=roofWallScene();s.setFrameloop('never');window.inspectShading={state:s,materials:[],lights:[],uniforms:[]};const seen=new Set();s.scene.traverse(o=>{if(o.isLight)inspectShading.lights.push({o,intensity:o.intensity,shadow:o.shadow?.intensity});if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){if(seen.has(m))continue;seen.add(m);inspectShading.materials.push({m,env:m.envMapIntensity});const u=getIndirectLightingUniforms(m);if(u&&!inspectShading.uniforms.includes(u))inspectShading.uniforms.push(u)}});window.captureShading=mode=>{const {state:s,materials,lights,uniforms}=inspectShading;lights.forEach(({o,intensity,shadow})=>{o.intensity=mode==='no-direct'||(mode==='no-local'&&o.isPointLight)||(mode==='no-sun'&&o.isDirectionalLight)?0:intensity;if(o.shadow)o.shadow.intensity=mode==='no-shadows'?0:shadow});materials.forEach(({m,env})=>m.envMapIntensity=mode==='no-reflections'?0:env);uniforms.forEach(u=>u.hdGIProbeStrength.value=mode==='no-gi'?0:1);s.gl.setRenderTarget(null);s.gl.render(s.scene,s.camera)};})()`)
 await pause(300)
 await evaluate(`(()=>{const {state:s,materials,uniforms}=inspectShading;s.gl.render(s.scene,s.camera);inspectShading.roomUniforms=[];materials.forEach(({m})=>{const u=s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled&&!uniforms.includes(u))uniforms.push(u);if(u?.hdRoomLightEnabled)inspectShading.roomUniforms.push({u,value:u.hdRoomLightEnabled.value})});})()`)
 console.log('Uniforms',JSON.stringify(await evaluate(`({count:inspectShading.uniforms.length,enabled:inspectShading.uniforms[0]?.hdGIEnabled.value,volume:inspectShading.uniforms[0]?.hdGIUseVolume.value})`)))
 for(const mode of ['all','no-gi','no-direct','no-shadows','no-local','no-sun','no-reflections','no-mask','disabled-gi','normals']){
  await evaluate(`inspectShading.uniforms.forEach(u=>u.hdGIEnabled.value=1);inspectShading.roomUniforms.forEach(({u,value})=>u.hdRoomLightEnabled.value=value);captureShading('${mode}')`);await pause(100)
  if(mode==='no-mask') await evaluate(`(()=>{inspectShading.roomUniforms.forEach(({u})=>u.hdRoomLightEnabled.value=0);const s=inspectShading.state;s.gl.render(s.scene,s.camera)})()`)
  if(mode==='disabled-gi') await evaluate(`(()=>{inspectShading.uniforms.forEach(u=>u.hdGIEnabled.value=0);const s=inspectShading.state;s.gl.render(s.scene,s.camera)})()`)
  if(mode==='normals') await evaluate(`(async()=>{const {MeshNormalMaterial}=await import('/node_modules/.vite/deps/three.js');const s=inspectShading.state;s.scene.overrideMaterial=new MeshNormalMaterial();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync(`.tmp-viewer-stair-shading-${mode}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Captured',mode)
 }
  }
}finally{ws?.close();child.kill()}

