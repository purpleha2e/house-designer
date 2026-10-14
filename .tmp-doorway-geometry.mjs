// With Vite on port 5180: node tests/browser/interiorRoofTrimRegression.mjs
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './tests/browser/browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${createBrowserTestProfile('interior-roof-trim-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome debugger did not start')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    const request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id)
    if (result.error) request.reject(result.error)
    else request.resolve(result.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 30000)
    pending.set(++id, {
      resolve: result => { clearTimeout(timeout); resolve(result) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin' })
  let ready = false
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    ready = await evaluate(`(()=>{let roofs=0,walls=0;window.roofWallScene?.()?.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-eaves')roofs++;
      if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)walls++});return roofs===8&&walls>=2&&!document.body.innerText.includes('Preparing 3D scene')})()`)
    if (ready) break
  }
  assert.ok(ready, 'Colin House scene must finish loading')
  for (const [name, position, target] of [
    ['rear-exact-door', [1.5,4.3,15.07], [3.07,4.45,15.2]],
    ['rear-exact-door-2', [2.0,4.3,15.1], [3.07,4.4,15.25]],
    ['rear-exact-door-3', [1.5,4.1,15.1], [3.07,4.3,15.3]],
  ]) {
    const result = await evaluate(`(async()=>{
      const {Vector3,Vector2,Raycaster,Box3}=await import('/node_modules/three/build/three.module.js');
      const state=window.roofWallScene(); state.setFrameloop('never');
      state.camera.position.fromArray(${JSON.stringify(position)});
      state.camera.lookAt(...${JSON.stringify(target)});state.camera.updateMatrixWorld();
      state.scene.updateMatrixWorld(true);state.gl.render(state.scene,state.camera);
      const meshes=[];state.scene.traverse(o=>{if(o.isMesh&&o.visible)meshes.push(o)});
      const hits=[];const ray=new Raycaster();
      for(let y=.15;y<=.8;y+=.13)for(let x=-.7;x<=.7;x+=.14){
        ray.setFromCamera(new Vector2(x,y),state.camera);
        const hit=ray.intersectObjects(meshes,false).find(h=>{
          let o=h.object;while(o){if(!o.visible)return false;o=o.parent}return true
        });if(!hit)continue;
        let owner=hit.object;while(owner.parent&&!owner.userData.houseDesignerRole&&!owner.userData.modelId)owner=owner.parent;
        hits.push({screen:[x,y],point:hit.point.toArray(),name:hit.object.name,data:hit.object.userData,owner:owner.userData,
          material:(Array.isArray(hit.object.material)?hit.object.material:[hit.object.material]).map(m=>({name:m.name,color:m.color?.getHexString()}))});
      }
      return {hits};
    })()`)
    writeFileSync(`.tmp-doorway-${name}.json`, JSON.stringify(result,null,2))
    writeFileSync(`.tmp-doorway-${name}.png`, Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    console.log(name, result.hits.filter(h=>JSON.stringify(h).includes('roof')).slice(0,6))
  }
} finally { ws?.close(); child.kill() }


