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
  await evaluate(`window.handleWallMode(false);window.handleSetFloor({...window.handleFloor,
    walls:[{id:'window-wall',kind:'external',start:{x:0,y:3},end:{x:6,y:3},height:2.4,thickness:0.3}],
    models:[{id:'height-window',modelId:'window-large-single-pane',position:{x:3,y:3},rotation:0,scale:1,
      wallOpeningBottom:0.3,wallAttachment:{wallId:'window-wall',offset:3}}]});window.handleSelectModel('height-window')`)
  await pause(1500)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Object height"]').value`), '2')
  const enterWindowField = async (label, value) => {
    await evaluate(`document.querySelector('[aria-label="Object ${label}"]').focus();document.querySelector('[aria-label="Object ${label}"]').select()`)
    await call('Input.insertText', {text: String(value)})
    await call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await pause(500)
  }
  await enterWindowField('height', 1.4)
  let resizedWindow = await evaluate('window.handleFloor.models[0]')
  assert.ok(Math.abs(resizedWindow.scale - 0.7) < 1e-8)
  assert.ok(Math.abs(resizedWindow.scale * resizedWindow.widthScale - 1) < 1e-8)
  assert.ok(Math.abs(resizedWindow.scale * resizedWindow.depthScale - 1) < 1e-8)
  assert.equal(resizedWindow.wallOpeningBottom, 0.3)
  const liveWindowScale = await evaluate(`window.handleThreeScene().scene.getObjectByName('model-transform-height-window').scale.toArray()`)
  assert.ok(Math.abs(liveWindowScale[0] - 1) < 1e-8 && Math.abs(liveWindowScale[1] - 0.7) < 1e-8 && Math.abs(liveWindowScale[2] - 1) < 1e-8)
  await enterWindowField('y scale', 0.8)
  resizedWindow = await evaluate('window.handleFloor.models[0]')
  assert.ok(Math.abs(resizedWindow.scale - 0.8) < 1e-8)
  assert.ok(Math.abs(resizedWindow.scale * resizedWindow.widthScale - 1) < 1e-8)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Object height"]').value`), '1.6')
  console.log('Window height and Y-scale fields resize the 3D model while preserving width, depth and sill')
} finally {
  ws?.close()
  child.kill()
}
