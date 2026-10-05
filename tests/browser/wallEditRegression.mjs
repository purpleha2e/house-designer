// With Vite on port 5180: node tests/browser/wallEditRegression.mjs
// Geometry-only reproduction of Colin House's disappearing walls after edits.
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
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
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
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Page.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/objectHandlesRegression.html' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate('!!window.handleSetFloor && !!window.handleThreeScene?.()')) break
  }
  await evaluate(`(async()=>{
    window.wallEditFloor=await(await fetch('/tests/fixtures/wallEditRegression.json')).json();
    window.handleSetFloor({...window.wallEditFloor,walls:[]});window.handleSelectModel(null);
    const {prepareRenderedFloorData}=await import('/src/threeDLevelPreparation.ts');
    const {buildFloorWallSurfaceFaces}=await import('/src/wallEngine/floorWallSurfaceMesh.ts');
    window.expectedWallVertices=count=>{const data=prepareRenderedFloorData({...window.wallEditFloor,walls:window.wallEditFloor.walls.slice(0,count)});
      return buildFloorWallSurfaceFaces({renderedWalls:data.renderedWalls,rooms:data.rooms,useWallBodyPerimeterMesh:true}).length*6;};
  })()`)
  const snapshot = () => evaluate(`(()=>{
    let mesh;window.handleThreeScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')mesh=o});
    if(!mesh)return null;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    return {vertices:mesh.geometry.attributes.position.count,
      complete:mesh.geometry.groups.every(g=>!!materials[g.materialIndex] && materials[g.materialIndex].visible),
      groups:mesh.geometry.groups.length,colors:materials.map(m=>m?.color?.getHexString()),
      fading:materials.some(m=>m?.transparent && m.opacity<1)};
  })()`)
  const moveCamera = async near => {
    await evaluate(`(()=>{const s=window.handleThreeScene();s.camera.position.set(${near?'6,5,8':'24,24,28'});
      s.camera.lookAt(3.5,0,8.5);s.camera.updateMatrixWorld();s.invalidate()})()`)
    await pause(500)
  }
  const updateWalls = async count => {
    const expected = await evaluate(`window.expectedWallVertices(${count})`)
    await evaluate(`window.handleSetFloor({...window.wallEditFloor,walls:window.wallEditFloor.walls.slice(0,${count})})`)
    let state
    for(let i=0;i<100;i++) {await pause(200);state=await snapshot();if(state?.vertices===expected)break}
    assert.equal(state?.vertices,expected,`The renderer reaches the ${count}-wall geometry`)
    assert.equal(state.complete,true,`Every face group has a visible material after ${count} walls`)
    return state
  }
  await pause(500)
  await moveCamera(true)
  await updateWalls(18)
  assert.equal((await snapshot()).fading,true,'The nearby external wall activates fading')
  for(const count of [22,26,18,26]) {
    await updateWalls(count)
    await moveCamera(false)
    const state=await snapshot()
    assert.equal(state.complete,true,'Moving away restores materials for every face group')
    assert.equal(state.fading,false,'Walls become opaque again')
    assert.ok(state.colors.includes('94a3b8'),'External wall material remains attached')
    if(count>18)assert.ok(state.colors.includes('cbd5e1'),'Internal wall material remains attached')
    await moveCamera(true)
  }
  console.log('Adding/removing internal walls while fading preserves all external and internal wall materials')
} finally {ws?.close();child.kill()}
