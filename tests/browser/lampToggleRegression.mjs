// With Vite and the asset portal running: node tests/browser/lampToggleRegression.mjs [port] [--measure]
// Exercises the actual Enabled checkbox for a rear-bedroom upstairs light.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('lamp-toggle-')}`, 'about:blank',
], { windowsHide: true })
let ws
const small = process.argv.includes('--small'), shadows = process.argv.includes('--shadows')
const floorIndex = small ? 0 : 1
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
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
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
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
  async function until(expression, description, timeout = 180000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return
      await pause(100)
    }
    throw Error(`Timed out: ${description}: ${JSON.stringify(await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting'))}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  const savedLighting = JSON.parse(readFileSync('colin_house_v2.json', 'utf8')).indirectLighting
  if (shadows) savedLighting.settings.lightShadows = true
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(savedLighting)}}};window.toggleWorkerCreations=0;const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);if(String(url).includes('indirectLighting.worker'))window.toggleWorkerCreations++}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?${small ? 'lighting-startup' : 'colin&materials&upper-selection'}&saved-gi&dormer-materials&strict` })
  await until('window.roofWallScene?.()?.scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'saved GI ready')
  await evaluate('window.roofWallScene().setDpr(.5)')
  const lamp = await evaluate(`(async()=>{const {modelsById}=await import('/src/models/modelLibrary.ts');const lamps=window.regressionFloors[${floorIndex}].models.filter(m=>modelsById.get(m.modelId)?.isLight);return lamps.find(m=>m.id==='f575a2eb-6e3e-4b1e-ac6c-189a442485ec')??lamps[0]})()`)
  assert.ok(lamp, 'upstairs fixture contains a light')
  await evaluate(`window.selectRegressionModel(${JSON.stringify(lamp.id)})`)
  await until('!window.roofWallScene().scene.userData.shaderWarmupPending && !window.roofWallScene().scene.userData.indirectLighting.blocked', 'selection ready')
  await pause(1500)
  await evaluate(`(()=>{const s=window.roofWallScene(),gl=s.gl.getContext(),create=gl.createProgram.bind(gl),render=s.gl.render.bind(s.gl);
    window.togglePrograms=0;gl.createProgram=(...args)=>{window.togglePrograms++;return create(...args)};
    s.gl.render=(scene,camera)=>{render(scene,camera);if(scene===s.scene&&window.toggleStarted&&window.toggleFirstFrame===null&&window.regressionFloors[${floorIndex}].models.find(m=>m.id===${JSON.stringify(lamp.id)}).lightEnabled===window.toggleExpected){window.toggleFirstFrame=performance.now()-window.toggleStarted;window.toggleFirstPrograms=window.togglePrograms}};
  })()`)
  const results = []
  for (const enabled of [false, true, false]) {
    const before = await evaluate('window.roofWallScene().scene.userData.indirectLighting')
    if (process.argv.includes('--profile')) { await call('Profiler.enable'); await call('Profiler.start') }
    await evaluate(`(()=>{const field=[...document.querySelectorAll('.context-field')].find(e=>e.querySelector('dt')?.textContent==='Enabled'),input=field?.querySelector('input');if(!input)throw Error('No Enabled checkbox');window.togglePrograms=0;window.toggleFirstFrame=null;window.toggleFirstPrograms=null;window.toggleExpected=${enabled};window.toggleStarted=performance.now();window.houseDesignerEngineLog.clear();input.click()})()`)
    await until('window.toggleFirstFrame!==null', 'light toggle displayed')
    if (process.argv.includes('--profile')) {
      const { profile } = await call('Profiler.stop')
      writeFileSync(`.tmp-lamp-toggle-${results.length}.cpuprofile`, JSON.stringify(profile))
    }
    await until(`window.roofWallScene().scene.userData.indirectLighting.generation>${before.generation} && window.roofWallScene().scene.userData.indirectLighting.state==='ready'`, 'GI toggle completed')
    const result = await evaluate(`(()=>{const s=window.roofWallScene(),status=s.scene.userData.indirectLighting;return {enabled:${enabled},firstFrameMs:window.toggleFirstFrame,firstPrograms:window.toggleFirstPrograms,programs:window.togglePrograms,bakeMs:performance.now()-window.toggleStarted,geometryBuilds:status.geometryBuilds,workerCreations:window.toggleWorkerCreations,source:status.source,partial:status.partial,firstPreviewMs:status.firstPreviewMs,visiblePointLights:s.scene.children.filter(o=>o.isPointLight&&o.visible).length,poweredPointLights:s.scene.children.filter(o=>o.isPointLight&&o.visible&&o.power>0).length,shadowSlots:s.scene.children.filter(o=>o.isPointLight&&o.visible&&o.castShadow).length,shadowMaps:s.scene.children.filter(o=>o.isPointLight&&o.shadow?.map).length,warmups:window.houseDesignerEngineLog.entries.filter(e=>e.type==='shader-warmup-start').length}})()`)
    results.push(result); console.log(result)
    if (!process.argv.includes('--measure')) {
      assert.ok(result.firstFrameMs < 2000, 'light switch displays within two seconds')
      assert.equal(result.firstPrograms, 0, 'light switch does not compile display shaders')
      assert.equal(result.warmups, 0, 'light switch retains scene shader preparation')
      if (shadows) {
        const shadowBudget = await evaluate('Math.max(1,window.roofWallScene().gl.capabilities.maxTextures-14)')
        assert.equal(result.shadowSlots, Math.min(result.visiblePointLights, shadowBudget), 'shadow shader counts remain allocated within the texture budget')
        assert.equal(result.shadowMaps, result.shadowSlots, 'switching off retains allocated shadow maps')
      }
      if (results.length > 1) {
        // Turning on may restore the original saved bake (whose diagnostics
        // report zero builds). The next off cycle must reuse the live worker.
        assert.equal(result.workerCreations, results[0].workerCreations, 'on/off retains the GI worker')
        assert.equal(result.geometryBuilds, result.source === 'saved' ? 0 : results[0].geometryBuilds, 'on/off reuses prepared GI geometry and lamp visibility')
        assert.equal(result.visiblePointLights, results[0].visiblePointLights, 'light slots remain allocated')
        assert.equal(result.poweredPointLights, results[0].poweredPointLights + (enabled ? 1 : 0), 'the light actually switches off and on')
      }
    }
  }
  assert.deepEqual(errors, [])
  if (process.argv.includes('--profile')) console.log('Scene features', await evaluate(`(async()=>{const s=window.roofWallScene(),materials=new Set();let objects=0;s.scene.traverse(o=>{objects++;for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m)});const {getShaderWarmupSceneRevision}=await import('/src/shaderWarmup.ts');const started=performance.now(),revision=getShaderWarmupSceneRevision(s.scene);return {objects,materials:materials.size,maxProgramKey:Math.max(...[...materials].map(m=>m.customProgramCacheKey().length)),revisionLength:revision.length,scanMs:performance.now()-started}})()`))
  writeFileSync(`.tmp-gi-lamp-toggle-${small ? 'small-' : ''}${shadows ? 'shadows-' : ''}${process.argv.includes('--measure') ? 'before' : 'after'}.json`, JSON.stringify(results, null, 2))
  console.log('Upstairs light toggle regression passed')
} finally { ws?.close(); child.kill() }
