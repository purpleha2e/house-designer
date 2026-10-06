// With Vite running: node --test tests/browser/toolbarLayoutRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { once } from 'node:events'
import assert from 'node:assert/strict'

const profile = mkdtempSync(join(tmpdir(), 'roof-create-preview-'))
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true })
const exited = once(child, 'exit')
let ws, send
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 30000)
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
    const response = JSON.parse(event.data), request = pending.get(response.id)
    if (request) { pending.delete(response.id); response.error ? request.reject(response.error) : request.resolve(response.result) }
  })
  send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 30000)
    pending.set(++id, {
      resolve: value => { clearTimeout(timeout); resolve(value) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
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
  const waitFor = async expression => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(250) }
    throw new Error(`Timed out: ${expression}`)
  }
  await call('Page.enable')
  await call('Page.navigate', {url:`http://127.0.0.1:${process.argv[2]??5181}/tests/browser/roofCreatePreviewRegression.html`})
  await waitFor(`!!document.querySelector('.viewport-toolbar') && !!window.roofCreateScene?.()`)
  const button = label => `document.querySelector('[aria-label="${label}"]')`
  const click = async label => {await evaluate(`${button(label)}.click()`);await pause(200)}
  await call('Emulation.setDeviceMetricsOverride',{width:1835,height:1000,deviceScaleFactor:1,mobile:false})
  await pause(300)
  const inspect=()=>evaluate(`(() => {
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    return {toolbars:[...document.querySelectorAll('.viewport-toolbar')].map(rect),
      buttons:[...document.querySelectorAll('.viewport-icon-button,.three-fullscreen-toggle,.edit-toolbar button,.left-tool-rail button')].map(el=>({label:el.getAttribute('aria-label'),...rect(el)})),
      rail:rect(document.querySelector('.left-tool-rail')),railLabels:[...document.querySelectorAll('.left-tool-rail button')].map(el=>el.getAttribute('aria-label'))};})()`)
  let layout=await inspect()
  assert.equal(layout.toolbars[0].x,8,'2D hamburger aligns with the left rail')
  for(const bar of layout.toolbars)assert.equal(bar.height,32)
  for(const b of layout.buttons){assert.equal(b.width,32,b.label);assert.equal(b.height,32,b.label)}
  assert.equal(layout.rail.y,48)
  assert.equal(layout.railLabels.includes('Undo'),false)
  assert.equal(layout.railLabels.length,7)
  for(const view of ['2D','3D']){
    await evaluate(`document.querySelector('[aria-label="${view} transform mode"] [aria-label="Rotate"]').click()`)
    assert.equal(await evaluate(`document.querySelector('[aria-label="${view} transform mode"] [aria-label="Rotate"]').getAttribute('aria-pressed')`),'true')
  }
  for(const mode of ['Wide aspect','Super-wide aspect','Normal aspect']){
    await click(mode)
    assert.equal(await evaluate(`${button(mode)}.getAttribute('aria-pressed')`),'true')
  }
  await click('Zoom in')
  assert.notEqual(await evaluate(`${button('Reset zoom')}.textContent`),'100%')
  await click('Reset zoom')
  assert.equal(await evaluate(`${button('Reset zoom')}.textContent`),'100%')
  await click('Roof tools')
  await click('Project menu')
  assert.equal(await evaluate(`document.querySelector('#floorplan-settings-menu').contains(document.elementFromPoint(24,82))`),true,'menu is above the left rail')
  assert.ok(await evaluate(`document.querySelector('#floorplan-settings-menu').textContent.includes('Render settings')`))
  assert.ok(await evaluate(`document.querySelector('.project-menu-dropdown').textContent.includes('Save')`))
  await evaluate(`document.querySelector('.ground-image-controls > button').click()`)
  assert.ok(await evaluate(`!!document.querySelector('[aria-label="Upload ground image"]')`))
  await evaluate(`document.querySelector('.ground-image-controls > button').click()`)
  writeFileSync('.tmp-toolbar-menu.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
  assert.equal(await evaluate(`${button('Project menu')}.getAttribute('aria-expanded')`),'false')
  await click('3D view menu')
  const headBefore=await evaluate(`${button('Head height')}.checked`)
  await click('Head height')
  assert.equal(await evaluate(`${button('Head height')}.checked`),!headBefore)
  const menuBounds=await evaluate(`(() => {const r=document.querySelector('#three-settings-menu').getBoundingClientRect();return {right:r.right,bottom:r.bottom}})()`)
  assert.ok(menuBounds.right<=1835 && menuBounds.bottom<=1000)
  await click('3D view menu')
  await click('Roof tools')
  await call('Runtime.evaluate',{expression:`${button('Enter fullscreen')}.click()`,userGesture:true})
  await waitFor(`!!document.fullscreenElement`)
  await click('3D view menu')
  assert.ok(await evaluate(`document.fullscreenElement.contains(document.querySelector('#three-settings-menu'))`),'settings remain available in fullscreen')
  await click('3D view menu')
  await click('Exit fullscreen')
  await waitFor(`!document.fullscreenElement`)
  writeFileSync('.tmp-toolbar-desktop.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  for(const width of [1220,900,800,600]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
    await pause(300)
    layout=await inspect()
    for(const bar of layout.toolbars){assert.equal(bar.height,32);assert.ok(bar.right<=width && bar.x>=0)}
    for(const b of layout.buttons){assert.equal(b.width,32,b.label);assert.equal(b.height,32,b.label)}
    assert.ok(await evaluate(`(() => {const s=document.querySelector('.viewport-toolbar-main');return s.scrollWidth<=s.clientWidth})()`),'the complete 2D button row fits')
    await click('3D view menu')
    assert.ok(await evaluate(`(() => {const m=document.querySelector('#three-settings-menu').getBoundingClientRect(),p=document.querySelector('.three-editor-pane').getBoundingClientRect();return m.bottom<=p.bottom && m.right<=p.right})()`),'3D settings fit their pane')
    await click('3D view menu')
    if(width===900)writeFileSync('.tmp-toolbar-narrow.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  console.log('Compact 32px toolbars, menu stacking, transforms, zoom, aspects, head height and responsive layout passed')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close') } catch { child.kill() }
  } else child.kill()
  ws?.close()
  await exited
  // Only remove the isolated profile created by this test.
  const target = resolve(profile), root = resolve(tmpdir())
  assert.equal(dirname(target), root)
  assert.ok(target.startsWith(join(root, 'roof-create-preview-')))
  rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
