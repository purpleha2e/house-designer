// With Vite on port 5180: node tests/browser/storeyWallRegression.mjs
// Colin House floor-edge facades remain visible in single-floor editing views.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

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
  console.log('Browser connected')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin-house-v2&materials' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate('!!window.roofWallScene?.()')) break
  }
  await pause(5000)
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(15.10393872272484,4.452308017118821,-7.536561855436431);s.camera.quaternion.set(-0.041401488649580764,0.9043250484426272,0.09018545535725173,0.41514901799094217);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(12000)
  const info = await evaluate(`(()=>{
    const s=window.roofWallScene(); s.scene.updateMatrixWorld(true); const result=[];
    s.scene.traverse(o=>{if(o.userData.houseDesignerRole!=='wall-engine-render')return;
      const p=o.geometry.attributes.position, materials=Array.isArray(o.material)?o.material:[o.material];
      const groups=o.geometry.groups.map(g=>{
        const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
        for(let i=g.start;i<g.start+g.count;i++){const v=o.localToWorld(s.camera.position.clone().fromBufferAttribute(p,i));for(let j=0;j<3;j++){bounds[j]=Math.min(bounds[j],v.getComponent(j));bounds[j+3]=Math.max(bounds[j+3],v.getComponent(j))}}
        return {...g,bounds,color:materials[g.materialIndex]?.color.getHexString(),opacity:materials[g.materialIndex]?.opacity,map:!!materials[g.materialIndex]?.map};
      }); result.push({id:o.userData.floorId,groups,data:o.geometry.userData,r3f:Object.keys(o.__r3f??{}),fiber:o.__r3f?.fiber?Object.keys(o.__r3f.fiber):null});
    });return result;
  })()`)
  writeFileSync('.tmp-colin-patch-info.json',JSON.stringify(info,null,2))
  console.log(await evaluate(`(async()=>{const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');const s=window.roofWallScene();
    return new Raycaster(new Vector3(4.4,3.3,3),new Vector3(0,0,1)).intersectObjects(s.scene.children,true).slice(0,12).map(h=>({role:h.object.userData,point:h.point.toArray(),index:h.face.materialIndex}));})()`))
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');s.camera.position.set(1,4,0);s.camera.lookAt(4.4,3.3,4.75);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  console.log('Patch hit',await evaluate(`(async()=>{const {Raycaster,Vector2}=await import('/node_modules/three/build/three.module.js');const s=window.roofWallScene();const ray=new Raycaster();const rect=s.gl.domElement.getBoundingClientRect();ray.setFromCamera(new Vector2((595-rect.left)/rect.width*2-1,-((590-rect.top)/rect.height*2-1)),s.camera);
    return ray.intersectObjects(s.scene.children,true).slice(0,8).map(h=>({role:h.object.userData,point:h.point.toArray(),index:h.face.materialIndex,normal:h.face.normal.toArray()}));})()`))
  writeFileSync('.tmp-colin-patch-before.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('always');window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,roofs:f.roofs.map(r=>({...r,clipsGeometry:false}))})))})()`)
  await pause(5000)
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');s.camera.position.set(1,4,0);s.camera.lookAt(4.4,3.3,4.75);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-colin-patch-passive.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Saved scene and untextured wall groups')
} finally {ws?.close();child.kill()}
