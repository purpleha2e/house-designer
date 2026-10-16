// Vite + asset portal running: node tests/browser/viewportResponsiveness.mjs [port] [seconds]
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,850',
  `--user-data-dir=${createBrowserTestProfile('viewport-response-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 15000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.on('error', reject); browser.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (p) { pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(r.error) : p.resolve(r.result) }
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map(a => a.value ?? a.description))
    if(r.method==='Log.entryAdded'&&r.params.entry.source==='rendering')console.log('GL:',r.params.entry.text)
  })
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(method + ' timed out')) }, 30000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  await call('Page.enable'); await call('Runtime.enable'); await call('Profiler.enable');await call('Log.enable');await call('Performance.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (process.argv.includes('--resources')) {
    await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/viewportResourcesRegression.html` })
    let result
    for(let i=0;i<300&&!result;i++) {
      await new Promise(resolve=>setTimeout(resolve,100));result=await evaluate('window.viewportResourcesResult')
      if(errors.length)throw Error(JSON.stringify(errors))
    }
    assert.ok(result,'Resource regression did not finish')
    console.log('PASS viewport resources:',result)
    ws.close();browser.kill();process.exit(0)
  }
  if (process.argv.includes('--bake-environment')) {
    await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/bakePbrEnvironment.html` })
    let baked
    for (let i=0;i<100&&!baked;i++) { await new Promise(resolve=>setTimeout(resolve,100)); baked=await evaluate('window.bakedPbrEnvironment') }
    if (!baked || errors.length) throw Error(JSON.stringify({ baked: !!baked, errors }))
    mkdirSync('src/assets/environments', { recursive: true })
    writeFileSync('src/assets/environments/roomEnvironment.bin.gz', gzipSync(Buffer.from(baked.base64, 'base64')))
    writeFileSync('src/assets/environments/roomEnvironment.json', JSON.stringify({ width:baked.width, height:baked.height })+'\n')
    console.log('Baked existing RoomEnvironment:', baked.width, baked.height)
    ws.close(); browser.kill(); process.exit(0)
  }
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='update'||m.type==='full-reload')event.stopImmediatePropagation()})}};
    window.responseProfile={tasks:[],gaps:[],draws:[],phases:[],retainedDraws:0,previewDraws:0};
    new PerformanceObserver(list=>{for(const e of list.getEntries())responseProfile.tasks.push({at:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true});
    let last=performance.now(),attached=false,lastDraw=0;
    function tick(now){if(now-last>50)responseProfile.gaps.push({at:last,ms:now-last});last=now;
      const s=window.roofWallScene?.();if(s&&!attached){attached=true;const render=s.gl.render.bind(s.gl);
        s.gl.render=(scene,camera)=>{const start=performance.now();render(scene,camera);if(scene.userData.initialViewportPreview)responseProfile.previewDraws++;if(scene.userData.retainedViewport)responseProfile.retainedDraws++;if(scene===s.scene||scene.userData.retainedViewport||scene.userData.initialViewportPreview){if(lastDraw)responseProfile.draws.push({at:start,gap:start-lastDraw,ms:performance.now()-start,retained:!!scene.userData.retainedViewport,preview:!!scene.userData.initialViewportPreview});lastDraw=start}};
      }requestAnimationFrame(tick)}requestAnimationFrame(tick);
  ` })
  await call('Profiler.start')
  console.log('Opening saved house...')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/roofWallRegression.html?colin&materials&upper-selection` })
  const until = Date.now() + Number(process.argv[3] ?? 60) * 1000
  let previewCaptured=false
  while (Date.now() < until) {
    if(errors.length)throw Error(JSON.stringify(errors))
    await new Promise(resolve => setTimeout(resolve, 1000))
    const state = await evaluate(`(()=>{const s=window.roofWallScene?.();if(!s)return null;const gi=s.scene.userData.indirectLighting;return {at:performance.now(),state:gi?.state,completed:gi?.completed,total:gi?.total,rooms:gi?.rooms,reflections:gi?.reflections,saved:gi?.saved,shaderPending:s.scene.userData.shaderWarmupPending}})()`)
    if (state) { await evaluate(`responseProfile.phases.push(${JSON.stringify(state)})`); if (state.at % 10000 < 1200) console.log('Scene', state) }
    if(!previewCaptured&&state?.at>18000&&await evaluate('responseProfile.previewDraws>0')){
      writeFileSync(`.tmp-viewport-${process.argv[4]??'latest'}-preview.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));previewCaptured=true
    }
  }
  if (process.argv.includes('--navigation')) {
    const deadline = Date.now()+180000
    while (!await evaluate('!!window.roofWallScene?.() && !window.roofWallScene().scene.userData.shaderWarmupPending && window.roofWallScene().scene.userData.indirectLighting?.state === "ready" && window.roofWallScene().scene.userData.indirectLighting?.saved && window.roofWallScene().gl.info.render.triangles > 0')) {
      if (Date.now()>deadline) throw Error('Scene never became navigable')
      await new Promise(resolve=>setTimeout(resolve,250))
    }
    await evaluate('window.roofWallScene().gl.domElement.focus();window.navStart=window.roofWallScene().camera.position.clone()')
    const lighting = await evaluate('window.roofWallScene().scene.userData.indirectLighting')
    assert.equal(await evaluate('window.roofWallScene().gl.getContext().getError()'),0,'resource preparation must not leave WebGL errors')
    writeFileSync(`.tmp-viewport-${process.argv[4]??'latest'}-ready.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    if(lighting.state==='ready')assert.equal(lighting.reflections,lighting.rooms,'every room must retain its worker-filtered reflection')
    await call('Input.dispatchKeyEvent', { type:'rawKeyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87 })
    await new Promise(resolve=>setTimeout(resolve,150))
    assert.ok(await evaluate('window.roofWallScene().camera.position.distanceTo(window.navStart)>.02'),'walk input must move the actual camera before injecting the stall')
    await evaluate('window.blockStart=window.roofWallScene().camera.position.clone();const until=performance.now()+700;while(performance.now()<until){}')
    const stallDistance = await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(window.roofWallScene().camera.position.distanceTo(window.blockStart)))))')
    await call('Input.dispatchKeyEvent', { type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87 })
    assert.ok(stallDistance<.6, `camera jumped ${stallDistance}m after an injected stall`)
    const retainedBefore = await evaluate('responseProfile.retainedDraws')
    const editStarted = await evaluate('window.editStart=window.roofWallScene().camera.position.clone();performance.now()')
    await evaluate(`window.updateRegressionFloors(floors=>floors.map((floor,i)=>i===1?{...floor,roofs:floor.roofs.map((roof,j)=>j===0?{...roof,pitchDegrees:(roof.pitchDegrees??30)+.25}:roof)}:floor))`)
    await call('Input.dispatchKeyEvent', { type:'rawKeyDown',code:'KeyD',key:'d',windowsVirtualKeyCode:68 })
    await new Promise(resolve=>setTimeout(resolve,1500))
    await call('Input.dispatchKeyEvent', { type:'keyUp',code:'KeyD',key:'d',windowsVirtualKeyCode:68 })
    const retainedAfter = await evaluate('responseProfile.retainedDraws')
    const editDistance = await evaluate('window.roofWallScene().camera.position.distanceTo(window.editStart)')
    assert.ok(editDistance>.2&&editDistance<8,'walk input must remain live at normal speed during preparation')
    const editMaxDrawGap = await evaluate(`Math.max(0,...responseProfile.draws.filter(d=>d.at>=${editStarted}).map(d=>d.gap))`)
    assert.ok(retainedAfter>retainedBefore, 'camera must keep drawing a prepared scene during a real geometry update')
    await evaluate(`responseProfile.navigation=${JSON.stringify({editStarted,stallDistance,editDistance,editMaxDrawGap,retainedDraws:retainedAfter-retainedBefore})}`)
    console.log('PASS navigation:', { stallDistance, editDistance, editMaxDrawGap, retainedDraws:retainedAfter-retainedBefore })
    await new Promise(resolve=>setTimeout(resolve,1500))
    const replacementDeadline=Date.now()+90000
    while(await evaluate('!!window.roofWallScene().scene.userData.shaderWarmupPending')) {
      if(errors.length)throw Error(JSON.stringify(errors))
      if(Date.now()>replacementDeadline)throw Error('Edited scene resources never became ready')
      await new Promise(resolve=>setTimeout(resolve,250))
    }
    // Return to a known room view: the navigation check can end inside a wall.
    await evaluate('window.roofWallScene().camera.position.copy(window.navStart);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.equal(await evaluate('window.roofWallScene().gl.getContext().getError()'),0,'edited geometry must render without WebGL errors')
    writeFileSync(`.tmp-viewport-${process.argv[4]??'latest'}-edited.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    console.log('PASS prepared replacement after navigation')
  }
  const { profile } = await call('Profiler.stop')
  const response = await evaluate('responseProfile')
  const metrics=await call('Performance.getMetrics')
  const navigationStart=metrics.metrics.find(metric=>metric.name==='NavigationStart')?.value
  response.profilerOffsetMs=navigationStart===undefined?undefined:profile.startTime/1000-navigationStart*1000
  const label = process.argv[4] ?? 'latest'
  writeFileSync(`.tmp-viewport-response-${label}.cpuprofile`, JSON.stringify(profile))
  writeFileSync(`.tmp-viewport-response-${label}.json`, JSON.stringify({ ...response, errors }, null, 2))
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), times = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    let node = nodes.get(profile.samples[i]); const dt = (profile.timeDeltas[i] ?? 0) / 1000
    const seen = new Set()
    while (node) {
      const f = node.callFrame, name = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/(src|node_modules)\//, '$1/').split('?')[0]}:${f.lineNumber + 1}`
      if (!seen.has(name)) { times.set(name, (times.get(name) ?? 0) + dt); seen.add(name) }
      node = nodes.get(node.parent)
    }
  }
  // CDP stores child links rather than parent links.
  for (const node of nodes.values()) for (const child of node.children ?? []) nodes.get(child).parent = node.id
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    let node = nodes.get(profile.samples[i]), first = true
    const dt = (profile.timeDeltas[i] ?? 0) / 1000, seen = new Set()
    while (node) {
      const f = node.callFrame, name = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/(src|node_modules)\//, '$1/').split('?')[0]}:${f.lineNumber + 1}`
      if (first) self.set(name, (self.get(name) ?? 0) + dt)
      if (!seen.has(name)) { if (!first) times.set(name, (times.get(name) ?? 0) + dt); seen.add(name) }
      first = false; node = nodes.get(node.parent)
    }
  }
  console.log(JSON.stringify({ errors, tasks: response.tasks.sort((a,b)=>b.ms-a.ms).slice(0,15), totalLongTaskMs:response.tasks.reduce((n,t)=>n+t.ms,0), phases:response.phases.filter((_,i)=>i%10===0), self:[...self].sort((a,b)=>b[1]-a[1]).slice(0,25), inclusive:[...times].filter(([n])=>n.includes('src/')).sort((a,b)=>b[1]-a[1]).slice(0,25) }, null, 2))
  assert.deepEqual(errors,[])
  const budget=process.argv.find(argument=>argument.startsWith('--max-edit-gap='))?.split('=')[1]
  if(budget!==undefined){
    assert.ok(Number.isFinite(Number(budget))&&Number(budget)>0,'edit gap budget must be positive milliseconds')
    assert.ok(response.navigation,'a release budget requires --navigation')
    assert.ok(response.navigation.editMaxDrawGap<=Number(budget),`edit draw gap ${response.navigation.editMaxDrawGap.toFixed(1)}ms exceeds ${budget}ms release budget`)
  }
} finally { ws?.close(); browser.kill() }
