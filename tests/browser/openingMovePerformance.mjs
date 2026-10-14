// Run with Vite and the asset portal: node tests/browser/openingMovePerformance.mjs [port] [--profile] [--assert]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--user-data-dir=${createBrowserTestProfile('opening-move-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id)
    if (request) { pending.delete(result.id); result.error ? request.reject(result.error) : request.resolve(result.result) }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(a => a.value ?? a.description))
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
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  const cachePath = '.tmp-opening-move-cache.json', cached = existsSync(cachePath)
  if (cached) await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${readFileSync(cachePath, 'utf8')}}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? '5180'}/tests/browser/roofWallRegression.html?colin&materials${cached ? '&saved-gi' : ''}` })
  const pause = ms => new Promise(r => setTimeout(r, ms))
  for (let i = 0; i < 1200; i++) {
    await pause(500)
    const state = await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state')
    if (i % 40 === 0) console.log('Loading', state)
    if (state === 'ready') break
  }
  for (let i = 0; i < 50; i++) {
    const cache = await evaluate('JSON.stringify(window.roofWallScene().scene.userData.getBakedIndirectLighting?.())')
    if (cache) { writeFileSync(cachePath, cache); break }
    await pause(100)
  }
  await evaluate(`(async()=>{
    const {syncWallOpenings}=await import('/src/modelPlacement.ts'),{modelsById}=await import('/src/models/modelLibrary.ts');
    const s=window.roofWallScene();
    const f=window.regressionFloors[0], m=f.models.find(m=>m.wallAttachment&&modelsById.get(m.modelId)?.wallMount==='window');
    if(!m)throw Error('No window');
    const wall=f.walls.find(w=>w.id===m.wallAttachment.wallId), length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
    window.moveWindow=()=>window.updateRegressionFloors(window.regressionFloors.map(floor=>floor.id===f.id?syncWallOpenings({...floor,models:floor.models.map(model=>model.id===m.id?{...model,position:{x:model.position.x+.15*(wall.end.x-wall.start.x)/length,y:model.position.y+.15*(wall.end.y-wall.start.y)/length},wallAttachment:{...model.wallAttachment,offset:model.wallAttachment.offset+.15}}:model)},modelsById):floor));
    window.moveFloorId=f.id;window.moveModelId=m.id;
    s.setDpr(.6);s.invalidate();
  })()`)
  await pause(500)
  if (process.argv.includes('--profile')) { await call('Profiler.enable'); await call('Profiler.start') }
  const measure = () => evaluate(`(async()=>{
    const s=window.roofWallScene(), started=performance.now(), metrics={startedAt:started,frames:[],newPrograms:0,geometryMs:null,displayMs:null};
    const geometryKeys=new WeakMap();
    const wallKey=()=>{const a=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.userData.floorId===window.moveFloorId){let key=geometryKeys.get(o.geometry);if(key===undefined){const p=o.geometry.attributes.position,vertices=new Set();for(let i=0;i<p.count;i++)vertices.add([p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(','));key=[...vertices].sort().join('|');geometryKeys.set(o.geometry,key)}a.push(key)}});return a.sort().join(';')};
    const before=wallKey(), render=s.gl.render.bind(s.gl), context=s.gl.getContext(), create=context.createProgram.bind(context);
    context.createProgram=(...a)=>{metrics.newPrograms++;return create(...a)};
    s.gl.render=(scene,camera)=>{if(scene===s.scene&&camera===s.camera){const t=performance.now()-started;metrics.frames.push(t);if(wallKey()!==before&&metrics.displayMs===null)metrics.displayMs=t;}return render(scene,camera)};
    window.houseDesignerEngineLog?.clear();window.moveWindow();
    await new Promise(resolve=>{function frame(){const t=performance.now()-started;if(wallKey()!==before&&metrics.geometryMs===null)metrics.geometryMs=t;if(t>15000||(metrics.displayMs!==null&&t>Math.max(4000,metrics.displayMs+1500)))resolve();else requestAnimationFrame(frame)}requestAnimationFrame(frame)});
    s.gl.render=render;context.createProgram=create;
    return {...metrics,gi:s.scene.userData.indirectLighting,logs:window.houseDesignerEngineLog?.entries};
  })()`)
  const results = []
  for (let move = 0; move < 3; move++) {
    const result = await measure()
    results.push(result)
    console.log(JSON.stringify({move:move+1,geometryMs:result.geometryMs,displayMs:result.displayMs,newPrograms:result.newPrograms,firstFrame:result.frames[0],logs:result.logs?.filter(l=>/clipping|warmup|preparation/.test(l.type))}))
  }
  if (process.argv.includes('--profile')) { const { profile } = await call('Profiler.stop'); writeFileSync('.tmp-opening-move.cpuprofile', JSON.stringify(profile)) }
  writeFileSync('.tmp-opening-move.json', JSON.stringify(results, null, 2))
  for (const result of results) {
    assert.ok(result.displayMs !== null, 'updated wall is actually drawn')
    if (process.argv.includes('--assert')) {
      assert.ok(result.displayMs < 1500, 'opening reaches the display promptly')
      assert.ok((result.logs?.filter(l=>l.type==='wall-roof-clipping-complete').length ?? 0) <= 1, 'untouched floor reuses clipped walls')
      assert.equal(result.newPrograms, 0, 'moving the opening reuses its shaders')
    }
  }
  assert.deepEqual(errors, [])
} finally { ws?.close(); child.kill() }
