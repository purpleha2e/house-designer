// Run Vite on port 5180, then node tests/browser/materialEditorRegression.mjs.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const cache = resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const downloads = await mkdtemp(join(cache, 'material-download-test-'))
const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
  `--user-data-dir=${createBrowserTestProfile('material-editor-test-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) } })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let nextId = 0
  const pending = new Map(), errors = [], requests = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`${method} timed out`)), 30000)
    pending.set(++nextId, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
    ws.send(JSON.stringify({ id: nextId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (expression, description) => {
    for (let i = 0; i < 200; i++) {
      try { if (await evaluate(expression)) return } catch (error) {
        if (!/navigated|context.*destroyed|Cannot find context/i.test(error.message ?? '')) throw error
      }
      await pause(100)
    }
    throw Error(`Timed out: ${description}. ${JSON.stringify(errors)}`)
  }
  const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing enabled button: '+${JSON.stringify(text)});button.click()})()`)
  const setInput = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const openFolder = async path => {
    const parts = path.split('/')
    for (let index = 0; index < parts.length; index++) {
      const label = `Folder: My materials/${parts.slice(0, index + 1).join('/')}`
      await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`)
    }
  }
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.showSaveFilePicker=undefined;' })
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/materialEditor.html' })
  await wait(`!!window.materialPreviewState?.()?.scene`, 'material preview ready')
  console.log('Preview ready; checking controls and worker image preparation.')
  const toggle = await evaluate(`(()=>{const b=document.querySelector('.material-folder-toggle'),r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return {width:r.width,height:r.height,icon:s.width}})()`)
  assert.ok(toggle.width >= 28 && toggle.height >= 30 && toggle.icon >= 19, 'folder arrows have a larger visible icon and click target')
  await setInput('input[maxlength="100"]', 'Local brick sample')
  assert.equal(await evaluate(`[...document.querySelectorAll('.material-editor label')].some(label=>label.textContent.startsWith('Category'))`), false)
  await openFolder('Bricks')
  await click('+ New folder')
  await setInput('.material-folder-create input', 'Reclaimed')
  await click('Create folder')
  await wait(`!!document.querySelector('button[aria-label="Folder: My materials/Bricks/Reclaimed"]')`, 'nested material folder created')
  await setInput('input[aria-label="Roughness"]', '.25')
  await wait(`window.materialPreviewState().scene.children.some(o=>o.isMesh&&o.material.roughness===.25)`, 'live roughness update')
  for (const label of ['Base colour', 'Normal', 'Roughness', 'Metalness']) {
    await evaluate(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=4096;canvas.height=128;
      const c=canvas.getContext('2d');c.fillStyle=${JSON.stringify(label === 'Normal' ? '#8080ff' : '#b86435')};c.fillRect(0,0,4096,128);
      c.fillStyle='#999999';c.fillRect(0,60,4096,8);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'sample.png',{type:'image/png'}));
      const input=document.querySelector('input[aria-label="${label} map"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await wait(`!!document.querySelector('img[alt="${label} map"]')&&!document.querySelector('button.material-save').disabled`, `${label} prepared off-thread`)
  }
  await setInput('input[aria-label="Normal strength"]', '1.5')
  await click('Save to device')
  await wait(`!!window.materialEditorSaved`, 'device save and local library copy')
  let saved = await evaluate('window.materialEditorSaved')
  assert.equal(saved.productName, 'Local brick sample')
  assert.equal(saved.pbr.normalStrength, 1.5)
  assert.equal(saved.pbr.metalness, 1)
  assert.equal(saved.pbr.roughness, 1)
  assert.equal(saved.folder, 'Bricks/Reclaimed')
  assert.match(saved.pbr.textureSourceHashes.normalTextureUrl, /^[a-f0-9]{64}$/)
  assert.deepEqual(await evaluate('window.materialEditorHouse.materialDefinitions'), [saved])
  await wait(`(()=>{const s=window.materialPreviewState().scene.children.find(o=>o.isMesh)?.material;return s?.normalMap?.image?.width===2048&&s.normalScale.x===1.5&&!!s.roughnessMap&&!!s.metalnessMap})()`, 'live maps and normal strength')
  let file
  for (let i = 0; i < 100; i++) { file = (await readdir(downloads)).find(name => name.endsWith('.material.json')); if (file) break; await pause(100) }
  assert.ok(file, 'a real portable material file was downloaded')
  const fileContents = await readFile(join(downloads, file), 'utf8')
  assert.deepEqual(JSON.parse(fileContents), saved)
  console.log('Device file saved; checking preview modes and persistence.')
  await openFolder('Bricks')
  await click('+ New folder'); await setInput('.material-folder-create input', 'Spare'); await click('Create folder')
  await wait(`!!document.querySelector('button[aria-label="Folder: My materials/Bricks/Spare"]')`, 'empty folder created')
  await click('Tile'); await click('Room corner')
  await wait(`window.materialPreviewState().scene.children.some(o=>o.isGroup&&o.children.filter(c=>c.isMesh).length===3)`, 'room corner preview')
  await writeFile(join(cache, 'material-editor-desktop.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await call('Page.reload')
  await pause(500)
  await wait(`!!document.querySelector('button[aria-label="Folder: My materials/Bricks"]')`, 'folder library restored')
  await openFolder('Bricks/Reclaimed')
  assert.ok(await evaluate(`!!document.querySelector('button[aria-label="Folder: My materials/Bricks/Spare"]')`), 'empty folders persist too')
  await wait(`document.querySelector('.material-library-list button[data-material-id]')?.textContent.includes('Local brick sample')`, 'library persists after reload')
  await evaluate(`document.querySelector('.material-library-list button[data-material-id]').click()`)
  await wait(`document.querySelector('input[maxlength="100"]').value==='Local brick sample'&&!!document.querySelector('img[alt="Normal map"]')`, 'saved maps restored')
  await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5180', storageTypes: 'indexeddb' })
  await call('Page.reload')
  await pause(500)
  await wait(`!!window.materialPreviewState?.()?.scene&&document.querySelector('.material-library-list')&&!document.querySelector('.material-library-list button[data-material-id]')`, 'browser library cleared')
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Import material file"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(fileContents)}],'backup.material.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait(`document.querySelector('input[maxlength="100"]').value==='Local brick sample'&&!!document.querySelector('img[alt="Normal map"]')`, 'device file restores cleared library material')
  await click('Keep in browser')
  await wait(`!!window.materialEditorSaved`, 'restored browser copy saved')
  await openFolder('Metals/Chrome')
  await click('Move current material here')
  await click('Keep in browser')
  await wait(`window.materialEditorSaved?.folder==='Metals/Chrome'`, 'current material moved into a nested folder')
  await evaluate(`(()=>{const transfer=new DataTransfer();document.querySelector('.material-tree-item[aria-pressed="true"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true}));document.querySelector('[data-folder-path="Paint"]').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true}))})()`)
  await click('Keep in browser')
  await wait(`window.materialEditorSaved?.folder==='Paint'`, 'dragging a material to a folder updates its saved location')
  saved = await evaluate('window.materialEditorSaved')
  await setInput('.material-tree input[type="search"]', 'brick')
  assert.ok(await evaluate(`!!document.querySelector('.material-tree-item[aria-pressed="true"]')`), 'material search retains the folder hierarchy')
  await setInput('.material-tree input[type="search"]', '')
  await evaluate(`window.showSaveFilePicker=async options=>{window.nativeSaveOptions=options;return {createWritable:async()=>({write:async text=>{window.nativeSavedMaterial=text},close:async()=>{window.nativeSaveClosed=true}})}}`)
  await click('Save to device')
  await wait(`window.nativeSaveClosed&&!document.querySelector('.material-save').disabled`, 'native save stream closed')
  assert.deepEqual(JSON.parse(await evaluate('window.nativeSavedMaterial')), await evaluate('window.materialEditorSaved'))
  await setInput('input[aria-label="Roughness"]', '.4')
  await evaluate(`window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')}`)
  await click('Save to device')
  await wait(`!document.querySelector('.material-save').disabled`, 'cancelled native save returns to editing')
  assert.equal(await evaluate(`document.querySelector('.material-editor-actions>span').textContent`), 'Unsaved changes')
  assert.equal(await evaluate('window.materialEditorSaved.pbr.roughness'), 1, 'cancelling Save must not overwrite the browser copy')
  // Restore the saved draft without a discard prompt before the layout check.
  await evaluate(`window.confirm=()=>true;document.querySelector('.material-library-list button[data-material-id]').click()`)
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await pause(300)
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=390`), 'narrow editor has no horizontal overflow')
  await writeFile(join(cache, 'material-editor-mobile.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  assert.equal(requests.some(url => url.includes('/api/portal')), false, 'material editing needs no asset portal or login')
  if (process.env.MATERIAL_EDITOR_APP_URL) {
    await call('Emulation.clearDeviceMetricsOverride')
    const project = { activeFloorId: 'local-material-floor', wallKind: 'external',
      floors: [{ id: 'local-material-floor', name: 'Floor 0', elevation: 0, roomHeight: 2.7,
        slabThickness: .2, walls: [{ id: 'local-material-wall', kind: 'external',
          start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: .3, height: 2.7 }],
        models: [], roofs: [], rooms: [] }],
      surfaceAssignments: [{ id: 'local-material-assignment', materialId: saved.id,
        target: { type: 'wall-face', wallId: 'local-material-wall', side: 1 } }],
      materialDefinitions: [saved] }
    await call('Page.navigate', { url: process.env.MATERIAL_EDITOR_APP_URL })
    await wait(`!!document.querySelector('button[aria-label="Project menu"]')`, 'production designer ready')
    await evaluate(`window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(project))}],'material-house.json',{type:'application/json'})}];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async text=>{window.savedHouseText=text},close:async()=>{}})});window.confirm=()=>true`)
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Load')
    await wait(`document.title.includes('material-house')||!!document.querySelector('.project-menu-dropdown')===false`, 'portable house load submitted')
    await pause(700)
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Material editor')
    await wait(`!!document.querySelector('.material-editor')&&!!document.querySelector('.material-library-list')`, 'material editor opens directly from production app')
    await openFolder('Paint')
    await evaluate(`document.querySelector('.material-library-list button[data-material-id]').click()`)
    await wait(`document.querySelector('input[maxlength="100"]').value==='Local brick sample'`, 'embedded house material available without login')
    await click('Back to designer')
    await evaluate(`document.querySelector('button[aria-label="Materials"]').click()`)
    await wait(`!!document.querySelector('.materials-flyout .material-tree')`, '3D material picker uses the hierarchy')
    await setInput('.materials-flyout input[type="search"]', 'Local brick sample')
    await wait(`!!document.querySelector('.materials-flyout button[data-material-id="${saved.id}"]')`, 'personal material appears under its folder in the surface picker')
    await evaluate(`document.querySelector('.materials-flyout button[data-material-id="${saved.id}"]').click()`)
    assert.ok(await evaluate(`document.querySelector('.materials-flyout .material-tree').textContent.includes('Paint')`))
    await writeFile(join(cache, 'material-picker-folders.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Save')
    await wait(`!!window.savedHouseText`, 'production house saved')
    const roundTrip = JSON.parse(await evaluate('window.savedHouseText'))
    assert.deepEqual(roundTrip.materialDefinitions, [saved], 'the real app save path embeds the used local material and image data')
    await writeFile(join(cache, 'material-editor-house.json'), JSON.stringify(roundTrip, null, 2))
    const alternate = structuredClone(project)
    alternate.materialDefinitions[0].productName = 'Alternate material revision'
    alternate.materialDefinitions[0].pbr.roughness = .2
    await evaluate(`window.savedHouseText='';window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(alternate))}],'alternate-house.json',{type:'application/json'})}]`)
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Load'); await pause(700)
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Save'); await wait(`!!window.savedHouseText`, 'alternate revision saved')
    assert.equal(JSON.parse(await evaluate('window.savedHouseText')).materialDefinitions[0].pbr.roughness, .2)
    await evaluate(`window.savedHouseText='';document.querySelector('button[aria-label="Undo"]').click()`)
    await pause(300)
    await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`)
    await click('Save'); await wait(`!!window.savedHouseText`, 'undo restores the earlier material values')
    assert.deepEqual(JSON.parse(await evaluate('window.savedHouseText')).materialDefinitions, [saved])
    console.log('PASS: Production app menu, portable house load, local material registration and house save round-trip.')
  }
  assert.deepEqual(errors, [])
  console.log('PASS: Material folders, nested/empty folder persistence, moving and drag/drop, shared picker, device files, clearing browser data, portable house definitions and live previews.')
} finally { ws?.close(); child.kill() }
