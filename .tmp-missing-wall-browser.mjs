// With Vite running on port 5180: node tests/browser/windowHeightRegression.mjs
// Exercises window dimension fields and the resulting 3D scale in Windows Chrome.
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
  await evaluate(`(async()=>{const p=await(await fetch('/colin_house_v2.json')).json();window.testWallFloor=p.floors[0];window.handleSetFloor({...p.floors[0],walls:[]});window.handleSelectModel(null)})()`)
  await pause(1200)
  await evaluate(`(()=>{const s=window.handleThreeScene();s.camera.position.set(6,5,8);s.camera.lookAt(3.5,0,8.5);s.camera.updateMatrixWorld();s.invalidate()})()`)
  for (let count=1;count<=26;count++) {
    await evaluate(`window.handleSetFloor({...window.testWallFloor,walls:window.testWallFloor.walls.slice(0,${count})})`)
    await pause(450)
    console.log('After walls',count,JSON.stringify(await evaluate(`(()=>{const s=window.handleThreeScene();let a=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')a.push({positions:o.geometry.attributes.position.count,groups:o.geometry.groups,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>m&&({visible:m.visible,opacity:m.opacity,color:m.color?.getHexString()}))})});return a})()`)))
  }
  await pause(5000)
  console.log(await evaluate(`(()=>{const s=window.handleThreeScene();return {camera:s.camera.position.toArray(),meshes:s.scene.children.length,walls:(()=>{let a=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')a.push({role:o.userData,positions:o.geometry.attributes.position.count,groups:o.geometry.groups,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({visible:m?.visible,opacity:m?.opacity,side:m?.side,color:m?.color?.getHexString()}))})});return a})()}})()`))
  await evaluate(`(()=>{const s=window.handleThreeScene();s.camera.position.set(24,24,28);s.camera.lookAt(3.5,0,8.5);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(1500)
  writeFileSync('.tmp-missing-walls-before.png', Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log(await evaluate(`(()=>{const s=window.handleThreeScene();let a=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')a.push({groupCount:o.geometry.groups.length,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({opacity:m?.opacity,visible:m?.visible})),faded:[...(o.userData.fadedWallIds??[])]})});return a})()`))
} finally { ws?.close();child.kill() }
