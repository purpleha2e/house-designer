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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?floor-test&edit-floor' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate('!!window.updateRegressionFloors && !!window.roofWallScene?.()')) break
  }
  console.log('Scene initialized')
  await evaluate(`(async()=>{
    const floors=await(await fetch('/tests/fixtures/storeyWallRegression.json')).json();
    window.storeyTestFloors=floors;window.updateRegressionFloors(floors);window.updateRegressionActiveFloor(floors[1].id);
  })()`)
  console.log('Loaded two-storey fixture')
  const snapshot = () => evaluate(`(()=>{
    const s=window.roofWallScene();const floors=window.storeyTestFloors;
    let lower; s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.userData.floorId===floors[0].id)lower=o});
    if(!lower)return null;
    const p=lower.geometry.attributes.position;let bottom=Infinity,top=-Infinity;
    for(let i=0;i<p.count;i++){const y=p.getY(i)+lower.position.y;bottom=Math.min(bottom,y);top=Math.max(top,y)}
    const materials=Array.isArray(lower.material)?lower.material:[lower.material];
    return {bottom,top,count:p.count,complete:lower.geometry.groups.every(g=>!!materials[g.materialIndex])};
  })()`)
  let state
  for(let i=0;i<100;i++){await pause(200);state=await snapshot();if(state?.count)break}
  assert.ok(state?.count>0,'Lower-owned floor-edge faces are rendered')
  assert.ok(Math.abs(state.bottom-2.4)<1e-6,'Only the inter-storey band is visible, not the lower wall body')
  assert.ok(Math.abs(state.top-2.7)<1e-6,'The band meets the upper wall base')
  assert.equal(state.complete,true)
  const facadeHits = await evaluate(`(async()=>{
    const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');
    const s=window.roofWallScene();s.scene.updateMatrixWorld(true);const meshes=[];
    s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)});
    return [
      [new Vector3(2,2.55,3),new Vector3(0,0,1),4.751592949,'z'],
      [new Vector3(7,2.55,3),new Vector3(0,0,1),4.751592949,'z'],
      [new Vector3(10,2.55,5.5),new Vector3(-1,0,0),8.252178207,'x'],
      [new Vector3(10,2.55,8),new Vector3(-1,0,0),8.252178207,'x'],
    ].map(([origin,direction,coordinate,axis])=>new Raycaster(origin,direction).intersectObjects(meshes,false)
      .some(hit=>Math.abs(hit.point[axis]-coordinate)<1e-5));
  })()`)
  assert.deepEqual(facadeHits,[true,true,true,true],'The floor band is continuous across both marked wall transitions')
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(-8,9,27);s.camera.lookAt(3,3.5,9);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(500)
  writeFileSync('.tmp-storey-walls-after.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Single-floor view renders the complete 0.3 m facade band while hiding lower wall bodies',state)
} finally {ws?.close();child.kill()}
