import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'loft-regression-'))
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
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
    pending.set(++id, { resolve, reject })
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
  await call('Page.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?springfield-14&materials' })
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o => o.type === 'Group')`)) break
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await evaluate(`!document.body.innerText.includes('Preparing 3D scene')`)) break
  }
  for (let attempt = 0; attempt < 45; attempt++) {
    if (await evaluate(`(() => { let ready=false; window.roofWallScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-top' && o.userData.roofId==='8a8e0ba9-b840-4a5d-9345-a691c6309402') ready=!!o.material.map}); return ready })()`)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  console.log(await evaluate(`JSON.stringify({slabs:window.houseDesignerWallRenderDebug?.ceilingSlabs(), camera:window.roofWallScene?.()?.camera.position.toArray()})`))
  console.dir(await evaluate(`(async () => {
    const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');
    const scene=window.roofWallScene().scene, objects=[];
    scene.updateMatrixWorld(true);
    scene.traverse(o=>{if(o.isMesh && ['wall-engine-render','roof-infill','ceiling-slab-solid'].includes(o.userData.houseDesignerRole)) objects.push(o)});
    return [4.9,5.1,5.4].map(y=>{
      const hit=new Raycaster(new Vector3(3,y,9),new Vector3(1,0,0)).intersectObjects(objects,false)[0];
      const mat=hit && (Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material);
      return {y,point:hit?.point.toArray(),object:hit?.object.userData,color:mat?.color?.getHexString(),map:mat?.map?.source?.data?.src};
    });
  })()`), { depth: null })
  console.dir(await evaluate(`(async () => {
    const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');
    const objects=[]; window.roofWallScene().scene.traverse(o=>{if(o.isMesh && !String(o.userData.houseDesignerRole).includes('pick'))objects.push(o)});
    return [11.3,11.4,11.5,11.6,11.7,11.8].map(z=>({z,hits:new Raycaster(new Vector3(10,12,z),new Vector3(0,-1,0)).intersectObjects(objects,false).filter(h=>h.point.y>4.95).map(h=>({point:h.point.toArray(),data:h.object.userData,name:h.object.name,material:Array.isArray(h.object.material)?'array':h.object.material.color?.getHexString()}))}));
  })()`), { depth: null })
  await evaluate(`(() => { const s=window.roofWallScene(); s.camera.position.set(-3,10,18); s.camera.lookAt(10,4.5,8); s.invalidate(); return true })()`)
  await new Promise(resolve => setTimeout(resolve, 1500))
  console.dir(await evaluate(`(async () => {
    const {Raycaster,Vector2}=await import('/node_modules/three/build/three.module.js');
    const s=window.roofWallScene(), b=s.gl.domElement.getBoundingClientRect(), objects=[];
    s.scene.updateMatrixWorld(true);
    s.scene.traverse(o=>{if(o.isMesh)objects.push(o)});
    return [[760,462],[754,465],[504,540],[490,529]].map(([x,y])=>{
      const ray=new Raycaster(); ray.setFromCamera(new Vector2((x-b.left)/b.width*2-1,1-(y-b.top)/b.height*2),s.camera);
      return {pixel:[x,y],hits:ray.intersectObjects(objects,false).filter(h=>{
        const mat=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material;
        return h.object.visible && mat.visible && mat.colorWrite && !String(h.object.userData.houseDesignerRole).includes('pick');
      }).slice(0,5).map(h=>{
        const m=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material;
        return {point:h.point.toArray(),data:h.object.userData,color:m.color?.getHexString(),map:m.map?.uuid,material:m.uuid,depthTest:m.depthTest,polygonOffset:m.polygonOffsetFactor};
      })};
    });
  })()`), { depth: null })
  const shot = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.argv[2] ?? '.tmp-loft.png', Buffer.from(shot.data, 'base64'))
  if (process.argv[3]) console.log(await evaluate(process.argv[3]))
} finally {
  ws?.close()
  child.kill()
}
