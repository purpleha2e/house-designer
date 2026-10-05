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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?roof-clipping&materials'})
  for(let i=0;i<60;i++){await pause(500);if(await evaluate('!!window.roofWallScene?.()'))break}
  await evaluate(`(async()=>{
    const p=await(await fetch('/.tmp-roof-gable-join-preview.json')).json();
    const {normalizeFloor}=await import('/src/modelPlacement.ts');
    const {modelsById,registerRuntimeModels}=await import('/src/models/modelLibrary.ts');
    registerRuntimeModels(p.modelDefinitions??[]);
    window.updateRegressionFloors(p.floors.map(f=>normalizeFloor(f,modelsById)));
    window.updateRegressionAssignments(p.surfaceAssignments);window.updateRegressionActiveFloor(p.activeFloorId);
  })()`)
  await pause(5000)
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');s.camera.position.set(16.05,10.36,16.86);s.camera.lookAt(3,5.7,13);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-roof-gable-join-preview.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  const data=await evaluate(`(()=>{const s=window.roofWallScene();const result=[];
    s.scene.traverse(o=>{if(!o.userData.houseDesignerRole)return;
      const p=o.geometry?.attributes.position;if(!p)return;result.push({role:o.userData.houseDesignerRole,userData:o.userData,
        positions:Array.from(p.array),normals:Array.from(o.geometry.attributes.normal.array),matrix:o.matrixWorld.elements})});return result})()`)
  writeFileSync('.tmp-roof-junction-geometry.json',JSON.stringify(data))
  console.log('Saved roof corner geometry and view')
}finally{ws?.close();child.kill()}



