// With Vite on 5180 and a prepared Colin viewer:
// node tests/browser/windowPlacementPerformance.mjs [--max-display-ms=5000]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--user-data-dir=${createBrowserTestProfile('window-placement-')}`, 'about:blank',
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

  const project = JSON.parse(readFileSync('colin_house_v2.json', 'utf8'))
  await call('Fetch.enable', { patterns: [{ urlPattern: '*colin_house_v2.json*' }] })
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.method === 'Fetch.requestPaused') void call('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from('export default ' + JSON.stringify(project)).toString('base64') })
  })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.regressionFirstUseMaterial=' + process.argv.includes('--first-use-material') + ';window.regressionExtraOperations=' + process.argv.includes('--operations') + ';window.regressionSavedGI=' + JSON.stringify({ project }) })
  await call('Page.navigate', { url: process.argv.includes('--production')
    ? 'http://127.0.0.1:5184/tests/browser/roofWallRegression.html?colin&materials&saved-gi'
    : 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&published-materials&saved-gi' })
  const pause = ms => new Promise(r => setTimeout(r, ms))
  let capturedStartup = false
  for (let i = 0; i < 1200; i++) {
    await pause(250)
    if (errors.length) throw Error(JSON.stringify(errors))
    const ready = await evaluate(`(()=>{
      const s=window.roofWallScene?.();if(!s)return null;
      if(!window.startupGlass){
        const original=s.gl.render.bind(s.gl),metrics=window.startupGlass={checked:0,failures:[]};
        window.restoreStartupRender=()=>s.gl.render=original;
        s.gl.render=(display,camera)=>{
          if(camera===s.camera&&display!==s.scene&&s.scene.userData.progressiveStartup?.phase!=='full'){
            const glass=new Map();s.scene.traverse(o=>{
              if(!o.isMesh)return;const materials=Array.isArray(o.material)?o.material:[o.material];
              if(materials.some(m=>m.transparent&&m.opacity>0&&m.opacity<.95||m.transmission>0))glass.set(o.geometry,materials);
            });
            display.traverseVisible(o=>{
              const source=glass.get(o.geometry);if(!source)return;
              const materials=Array.isArray(o.material)?o.material:[o.material];
              source.forEach((m,i)=>{if(!(m.transparent&&m.opacity>0&&m.opacity<.95||m.transmission>0))return;
                metrics.checked++;if(!materials[i]?.transparent||materials[i].opacity>=1)metrics.failures.push(m.name);
              });
            });
          }
          return original(display,camera);
        };
      }
      const d=s.scene.userData;return {indirectLighting:{state:d.indirectLighting?.state},shaderWarmupPending:d.shaderWarmupPending,
        progressiveStartup:d.progressiveStartup,preparation:d.viewportPreparation,glass:window.startupGlass};
    })()`)
    if (i % 100 === 0) console.log('Preparing', JSON.stringify(ready))
    if (!capturedStartup && ready?.glass.checked && ready?.progressiveStartup?.phase !== 'full') {
      const shot = await call('Page.captureScreenshot', { format: 'png' })
      writeFileSync('node_modules/.cache/startup-glass.png', Buffer.from(shot.data, 'base64'))
      capturedStartup = true
    }
    if (ready?.progressiveStartup?.phase === 'full' && !ready?.shaderWarmupPending) break
    if (i === 1199) throw Error('House startup did not finish')
  }
  const startup = await evaluate('(()=>{window.restoreStartupRender?.();return {glass:window.startupGlass,startup:window.roofWallScene().scene.userData.progressiveStartup}})()')
  writeFileSync('node_modules/.cache/startup-result.json', JSON.stringify(startup, null, 2))
  assert.ok(startup.glass.checked > 0, 'startup actually displays glass')
  assert.deepEqual(startup.glass.failures, [], 'startup display preserves transparent windows')
  if (process.argv.includes('--gable-materials')) {
    const audit = await evaluate(`(()=>{
      const s=window.roofWallScene(),gables=[],walls=[];
      s.scene.traverse(o=>{if(o.isMesh&&o.userData.solidGable&&!o.userData.interior)gables.push(o);
        if(o.isMesh&&o.userData.houseDesignerRole==='wall-engine-render')walls.push(o)});
      const pairs=[];
      for(const gable of gables){const a=gable.material;if(!a.map)continue;
        const b=walls.flatMap(o=>Array.isArray(o.material)?o.material:[o.material]).find(m=>
          m.map?.source===a.map.source&&m.normalMap?.source===a.normalMap?.source&&m.color.equals(a.color));
        if(b)pairs.push({gable:gable.userData.roofId,wallReceiver:b.customProgramCacheKey().includes('wall-shadow-receiver-v1'),
          gableReceiver:a.customProgramCacheKey().includes('wall-shadow-receiver-v1'),normal:a.normalScale.toArray(),wallNormal:b.normalScale.toArray(),
          roughness:a.roughness,wallRoughness:b.roughness,metalness:a.metalness,wallMetalness:b.metalness});
      }
      const gable=gables.filter(o=>o.material.map).sort((a,b)=>b.geometry.boundingSphere.radius-a.geometry.boundingSphere.radius)[0];
      if(gable){const centre=gable.geometry.boundingSphere.centre??gable.geometry.boundingSphere.center;
        const target=centre.clone().applyMatrix4(gable.matrixWorld),normal=target.clone().fromBufferAttribute(gable.geometry.attributes.normal,0).transformDirection(gable.matrixWorld);
        s.camera.position.copy(target).addScaledVector(normal,8);s.camera.lookAt(target);s.camera.updateMatrixWorld();}
      return pairs;
    })()`)
    assert.ok(audit.length > 0, 'compare real textured Colin gables and matching wall finishes')
    for (const pair of audit) {
      assert.ok(pair.wallReceiver && pair.gableReceiver, 'gable and wall share corrected shadow filtering')
      assert.deepEqual(pair.normal, pair.wallNormal, 'gable and wall agree on normal strength and convention')
      assert.equal(pair.roughness, pair.wallRoughness); assert.equal(pair.metalness, pair.wallMetalness)
    }
    console.log('Gable material audit', JSON.stringify(audit))
    await pause(300)
    writeFileSync('node_modules/.cache/gable-wall-materials.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  const previewOnly = process.argv.includes('--preview-only')
  const result = await evaluate(readFileSync(previewOnly ? 'tests/browser/openingPreviewPerformance.js' : 'tests/browser/windowPlacementPerformance.js', 'utf8'))
  const { warmup, ...summary } = result
  console.log(JSON.stringify({ ...summary, warmup: warmup?.map(({ stages }) => stages) }, null, 2))
  writeFileSync('node_modules/.cache/window-placement-result.json', JSON.stringify(result, null, 2))
  assert.ok(result.displayMs !== null, 'new window reaches an actual display draw')
  if (!previewOnly) {
  assert.equal(result.logs.filter(e => e.type === 'level-preparation-start').length, 0,
    'adding the first opening does not rebuild floor topology')
  assert.equal(result.logs.filter(e => e.type === 'wall-roof-clipping-complete').length, 1,
    'only the changed floor needs one wall clipping update')
  }
  if (previewOnly) {
    assert.equal(result.logs.filter(e => /model-load|shader-warmup-start|level-preparation-start|wall-roof-clipping-complete/.test(e.type)).length, 0,
      'positioning a window does not load its model or prepare the building again')
    assert.equal(result.raycasts, 0, 'a compatible wall is found without raycasting furniture')
  }
  if (process.argv.includes('--edits')) {
    const profiling = process.argv.includes('--profile')
    const tracing = process.argv.includes('--trace'), trace = []
    let traceDone
    const traced = new Promise(resolve => { traceDone = resolve })
    ws.addEventListener('message', event => {
      const m = JSON.parse(event.data)
      if (m.method === 'Tracing.dataCollected') trace.push(...m.params.value)
      if (m.method === 'Tracing.tracingComplete') traceDone()
    })
    if (tracing) await call('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' })
    if (profiling) { await call('Profiler.enable'); await call('Profiler.start') }
    await call('Performance.enable')
    const { metrics: clocks } = await call('Performance.getMetrics')
    const clockTimestamp = clocks.find(metric => metric.name === 'Timestamp').value * 1000
    const pageTimestamp = await evaluate('performance.now()')
    const edits = await evaluate(readFileSync('tests/browser/sceneEditPerformance.js', 'utf8'))
    if (tracing) { await call('Tracing.end'); await traced; writeFileSync('node_modules/.cache/scene-edit-trace.json', JSON.stringify(trace)) }
    if (profiling) {
      const { profile } = await call('Profiler.stop')
      writeFileSync('node_modules/.cache/scene-edit.cpuprofile', JSON.stringify(profile))
      writeFileSync('node_modules/.cache/scene-edit.json', JSON.stringify({ profilerOffsetMs: pageTimestamp - (clockTimestamp - profile.startTime / 1000) }))
    }
    console.log('Scene edits', JSON.stringify(edits.map(({ tasks, ...result }) => ({ ...result, longTasks: tasks.length })), null, 2))
    writeFileSync('node_modules/.cache/scene-edit-result.json', JSON.stringify(edits, null, 2))
    const screenshot = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync('node_modules/.cache/scene-edit.png', Buffer.from(screenshot.data, 'base64'))
    for (const edit of edits) assert.ok(edit.displayMs !== null, edit.label + ' reaches an actual display draw')
    if (process.argv.includes('--first-use-material')) {
      const firstUse=edits.find(edit=>edit.label==='first-use wall finish')
      const batches=firstUse.profiles.flatMap(profile=>profile.batches??[])
      assert.ok(batches.length>0,'first-use fixture exercises actual new shader preparation')
      assert.ok(batches.reduce((total,batch)=>total+batch.objects,0)<40,'first-use finish avoids recompiling the furnished house')
      const restored=edits.find(edit=>edit.label==='restore wall finish')
      assert.equal(restored.profiles.flatMap(profile=>profile.batches??[]).length,0,'returning to a loaded finish reuses its maps and shaders')
    }
    assert.deepEqual(errors, [], 'editing produces no runtime or WebGL errors')
    const stallBudget = process.argv.find(a => a.startsWith('--max-ui-stall-ms='))?.split('=')[1]
    if (stallBudget) for (const edit of edits) assert.ok(edit.maxUiGapMs < Number(stallBudget), edit.label + ' keeps UI responsive')
  }
  // Wall-clock budgets depend on whether Chrome has a hardware GPU or SwiftShader.
  // The work-count assertions above catch the regression on either renderer.
  const budget = process.argv.find(arg => arg.startsWith('--max-display-ms='))?.split('=')[1]
  if (budget !== undefined) {
    assert.ok(Number.isFinite(Number(budget)) && Number(budget) > 0, 'display budget must be positive')
    assert.ok(result.displayMs < Number(budget), 'new window reaches the display within the supplied budget')
  }
  assert.deepEqual(errors, [])
} finally { ws?.close(); child.kill() }
