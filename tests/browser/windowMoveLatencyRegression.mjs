// Move Colin windows and measure geometry/lighting latency: node tests/browser/windowMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
  `--user-data-dir=${createBrowserTestProfile('colin-window-')}`, 'about:blank',
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
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 180000)
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
      if (Date.now() > end) throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting'))}`)
      await pause(50)
    }
  }

  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', {source:`const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};`})
  await call('Page.addScriptToEvaluateOnNewDocument', {source:`window.giCoordinatorStarts=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);if(String(url).includes('indirectLighting.worker'))giCoordinatorStarts++}};`})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&saved-colin`})
  const ready=`(()=>{const s=window.roofWallScene?.(),u=s?.scene.userData,g=u?.indirectLighting;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&g?.state==='ready'&&!g.blocked&&!g.pendingUpdate&&!g.pendingLighting&&!g.saving})()`
  await wait(ready,300000)
  console.log('Colin ready')
  await evaluate(`(()=>{
    const s=roofWallScene(),c=s.gl.getContext(),compile=c.compileShader.bind(c),render=s.gl.render.bind(s.gl);
    window.editMetrics={compiles:0,started:0,firstDraw:0,states:[]};
    c.compileShader=shader=>{editMetrics.compiles++;return compile(shader)};
    s.gl.render=(scene,camera)=>{const result=render(scene,camera);if(scene===s.scene&&editMetrics.started&&!editMetrics.firstDraw){let changed=false;scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&!editMetrics.oldGeometries.has(o.geometry))changed=true});if(changed&&!scene.userData.shaderWarmupPending&&!scene.userData.indirectScanPending)editMetrics.firstDraw=performance.now()-editMetrics.started}return result};
  })()`)
  const moves=[]
  for(const delta of [.25,.25]){
    const before=await evaluate('roofWallScene().scene.userData.indirectLighting.generation')
    await evaluate(`editMetrics.oldGeometries=new Set();roofWallScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')editMetrics.oldGeometries.add(o.geometry)});editMetrics.firstDraw=0;editMetrics.started=performance.now();regressionMoveWindow(${delta})`)
    await wait(`roofWallScene().scene.userData.indirectLighting.generation>${before}&&${ready}`,300000)
    const result=await evaluate('({visibleMs:editMetrics.firstDraw,totalMs:performance.now()-editMetrics.started,compiles:editMetrics.compiles,coordinators:giCoordinatorStarts,gi:roofWallScene().scene.userData.indirectLighting,glError:roofWallScene().gl.getContext().getError()})')
    moves.push(result);console.log('WINDOW',JSON.stringify({visibleMs:result.visibleMs,totalMs:result.totalMs,compiles:result.compiles,coordinators:result.coordinators,prepareMs:result.gi.prepareMs,timings:result.gi.prepareTimings,geometryRefitted:result.gi.geometryRefitted}))
    mkdirSync('tmp/colin-window',{recursive:true});writeFileSync('tmp/colin-window/report.json',JSON.stringify({moves,errors},null,2))
    assert.equal(result.glError,0)
    assert.ok(result.visibleMs>0)
    assert.equal(result.coordinators,1,'completed geometry edits keep the same coordinator')
    if(moves.length>1)assert.equal(result.gi.geometryRefitted,true,'the second local opening edit refits its existing BVH')
  }
  assert.deepEqual(errors,[])
  console.log('PASS Colin window moves complete')
}finally{ws?.close();browser.kill()}
