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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?loft-test&edit-floor' })
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o => o.type === 'Group') && !document.body.innerText.includes('Preparing 3D scene')`)) break
  }
  await new Promise(resolve => setTimeout(resolve, 4000))
  await evaluate(`(() => { const s=window.roofWallScene(); s.camera.position.set(-2,8,15); s.camera.lookAt(4,4,7); s.camera.updateMatrixWorld(); s.invalidate(); return true })()`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  const inspect = () => evaluate(`(()=>{const result={references:[],walls:[],ground:0,slabs:0};window.roofWallScene().scene.traverse(o=>{const role=o.userData.houseDesignerRole;if(role==='lower-floor-reference')result.references.push({floorId:o.userData.floorId,vertices:o.geometry.attributes.position.count,isLine:o.isLineSegments,depthTest:o.material.depthTest});if(role==='wall-engine-render')result.walls.push(o.userData.floorId);if(role==='ground-plane')result.ground++;if(role==='ceiling-slab-solid')result.slabs++});return result})()`)
  console.log('edit upper floor',await inspect())
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(-7,8,20);s.camera.lookAt(4,2.5,6);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await new Promise(resolve=>setTimeout(resolve,1500))
  writeFileSync('.tmp-floor-edit.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`(()=>{const floors=window.regressionFloors;const lower=structuredClone(floors[0]);lower.id='reference-basement';lower.elevation=-2.7;lower.walls=lower.walls.map(w=>({...w,id:'basement-'+w.id}));window.updateRegressionFloors([lower,...floors])})()`)
  await new Promise(resolve=>setTimeout(resolve,6000))
  const threeLevels=await inspect();console.log('three levels',threeLevels)
  if(threeLevels.references.length!==2 || threeLevels.walls.length!==1 || threeLevels.ground)throw Error('Wrong floor edit visibility')
  await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[1].id)`)
  await new Promise(resolve=>setTimeout(resolve,3000))
  const switched=await inspect();console.log('switched floor',switched)
  if(switched.references.length!==1 || switched.walls.length!==1 || switched.ground)throw Error('Wrong references after switching floor')
  await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[0].id)`)
  await new Promise(resolve=>setTimeout(resolve,3000))
  const lowest=await inspect();console.log('lowest floor',lowest)
  if(lowest.references.length || lowest.ground)throw Error('Lowest floor has unwanted references or ground')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?loft-test'})
  for(let attempt=0;attempt<60;attempt++) {await new Promise(resolve=>setTimeout(resolve,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && !document.body.innerText.includes('Preparing 3D scene')`))break}
  await new Promise(resolve=>setTimeout(resolve,5000))
  const allFloors=await inspect();console.log('all floors',allFloors)
  if(allFloors.references.length || allFloors.ground!==1 || allFloors.walls.length!==2)throw Error('All floors view changed unexpectedly')
} finally {
  ws?.close()
  child.kill()
}

