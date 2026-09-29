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
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(4,5.7,6);s.camera.lookAt(4,5.7,1.65);s.camera.updateMatrixWorld();s.invalidate();window.shadowOriginal=[];s.scene.traverse(o=>{if(o.isMesh)window.shadowOriginal.push([o,o.receiveShadow,(Array.isArray(o.material)?o.material:[o.material]).map(m=>[m,m.shadowSide])])})})()`)
  await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render');button?.click()})()`)
  await new Promise(resolve=>setTimeout(resolve,500))
  console.log(await evaluate(`document.body.innerText`))
  await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby roofs')){const input=label.querySelector('input');if(input?.checked)input.click()}})()`)
  await new Promise(resolve=>setTimeout(resolve,1000))
  console.log('roof sun angles',await evaluate(`import('/.tmp-roof-shadow-sweep.js').then(m=>m.checkRoofSweep())`))
  console.log('fixed interior',await evaluate(`import('/tests/browser/loftRoofLightLeakRegression.js').then(m=>m.checkLoftRoofLightLeak())`))
  console.log('exterior gable',await evaluate(`import('/tests/browser/loftShadowAcneRegression.js').then(m=>m.checkLoftShadowAcne())`))
  await evaluate(`(()=>{const s=window.roofWallScene();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-top')o.material.shadowSide=1});s.invalidate()})()`)
  console.log('old interior',await evaluate(`import('/tests/browser/loftRoofLightLeakRegression.js').then(m=>m.checkLoftRoofLightLeak()).then(()=>({unexpectedPass:true})).catch(e=>({expectedFailure:e.message}))`))
} finally {ws?.close();child.kill()}

