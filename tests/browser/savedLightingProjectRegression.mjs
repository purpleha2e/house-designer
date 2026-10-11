// With Vite running, after lightingStartupRegression.mjs --cache has created its fixture.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const project = readFileSync('.tmp-indirect-baked-lighting-startup.house.json', 'utf8')
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'saved-lighting-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (pending.has(result.id)) { const entry = pending.get(result.id); pending.delete(result.id); if (result.error) entry.reject(result.error); else entry.resolve(result.result) }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(arg => arg.value ?? arg.description).join(' '))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 600; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw new Error('Timed out: ' + label + ': ' + JSON.stringify({ errors, diagnostic: await evaluate(`({status:window.savedLightingScene?.()?.userData.indirectLighting,alerts:window.testAlerts,engine:document.querySelector('[aria-label="3D engine status"]')?.textContent,roots:window.savedLightingRoots?.size,url:location.href,title:document.title,body:document.body.textContent.slice(0,1500),resources:performance.getEntriesByType('resource').slice(-8).map(entry=>entry.name)})`) }))
  }
  await call('Page.enable'); await call('Runtime.enable')
  // Keep startup small while exercising the actual App, including its real file controls.
  // The editor's default house is unrelated to this Save/Load regression.
  await call('Fetch.enable', { patterns: [{ urlPattern: '*colin_house_v2.json*' }] })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Fetch.requestPaused') void call('Fetch.fulfillRequest', {
      requestId: message.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
      body: Buffer.from('export default ' + JSON.stringify({ ...JSON.parse(project), indirectLighting: undefined })).toString('base64'),
    })
  })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.giWorkerCreations=0;window.testAlerts=[];
    const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);if(String(url).includes('indirectLighting.worker'))window.giWorkerCreations++}};
    window.alert=message=>window.testAlerts.push(message);
    window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(project)}],'saved-lighting.house.json',{type:'application/json'})}];
    window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async contents=>{window.savedProjectText=contents},close:async()=>{}})});
  ` })
  await call('Page.navigate', { url: 'http://127.0.0.1:' + (process.argv[2] ?? '5180') + '/' })
  await waitFor(`!!document.querySelector('[aria-label="Project menu"]')`, 'editor ready')
  const menu = async label => {
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await waitFor(`!!document.querySelector('.project-menu-dropdown')`, 'project menu open')
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`)
  }
  // Read the real editor scene, rather than exposing a fixture-only component callback.
  await evaluate(`(async()=>{const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/@react-three_fiber.js'))?.name;if(!url)throw Error('Missing rendered Fiber module');const {_roots}=await import(url);window.savedLightingRoots=_roots;window.savedLightingScene=()=>[..._roots.values()].map(root=>root.store.getState().scene).find(scene=>scene.userData.getBakedIndirectLighting)})()`)
  await waitFor(`window.savedLightingScene?.()?.userData.indirectLighting?.state==='ready' && !!window.savedLightingScene().userData.getBakedIndirectLighting?.()`, 'editor bake completed')
  const expected = await evaluate('window.savedLightingScene().userData.getBakedIndirectLighting()')
  await menu('Save')
  await waitFor('!!window.savedProjectText', 'project saved')
  const saved = JSON.parse(await evaluate('window.savedProjectText'))
  assert.deepEqual(saved.indirectLighting, expected, 'the normal Save button retains all completed GI data')
  assert.equal(saved.floors[0].id, 'lighting-startup')
  await evaluate(`window.showOpenFilePicker=async()=>[{getFile:async()=>new File([window.savedProjectText],'saved-lighting.house.json',{type:'application/json'})}]`)
  await menu('Load')
  await waitFor(`window.savedLightingScene?.()?.userData.indirectLighting?.source==='saved' && window.savedLightingScene().userData.indirectLighting.state==='ready'`, 'saved GI restored in editor')
  assert.equal(await evaluate('window.savedLightingScene().userData.indirectLighting.capturedFaces'), 0)
  await menu('Load')
  await waitFor(`window.savedLightingScene?.()?.userData.indirectLighting?.source==='saved' && window.savedLightingScene().userData.indirectLighting.state==='ready'`, 'same saved model restored again')
  assert.equal(await evaluate('window.savedLightingScene().userData.indirectLighting.capturedFaces'), 0)
  await evaluate('window.savedProjectText=undefined')
  await menu('Save')
  await waitFor('!!window.savedProjectText', 'restored project saved')
  assert.deepEqual(JSON.parse(await evaluate('window.savedProjectText')).indirectLighting, expected, 'saving a loaded model preserves the exact cache')
  assert.deepEqual(await evaluate('window.testAlerts'), [])
  assert.deepEqual(errors, [])
  console.log('PASS: Editor Load restores saved GI without captures; Save retains the exact lighting cache.')
} finally { ws?.close(); child.kill() }
