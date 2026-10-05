// With Vite on port 5180: node tests/browser/roofClippingRegression.mjs
// Disabling a secondary roof's clipping preserves the continuous house facade.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'object-handles-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome did not start its debugger within 30 seconds.')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (pending.has(result.id)) {
      const { resolve, reject } = pending.get(result.id)
      pending.delete(result.id)
      if (result.error) reject(result.error)
      else resolve(result.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error(`CDP ${method} timed out`)),30000)
    pending.set(++id, { resolve: value=>{clearTimeout(timeout);resolve(value)}, reject: error=>{clearTimeout(timeout);reject(error)} })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.capturedWallJobs=[];const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(job,...args){if(job?.volumes&&job?.faces)window.capturedWallJobs.push(job);return post.call(this,job,...args)}`})
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?roof-clipping&materials'})
  for(let i=0;i<60;i++){await pause(500);if(await evaluate('!!window.roofWallScene?.()'))break}
  await evaluate(`(async()=>{
    const p=await(await fetch('/colin_house_v2.json')).json();
    if(${process.argv.includes('--fit')})p.floors.flatMap(f=>f.roofs??[]).find(r=>r.id==='b46c5b90-ecdc-4d0f-a6a5-976b793c7270').fitSupportingWalls=true;
    if(${process.argv.includes('--join')})p.floors.flatMap(f=>f.roofs??[]).find(r=>r.id==='b9c4f4d7-2ea6-4bc2-8b59-481280115509').ridgeEnd={mode:'join',targetRoofId:'b46c5b90-ecdc-4d0f-a6a5-976b793c7270'};
    window.junctionSavedCamera=p.threeDView.camera;
    const {normalizeFloor}=await import('/src/modelPlacement.ts');
    const {modelsById,registerRuntimeModels}=await import('/src/models/modelLibrary.ts');
    registerRuntimeModels(p.modelDefinitions??[]);
    window.updateRegressionFloors(p.floors.map(f=>normalizeFloor(f,modelsById)));
    window.updateRegressionAssignments(p.surfaceAssignments);window.updateRegressionActiveFloor(p.activeFloorId);
  })()`)
  await pause(20000)
  console.log(await evaluate(`(async()=>{const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');return resolveBuildingRoofs(window.regressionFloors).filter(r=>r.roof.asymmetricSides).map(r=>({fit:r.roof.fitSupportingWalls,support:r.supportingWallIds}))})()`))
  writeFileSync('.tmp-fit-jobs.json',JSON.stringify(await evaluate('window.capturedWallJobs')))
  console.log(await evaluate(`(async()=>{const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');const s=window.roofWallScene();s.scene.updateMatrixWorld(true);const meshes=[];s.scene.traverse(o=>{if(o.isMesh&&!o.userData.houseDesignerRole?.includes('pick'))meshes.push(o)});return new Raycaster(new Vector3(4,10,16.35),new Vector3(0,-1,0)).intersectObjects(meshes,false).slice(0,8).map(h=>({role:h.object.userData,p:h.point.toArray()}));})()`))
  await evaluate(`(()=>{const s=window.roofWallScene(),c=window.junctionSavedCamera;s.setFrameloop('never');s.camera.position.set(c.position.x,c.position.y,c.position.z);s.camera.quaternion.set(c.quaternion.x,c.quaternion.y,c.quaternion.z,c.quaternion.w);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-roof-junction-after.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  const data=await evaluate(`(()=>{const s=window.roofWallScene();const result=[];
    s.scene.traverse(o=>{if(!o.userData.houseDesignerRole)return;
      const p=o.geometry?.attributes.position;if(!p)return;result.push({role:o.userData.houseDesignerRole,userData:o.userData,
        positions:Array.from(p.array),indices:o.geometry.index?Array.from(o.geometry.index.array):null,normals:Array.from(o.geometry.attributes.normal.array),matrix:o.matrixWorld.elements})});return result})()`)
  writeFileSync('.tmp-roof-junction-geometry.json',JSON.stringify(data))
  const view=await evaluate(`(()=>{const s=window.roofWallScene(),r=s.gl.domElement.getBoundingClientRect();return {
    bounds:{x:r.x,y:r.y,width:r.width,height:r.height},projection:s.camera.projectionMatrix.elements,
    world:s.camera.matrixWorld.elements,inverse:s.camera.matrixWorldInverse.elements}})()`)
  writeFileSync('.tmp-roof-junction-view.json',JSON.stringify(view))
  for(const [name,position,target] of [['west',[-6,9,17],[2,5.5,13.5]],['south',[4,9,24],[2,5.5,15]],['northwest',[-7,7.5,6],[0,5,12]]]){
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(...${JSON.stringify(position)});s.camera.lookAt(...${JSON.stringify(target)});s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
    writeFileSync(`.tmp-roof-junction-${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    writeFileSync(`.tmp-roof-junction-${name}-view.json`,JSON.stringify(await evaluate(`(()=>{const s=window.roofWallScene(),r=s.gl.domElement.getBoundingClientRect();return {bounds:{x:r.x,y:r.y,width:r.width,height:r.height},projection:s.camera.projectionMatrix.elements,world:s.camera.matrixWorld.elements,inverse:s.camera.matrixWorldInverse.elements}})()`)))
  }
  console.log('Saved roof corner geometry and view')
}finally{ws?.close();child.kill()}


