// Move Colin windows and measure geometry/lighting latency: node tests/browser/windowMoveLatencyRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
  `--user-data-dir=${createBrowserTestProfile('colin-preview-')}`, 'about:blank',
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
      const failure=await evaluate('window.houseDesignerFastGI?.stats.error')
      if(failure)throw Error(failure)
      if (Date.now() > end) throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting'))}`)
      await pause(50)
    }
  }

  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', {source:`const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};`})
  await call('Page.addScriptToEvaluateOnNewDocument', {source:`window.giCoordinatorStarts=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);if(String(url).includes('indirectLighting.worker'))giCoordinatorStarts++}};`})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&saved-colin&preview-lighting`})
  const ready=`(()=>{const s=window.roofWallScene?.(),u=s?.scene.userData,g=u?.indirectLighting;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&!g?.blocked&&u.fastGI?.stats.state==='ready'})()`
  await wait(ready,300000)
  await evaluate(`(()=>{
    const floor=regressionFloors.find(f=>f.models.some(m=>/window/i.test(m.modelId)&&m.wallAttachment));
    const model=floor.models.find(m=>/window/i.test(m.modelId)&&m.wallAttachment),wall=floor.walls.find(w=>w.id===model.wallAttachment.wallId),opening=wall.openings.find(o=>o.id===model.id);
    const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz),x=wall.start.x+dx/length*opening.center,z=wall.start.y+dz/length*opening.center,y=floor.elevation+opening.bottom+opening.height/2;
    const s=roofWallScene();s.camera.position.set(x+dz/length*2,y,z-dx/length*2);s.camera.lookAt(x,y,z);s.camera.updateMatrixWorld();s.invalidate();
  })()`)
  await pause(500);await wait(ready,300000)
  console.log('Colin ready')
  await evaluate(`(()=>{
    const s=roofWallScene(),c=s.gl.getContext(),compile=c.compileShader.bind(c),render=s.gl.render.bind(s.gl);
    window.editMetrics={compiles:0,started:0,firstDraw:0,modelDraw:0,finalGeometry:0,states:[]};
    c.compileShader=shader=>{editMetrics.compiles++;return compile(shader)};
    s.gl.render=(scene,camera)=>{const result=render(scene,camera);if((scene===s.scene||scene.userData.retainedViewport)&&editMetrics.started){
      const model=s.scene.getObjectByName(editMetrics.modelName),p=model?.matrixWorld.elements;
      if(!editMetrics.modelDraw&&p&&Math.hypot(p[12]-editMetrics.expectedX,p[14]-editMetrics.expectedZ)<.00001)editMetrics.modelDraw=performance.now()-editMetrics.started;
      if(!editMetrics.firstDraw||!editMetrics.finalGeometry){let changed=false;scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&!editMetrics.oldGeometries.has(o.geometry))changed=true});let preview=false;scene.traverse(o=>{if(o.userData.wallOpeningPreview&&o.children.length)preview=true});if(changed&&!editMetrics.finalGeometry)editMetrics.finalGeometry=performance.now()-editMetrics.started;if(!editMetrics.firstDraw&&(changed||preview))editMetrics.firstDraw=performance.now()-editMetrics.started}
    }return result};
  })()`)
  const moves=[]
  for(const delta of [.25,.25]){
    const before=await evaluate('houseDesignerFastGI.stats.revision')
    await evaluate(`(()=>{const s=roofWallScene(),f=regressionFloors.find(f=>f.models.some(m=>/window/i.test(m.modelId)&&m.wallAttachment)),m=f.models.find(m=>/window/i.test(m.modelId)&&m.wallAttachment),w=f.walls.find(w=>w.id===m.wallAttachment.wallId),length=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y);editMetrics.modelName='model-transform-'+m.id;const group=s.scene.getObjectByName(editMetrics.modelName);editMetrics.expectedX=group.matrixWorld.elements[12]+${delta}*(w.end.x-w.start.x)/length;editMetrics.expectedZ=group.matrixWorld.elements[14]+${delta}*(w.end.y-w.start.y)/length;editMetrics.oldGeometries=new Set();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')editMetrics.oldGeometries.add(o.geometry)});editMetrics.firstDraw=0;editMetrics.modelDraw=0;editMetrics.finalGeometry=0;editMetrics.started=performance.now();regressionMoveWindow(${delta})})()`)
    await wait(`houseDesignerFastGI.stats.revision>${before}&&${ready}`,300000)
    const result=await evaluate('({visibleMs:editMetrics.firstDraw,modelMs:editMetrics.modelDraw,finalGeometryMs:editMetrics.finalGeometry,totalMs:performance.now()-editMetrics.started,compiles:editMetrics.compiles,coordinators:giCoordinatorStarts,fast:{...houseDesignerFastGI.stats},gi:roofWallScene().scene.userData.indirectLighting,glError:roofWallScene().gl.getContext().getError()})')
    moves.push(result);console.log('WINDOW',JSON.stringify({visibleMs:result.visibleMs,finalGeometryMs:result.finalGeometryMs,totalMs:result.totalMs,compiles:result.compiles,coordinators:result.coordinators,prepareMs:result.gi.prepareMs,timings:result.gi.prepareTimings,fast:result.fast}))
    mkdirSync('tmp/colin-preview',{recursive:true});writeFileSync('tmp/colin-preview/report.json',JSON.stringify({moves,errors},null,2))
    assert.equal(result.glError,0)
    assert.ok(result.visibleMs>0)
    assert.ok(result.visibleMs<200,`geometry feedback exceeded 200 ms: ${result.visibleMs}`)
    assert.ok(result.modelMs>0&&result.modelMs<200,`window frame feedback exceeded 200 ms: ${result.modelMs}`)
    assert.equal(result.coordinators,0,'preview edits must not start the full GI coordinator')
    assert.equal(result.gi.capturedFaces??0,0,'preview edits must not submit probe faces')
  }
  const fps=await evaluate(`new Promise(resolve=>{const start=performance.now(),intervals=[];let previous=start;const frame=now=>{intervals.push(now-previous);previous=now;if(now-start<3000)requestAnimationFrame(frame);else resolve({fps:intervals.length/((now-start)/1000),p95:intervals.sort((a,b)=>a-b)[Math.floor(intervals.length*.95)]})};requestAnimationFrame(frame)})`)
  console.log('PREVIEW FPS',JSON.stringify(fps))
  assert.deepEqual(errors,[])
  console.log('PASS Colin previews update without any full GI preparation')
}finally{ws?.close();browser.kill()}
