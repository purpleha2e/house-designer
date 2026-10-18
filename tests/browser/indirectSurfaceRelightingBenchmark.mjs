// Vite + asset portal: node tests/browser/indirectSurfaceRelightingBenchmark.mjs [port] [--uncached]
// new_test.json stays a local fixture: no project data is saved or overwritten.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const cached = !process.argv.includes('--uncached'), port = process.argv[2] ?? '5186', toggle = process.argv.includes('--toggle')
const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,850',
  `--user-data-dir=${createBrowserTestProfile('surface-relight-benchmark-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
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
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='update'||m.type==='full-reload')event.stopImmediatePropagation()})}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?new-test&materials${toggle?'&dormer-materials':''}` })
  const status = () => evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting')
  for (let i = 0; i < 1800; i++) {
    assert.deepEqual(errors, [])
    if (await evaluate('window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === "full"')) break
    await pause(100)
  }
  const initial = await status(); assert.equal(initial.state, 'ready')
  await evaluate(`window.roofWallScene().scene.userData.indirectSurfaceCacheEnabled=${cached}`)
  const lamp = await evaluate(`(async()=>{const {modelsById}=await import('/src/models/modelLibrary.ts');return window.regressionFloors.flatMap(f=>f.models).filter(m=>modelsById.get(m.modelId)?.isLight)[${toggle&&!process.argv.includes('--spot')?2:0}]?.id})()`)
  assert.ok(lamp, 'The fixture needs a local lamp')
  await evaluate(`window.selectRegressionModel(${JSON.stringify(lamp)})`)
  await pause(1000)
  if(process.argv.includes('--resource-debug')){
    for(let i=0;i<300&&await evaluate('window.roofWallScene().scene.userData.shaderWarmupPending');i++)await pause(100)
    const resourceState=()=>evaluate(`(async()=>{const {getShaderWarmupResourceRevision}=await import('/src/shaderWarmup.ts');const s=window.roofWallScene();return {revision:getShaderWarmupResourceRevision(s.scene),lastWarmup:s.scene.userData.shaderWarmupProfile?.at(-1)?.startedAt,pending:s.scene.userData.shaderWarmupPending}})()`)
    const before=await resourceState();await pause(1500);const after=await resourceState()
    assert.equal(after.revision,before.revision,'idle room picking buffers must retain their identities')
    assert.equal(after.lastWarmup,before.lastWarmup,'idle picking buffers must not restart preparation')
    assert.equal(after.pending,false)
    console.log('PASS stable room picking buffers and idle shader preparation')
    ws.close();child.kill();process.exit(0)
  }
  await evaluate(`(()=>{const s=window.roofWallScene(),gl=s.gl.getContext(),create=gl.createProgram.bind(gl),render=s.gl.render.bind(s.gl),model=window.regressionFloors.flatMap(f=>f.models).find(m=>m.id===${JSON.stringify(lamp)}),lights=[];s.scene.traverse(o=>{if(o.isPointLight||o.isSpotLight)lights.push(o)});const light=lights.find(o=>Math.abs(o.position.x-model.position.x)<.00001&&Math.abs(o.position.z-model.position.y)<.00001),kind=light.type,index=lights.filter(o=>o.type===kind).indexOf(light);window.toggleProfile={programs:[],frames:[],powerChanges:[]};let value=light.intensity;Object.defineProperty(light,'intensity',{configurable:true,get:()=>value,set:v=>{if(value!==v)toggleProfile.powerChanges.push({at:performance.now(),value:v});value=v}});gl.createProgram=()=>{toggleProfile.programs.push(performance.now());return create()};s.gl.render=(scene,camera)=>{const result=render(scene,camera);if(scene===s.scene||scene.userData.retainedViewport){const points=[];scene.traverse(o=>{if(o.type===kind)points.push(o.intensity)});toggleProfile.frames.push({at:performance.now(),retained:!!scene.userData.retainedViewport,points:[points[index]]});if(toggleProfile.frames.length>2000)toggleProfile.frames.shift()}return result}})()`)
  const samples = []
  for (const [name, change] of toggle ? [['cold-off',false],['warm-on',true],['warm-off',false]] : [
    ['prepare-cache', 'lightPower:(m.lightPower??1000)*.9'],
    ['warm-power', 'lightPower:(m.lightPower??1000)*1.1'],
    ['warm-move', 'position:{...m.position,x:m.position.x+.2}'],
  ]) {
    const generation = (await status()).generation, started = Date.now()
    await evaluate('window.toggleStarted=performance.now();window.toggleProfile.programs=[];window.toggleProfile.frames=[];window.toggleProfile.powerChanges=[]')
    if(toggle){
      const click=await evaluate(`(()=>{const input=[...document.querySelectorAll('.context-field')].find(e=>e.querySelector('dt')?.textContent==='Enabled')?.querySelector('input');if(!input)throw Error('Missing lamp Enabled control');window.toggleStarted=performance.now();if(input.checked!==${change})input.click();return {handlerMs:performance.now()-toggleStarted,uniformAppliedMs:toggleProfile.powerChanges.find(p=>${change?'p.value>0':'p.value===0'})?.at-toggleStarted}})()`)
      console.log('CLICK',name,click)
      assert.ok(Number.isFinite(click.uniformAppliedMs)&&click.uniformAppliedMs<=click.handlerMs,'Enabled must update the installed light before the handler returns: '+JSON.stringify(click))
    }
    else await evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id===${JSON.stringify(lamp)}?{...m,${change}}:m)})))`)
    let firstVisibleMs, result, readySince
    for (let i = 0; i < 6000; i++) {
      assert.deepEqual(errors, [])
      await pause(100); result = await status()
      if (result.generation <= generation || result.pendingUpdate || result.blocked) { readySince = undefined; continue }
      if (firstVisibleMs === undefined && result.previewUpdates > 0) firstVisibleMs = Date.now() - started
      if (i % 100 === 0) console.log(name, Date.now() - started, result.state, result.completed, result.total)
      if (result.state === 'ready' && !result.volumePending && !result.pendingLighting && !await evaluate('window.roofWallScene().scene.userData.shaderWarmupPending')) {
        readySince ??= Date.now()
        if (Date.now() - readySince >= 500) break
      } else readySince = undefined
    }
    assert.equal(result.state, 'ready', name + ' did not complete')
    if (cached && !toggle && name !== 'prepare-cache') {
      assert.ok(result.surfaceRelitProbes > 0, name + ' must reuse surfaces')
      assert.equal(result.surfaceDataFaces, 0, name + ' must not recapture materials')
    }
    const measured=await evaluate(`({programs:toggleProfile.programs.length,uniformAppliedMs:toggleProfile.powerChanges.find(p=>${change===true?'p.value>0':'p.value===0'})?.at-toggleStarted,firstDisplayedOffMs:toggleProfile.frames.find(f=>f.at>=toggleStarted&&f.points.length===1&&f.points[0]===0)?.at-toggleStarted,newWarmups:window.roofWallScene().scene.userData.shaderWarmupProfile?.filter(p=>p.startedAt>toggleStarted).length,warmup:window.roofWallScene().scene.userData.shaderWarmupProfile?.filter(p=>p.startedAt>toggleStarted).map(p=>({started:p.startedAt,stages:p.stages,cancelled:p.cancelled}))})`)
    if(toggle)assert.ok(Number.isFinite(measured.uniformAppliedMs),'Enabled must change light uniforms before model/GI preparation')
    if (toggle && name !== 'cold-off') {
      assert.equal(measured.programs, 0, 'A repeated lamp switch must reuse installed shader programs')
      assert.ok(measured.newWarmups <= 1, 'A lamp switch must not restart preparation repeatedly')
    }
    const sample = { name, firstVisibleMs, completeMs: Date.now() - started, ...measured, ...result }
    samples.push(sample); console.log('RESULT', JSON.stringify({name,firstVisibleMs,nearDiffuseReadyMs:result.nearDiffuseReadyMs,nearReadyMs:result.nearReadyMs,completeMs:sample.completeMs,programs:measured.programs,uniformAppliedMs:measured.uniformAppliedMs,firstDisplayedOffMs:measured.firstDisplayedOffMs,newWarmups:measured.newWarmups,capturedFaces:result.capturedFaces,surfaceRelitProbes:result.surfaceRelitProbes,geometryBuilds:result.geometryBuilds}))
  }
  if (toggle) {
    const resourceState = () => evaluate(`(async()=>{const {getShaderWarmupResourceRevision}=await import('/src/shaderWarmup.ts');const s=window.roofWallScene();return {revision:getShaderWarmupResourceRevision(s.scene),lastWarmup:s.scene.userData.shaderWarmupProfile?.at(-1)?.startedAt,pending:s.scene.userData.shaderWarmupPending}})()`)
    const before = await resourceState(); await pause(1500); const after = await resourceState()
    assert.deepEqual(after, before, 'Idle pick buffers must not restart scene preparation')
    assert.equal(after.pending, false)
  }
  const report = { cached, initial, samples, errors }
  writeFileSync(`.tmp-surface-relighting-${toggle?'toggle-':''}${cached ? 'cached' : 'ordinary'}.json.local`, JSON.stringify(report, null, 2))
  console.log('PASS', cached ? 'cached' : 'ordinary')
} finally { ws?.close(); child.kill() }
