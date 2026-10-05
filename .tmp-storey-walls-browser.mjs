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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?floor-test&edit-floor' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate('!!window.updateRegressionFloors && !!window.roofWallScene?.()')) break
  }
  await evaluate(`(async()=>{const p=await(await fetch('/colin_house_v2.json')).json();window.updateRegressionFloors(p.floors);window.updateRegressionActiveFloor(p.floors[1].id)})()`)
  await pause(7000)
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(-8,9,27);s.camera.lookAt(3,3.5,9);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(500)
  console.log(JSON.stringify(await evaluate(`(()=>{const s=window.roofWallScene();let a=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')a.push({data:o.userData,position:o.position.toArray(),count:o.geometry.attributes.position.count})});return a})()`)))
  writeFileSync('.tmp-storey-walls-before.png', Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
} finally { ws?.close();child.kill() }
