// Vite running: node tests/browser/doorMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('door-latency-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.once('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); clearTimeout(request.timer); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 60000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (expression, timeout = 180000) => {
    const end = Date.now() + timeout
    while (!await evaluate(expression)) {
      assert.deepEqual(errors, [])
      if (Date.now() > end) throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.doorLatency?.state()?.scene.userData.indirectLighting'))}`)
      await pause(50)
    }
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};
  ` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/doorMoveLatencyRegression.html` })
  const ready = `(()=>{const s=window.doorLatency?.state(),u=s?.scene.userData,g=u?.indirectLighting;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&g?.state==='ready'&&!g.pendingUpdate&&!g.pendingLighting&&!g.saving})()`
  await wait(ready)
  console.log('Four-wall scene ready')
  await evaluate(`(()=>{
    window.S=doorLatency.state();window.metrics={compiles:0,shaders:[],liveDraw:0,started:0};
    const context=S.gl.getContext(),compile=context.compileShader.bind(context);
    context.compileShader=shader=>{metrics.compiles++;metrics.shaders.push({source:context.getShaderSource(shader),stack:new Error().stack});return compile(shader)};
    const render=S.gl.render.bind(S.gl);S.gl.render=(scene,camera)=>{const value=render(scene,camera);
      let changed=false;scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&!metrics.oldGeometries?.has(o.geometry))changed=true});
      if(scene===S.scene&&changed&&metrics.started&&!metrics.liveDraw&&!scene.userData.shaderWarmupPending&&!scene.userData.indirectScanPending)metrics.liveDraw=performance.now()-metrics.started;
      return value};
  })()`)
  const moves = []
  for (const x of process.argv.includes('--profile') ? [2] : [2, 1.25, 2.25]) {
    const before = await evaluate('({generation:S.scene.userData.indirectLighting.generation,compiles:metrics.compiles})')
    await evaluate(`metrics.oldGeometries=new Set();S.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')metrics.oldGeometries.add(o.geometry)});metrics.liveDraw=0;metrics.started=performance.now();doorLatency.move(${x})`)
    await wait(`S.scene.userData.indirectLighting.generation>${before.generation}&&${ready}`)
    const result = await evaluate(`({x:${x},visibleMs:metrics.liveDraw,lightingMs:performance.now()-metrics.started,compiles:metrics.compiles-${before.compiles},glError:S.gl.getContext().getError(),probes:S.scene.userData.indirectLighting.probes,
      preparation:S.scene.userData.shaderWarmupProfile?.filter(p=>p.startedAt>=metrics.started),
      events:window.houseDesignerEngineLog?.entries.filter(e=>e.timeMs>=metrics.started).map(e=>({...e,timeMs:e.timeMs-metrics.started})),
      giPreparation:S.scene.userData.indirectLighting.prepareTimings})`)
    assert.equal(result.glError, 0)
    assert.ok(result.visibleMs > 0)
    moves.push(result)
    mkdirSync('tmp/door-latency', { recursive: true })
    writeFileSync('tmp/door-latency/report.json', JSON.stringify({ moves, errors }, null, 2))
    writeFileSync('tmp/door-latency/shaders.json', JSON.stringify(await evaluate('metrics.shaders'), null, 2))
    console.log('Door move', JSON.stringify({ x: result.x, visibleMs: result.visibleMs,
      lightingMs: result.lightingMs, compiles: result.compiles, glError: result.glError }))
    assert.equal(result.compiles, 0, 'moving a warmed door reuses display, capture and GI helper shaders')
  }
  assert.deepEqual(errors, [])
  mkdirSync('tmp/door-latency', { recursive: true })
  writeFileSync('tmp/door-latency/report.json', JSON.stringify({ moves, errors }, null, 2))
  writeFileSync('tmp/door-latency/final.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('PASS repeated opening edits, retained shaders and completed GI')
} finally { ws?.close(); browser.kill() }
