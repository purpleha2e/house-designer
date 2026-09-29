import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?loft-test' })
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o => o.type === 'Group') && !document.body.innerText.includes('Preparing 3D scene')`)) break
  }
  await new Promise(resolve => setTimeout(resolve, 4000))
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render')?.click()})()`)
  await new Promise(resolve=>setTimeout(resolve,300))
  await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby roofs')){const input=label.querySelector('input');if(input?.checked)input.click()}})()`)
  await new Promise(resolve=>setTimeout(resolve,1500))
  for (const edit of [false, true]) {
    if (edit) {
      await call('Page.navigate', {url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?loft-test&edit-floor'})
      for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && !document.body.innerText.includes('Preparing 3D scene')`))break}
      await new Promise(r=>setTimeout(r,4000))
    }
    await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby roofs')){const input=label.querySelector('input');if(input?.checked)input.click()}})()`)
    console.log(edit ? 'LOFT EDIT' : 'ALL FLOORS', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkLoftDormerInterior())`))
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(3.0,5.95,8.0);s.camera.lookAt(5.65,5.95,9.84);s.camera.updateMatrixWorld();s.invalidate();const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render');if(document.querySelector('label'))b?.click()})()`)
    await new Promise(r=>setTimeout(r,1500))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(edit?'.tmp-dormer-cheeks-edit.png':'.tmp-dormer-cheeks.png',Buffer.from(shot.data,'base64'))
  }
}finally{ws?.close();child.kill()}
