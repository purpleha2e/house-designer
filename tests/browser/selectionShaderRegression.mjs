// With Vite running: node tests/browser/selectionShaderRegression.mjs [port] [--colin]
// --colin also needs the asset portal and tests the two rear upstairs windows.
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { readFileSync } from 'node:fs'

const colin = process.argv.includes('--colin')

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('selection-shaders-')}`, 'about:blank',
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
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (colin) await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(JSON.parse(readFileSync('colin_house_v2.json','utf8')).indirectLighting)}}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?${colin ? 'colin&materials&' + (process.argv.includes('--switch-floor') ? '' : 'upper-selection&') + 'saved-gi' : 'lighting-startup&selection-shaders'}&strict` })
  for (let i = 0; i < 2400; i++) {
    await pause(250)
    if (i % 120 === 0) console.log('Loading', await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state'))
    if (i === 40) await evaluate('window.roofWallScene?.()?.setDpr(.5)')
    if (await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state === "ready"')) break
  }
  assert.equal(await evaluate('window.roofWallScene().scene.userData.indirectLighting.state'), 'ready')
  for(let i=0;i<600;i++){
    await pause(100)
    if(await evaluate('!window.roofWallScene().scene.userData.shaderWarmupPending&&!window.roofWallScene().scene.userData.indirectLighting.blocked'))break
  }
  await pause(1500)
  await evaluate(`(() => {const s=window.roofWallScene(), gl=s.gl.getContext(), create=gl.createProgram.bind(gl);
    window.selectionPrograms=0;gl.createProgram=(...args)=>{window.selectionPrograms++;return create(...args)};
    window.selectionGeneration=s.scene.userData.indirectLighting.generation;window.houseDesignerEngineLog.clear();
    window.selectionFrames=0;const render=s.gl.render.bind(s.gl);s.gl.render=(scene,camera)=>{render(scene,camera);if(scene===s.scene){window.selectionFrames++;if(window.selectionStarted&&window.selectionFirstFrame===null&&window.regressionSelectedModelId===window.selectionExpected)window.selectionFirstFrame=performance.now()-window.selectionStarted}};
    s.camera.position.set(4,2,-6);s.camera.lookAt(4,1,0);s.controls?.target?.set(4,1,0);s.invalidate();})()`)
  const results = []
  const models = colin ? await evaluate(`(async()=>{const {modelsById}=await import('/src/models/modelLibrary.ts');return window.regressionFloors[1].models.filter(m=>modelsById.get(m.modelId)?.windowDesign||m.modelId.includes('patio-door')).sort((a,b)=>Number(b.modelId.includes('patio-door'))-Number(a.modelId.includes('patio-door'))).slice(0,3).map(m=>m.id)})()`) : ['selection-window-1', 'selection-window-2', 'selection-door']
  console.log('Models', models)
  for (const selected of [models[0], models[1], models[0], models[2] ?? models[1], models[1], null, models[0], null]) {
    if (selected) {
      const point = await evaluate(`(async()=>{const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js'),s=window.roofWallScene();
        const object=s.scene.getObjectByName('model-transform-'+${JSON.stringify(selected)}), box=new Box3().setFromObject(object), center=box.getCenter(new Vector3());
        const floor=window.regressionFloors.find(f=>f.models.some(m=>m.id===${JSON.stringify(selected)})), model=floor.models.find(m=>m.id===${JSON.stringify(selected)}),wall=floor.walls.find(w=>w.id===model.wallAttachment.wallId);
        const normal=new Vector3(wall.end.y-wall.start.y,0,wall.start.x-wall.end.x).normalize();
        const distance=${process.argv.includes('--inside') ? 'model.wallAttachment.side === 1 ? 2 : -2' : '3'};
        s.camera.position.copy(center).addScaledVector(normal,distance);s.camera.lookAt(center);s.controls?.target?.copy(center);s.camera.updateMatrixWorld();s.invalidate();
        const rect=s.gl.domElement.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`)
      await pause(600)
      await evaluate(`window.selectionFrames=0;window.selectionStarted=performance.now();window.selectionFirstFrame=null;window.selectionExpected=${JSON.stringify(selected)}`)
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    } else await evaluate(`window.selectRegressionModel(${JSON.stringify(selected)})`)
    await pause(1800)
    const result = await evaluate(`(() => {const s=window.roofWallScene(), helpers=[];s.scene.traverse(o=>{if(o.name==='model-selection-highlight')helpers.push(o)});
      return {programs:window.selectionPrograms, highlights:helpers.length, warmups:window.houseDesignerEngineLog.entries.filter(e=>e.type==='shader-warmup-start').length,
        handlesVisible:s.scene.children.filter(o=>o.isTransformControls).every(o=>o.visible),
        frames:window.selectionFrames, firstFrameMs:window.selectionFirstFrame, blocked:s.scene.userData.indirectLighting.blocked, state:s.scene.userData.indirectLighting.state,
        generation:s.scene.userData.indirectLighting.generation, originalGeneration:window.selectionGeneration,
        activity:window.houseDesignerEngineLog.entries.filter(e=>['scene-preparation-timeout','shader-warmup-start','shader-warmup-reason','shader-warmup-complete','shader-warmup-timeout'].includes(e.type))};})()`)
    results.push({ selected, ...result }); console.log(results.at(-1))
    assert.equal(await evaluate('window.regressionSelectedModelId'), selected, 'click selects the intended model')
    assert.equal(result.highlights > 0, selected !== null, 'selection highlight appears and clears')
    assert.ok(result.handlesVisible, 'picking restores the transform handles')
    if(selected)assert.ok(result.firstFrameMs!==null&&result.firstFrameMs<(colin?2000:1000),'selection renders promptly after a click')
  }
  for (const result of results) {
    // The complete house can mount one new material family on a floor switch;
    // its program is already cached, and repeated selections must reuse it.
    assert.ok(result.warmups <= (colin?1:0), 'selection reuses retained shader preparation')
    assert.equal(result.programs, 0, 'selection uses programs prepared at startup')
    assert.equal(result.generation, result.originalGeneration, 'selection preserves GI')
  }
  assert.deepEqual(errors, [])
  console.log('Window/door selection shader regression passed')
} finally { ws?.close(); child.kill() }
