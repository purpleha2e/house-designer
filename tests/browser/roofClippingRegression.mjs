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
  console.log('Browser connected')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?roof-clipping' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate(`(()=>{let ready=0;window.roofWallScene?.()?.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count>0)ready++});return ready===2})()`)) break
  }
  await pause(1500)
  const capture = async name => {
    await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');
      s.camera.position.set(1,4,0);s.camera.lookAt(4.4,3.3,4.75);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
    const bytes = Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(name, bytes)
    const { data } = await sharp(bytes).extract({ left: 597, top: 572, width: 5, height: 20 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rgb = [0, 0, 0]
    for (let i = 0; i < data.length; i++) rgb[i % 3] += data[i] / (data.length / 3)
    return rgb
  }
  const before = await capture('.tmp-roof-clipping-before.png')
  assert.ok(Math.max(...before) - Math.min(...before) < 40, `The original roof cut exposes a grey section: ${before}`)
  const oldGeometry = await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('always');let id;
    s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.userData.floorId===window.regressionFloors[1].id)id=o.geometry.uuid});return id})()`)
  await evaluate(`(()=>{const checkbox=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Clip house geometry')?.querySelector('input');
    if(!checkbox?.checked)throw new Error('Roof clipping must be enabled by default');checkbox.click()})()`)
  for (let i = 0; i < 60; i++) {
    await pause(250)
    if (await evaluate(`(()=>{let id;window.roofWallScene().scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='wall-engine-render'&&o.userData.floorId===window.regressionFloors[1].id)id=o.geometry.uuid});return id&&id!==${JSON.stringify(oldGeometry)}})()`)) break
  }
  assert.equal(await evaluate('window.regressionFloors[0].roofs[1].clipsGeometry'), false)
  const after = await capture('.tmp-roof-clipping-after.png')
  assert.ok(after[0] > after[1] * 1.35 && after[0] > after[2] * 1.5,
    `Switching clipping off restores the brown facade at the marked section: ${after}`)
  console.log('Roof settings checkbox preserves the continuous facade', { before, after })
} finally {ws?.close();child.kill()}
