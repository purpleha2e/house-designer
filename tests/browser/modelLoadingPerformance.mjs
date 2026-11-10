// Run Vite and the asset portal, then: node tests/browser/modelLoadingPerformance.mjs [port]
// Uses the editor's real Load action, including the embedded model definitions.
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'

const port = process.argv[2] ?? '5180'
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${createBrowserTestProfile('house-performance-')}`, 'about:blank',
], { windowsHide: true })
let ws
process.once('SIGINT', () => { ws?.close(); child.kill(); process.exit(130) })
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (pending.has(result.id)) {
      const p = pending.get(result.id); pending.delete(result.id)
      result.error ? p.reject(result.error) : p.resolve(result.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.loadingUiProfile={tasks:[],gaps:[]};
    new PerformanceObserver(list=>{for(const e of list.getEntries())loadingUiProfile.tasks.push({at:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true});
    let last=performance.now();setInterval(()=>{const now=performance.now();loadingUiProfile.gaps.push({at:now,ms:now-last});last=now},16);
  `})
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/${process.argv[3]??''}` })
  for (let i = 0; i < 120; i++) {
    await pause(500)
    if (await evaluate('!!window.houseDesignerEngineLog')) break
  }
  if (!await evaluate('!!window.perfScene')) await evaluate(`(async()=>{const {getEditorState}=await import('/tests/browser/rendererTestModules.ts');window.perfScene=getEditorState})()`)
  const observedLogs = new Map()
  const status = async () => {
    const value = await evaluate(`({gi:window.perfScene?.()?.scene.userData.indirectLighting,
    warming:!!window.perfScene?.()?.scene.userData.shaderWarmupPending,
    shadows:window.perfScene?.()?.gl.shadowMap.type,
    overlay:!!document.querySelector('.viewport-preparing-overlay'),
    preparation:window.perfScene?.()?.scene.userData.viewportPreparation,
    warmup:window.perfScene?.()?.scene.userData.shaderWarmupProfile,
    logs:window.houseDesignerEngineLog?.entries ?? []})`)
    for (const entry of value.logs) observedLogs.set(entry.index,entry)
    return value
  }
  let initial
  for (let i = 0; i < 1200; i++) {
    await pause(500); initial = await status()
    if (i % 40 === 0) console.log('Colin loading', initial.gi?.state, initial.gi?.blocked, initial.warming)
    if (initial.gi?.state === 'ready' && !initial.gi.blocked && !initial.warming && !initial.overlay) break
  }
  assert.equal(initial.gi?.state, 'ready', 'Colin finishes loading before switching')
  assert.equal(initial.shadows, 1, 'warmup and rendering use PCF shadows consistently')
  // Fetch before the timer; file selection itself is not part of scene loading.
  await evaluate(`(async()=>{const contents=await(await fetch('/springfield_14.json')).text();
    window.showOpenFilePicker=async()=>[{getFile:async()=>new File([contents],'springfield_14.json',{type:'application/json'})}];
    window.houseDesignerEngineLog.clear();document.querySelector('[aria-label="Project menu"]').click()})()`)
  await pause(100)
  const started = Date.now()
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Load').click()`)
  let readyMs, settled, lastPrint = 0
  for (let i = 0; i < 1200; i++) {
    await pause(500); settled = await status()
    const elapsed = Date.now() - started
    if (elapsed - lastPrint > 10000) {
      console.log('Springfield', elapsed, settled.gi?.state, settled.gi?.completed, settled.gi?.total, 'warming', settled.warming, settled.preparation)
      lastPrint = elapsed
    }
    // Require a new warmup: the outgoing scene can still report ready during Load.
    const prepared = settled.logs.some(e => e.type === 'shader-warmup-complete')
    if (!readyMs && prepared && !settled.warming && !settled.gi?.blocked && !settled.overlay) {
      readyMs = elapsed; console.log('Scene usable', readyMs, 'ms')
    }
    if (settled.gi?.state === 'fallback') throw Error(JSON.stringify(settled.gi))
    if (readyMs && settled.gi?.rooms === 17 && settled.gi.state === 'ready' && !settled.gi.volumePending && !settled.warming) break
  }
  const totalMs = Date.now() - started
  assert.ok(readyMs, 'incoming scene becomes usable')
  assert.equal(settled.gi?.rooms, 17, 'actual Springfield model was loaded')
  assert.equal(settled.gi?.state, 'ready', 'both bounces and reflections complete')
  assert.equal(settled.gi.volumePending, false, 'the final volume is published')
  assert.equal(settled.gi.blocked, false)
  assert.ok(settled.gi.previewUpdates > 0, 'the full house publishes live previews')
  assert.equal(settled.warming, false, 'display resumes after reflection shaders')
  assert.equal(settled.shadows, 1)
  const readyAt=await evaluate('performance.now()')
  const settleMs=Number(process.argv.find(arg=>arg.startsWith('--settle-ms='))?.split('=')[1]??0)
  if(settleMs)await pause(settleMs)
  const postGi=await evaluate(`({tasks:loadingUiProfile.tasks.filter(e=>e.at>=${readyAt}),maxGap:Math.max(0,...loadingUiProfile.gaps.filter(e=>e.at>=${readyAt}).map(e=>e.ms))})`)
  // React reports errors caught by ModelLoadBoundary as exception events too.
  // Keep known missing external assets visible in the report, while requiring
  // the editor to recover and complete the real house/lighting transition.
  const recoveredModels = [...observedLogs.values()].filter(entry=>entry.type==='model-load-failed')
  const unexpectedErrors = errors.filter(error=>!recoveredModels.some(entry=>
    entry.detail.includes(error.exception?.description?.split('\n')[0]?.replace(/^Error: /,''))))
  assert.deepEqual(unexpectedErrors, [])
  const result = { readyMs, totalMs, gi: settled.gi, postGi, warmup:settled.warmup, recoveredModels, logs: [...observedLogs.values()] }
  writeFileSync('logs/model-loading-performance.json', JSON.stringify(result, null, 2))
  writeFileSync('node_modules/.cache/model-loading-performance.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS', JSON.stringify({ readyMs, totalMs, probes: settled.gi.probes, faces: settled.gi.capturedFaces,
    captureMs: settled.gi.captureMs, firstPreviewMs: settled.gi.firstPreviewMs, previewUpdates: settled.gi.previewUpdates, postGi, recoveredModels }))
} finally { ws?.close(); child.kill() }
