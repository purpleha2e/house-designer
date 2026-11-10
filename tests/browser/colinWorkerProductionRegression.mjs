// Profile steady Colin rendering: node tests/browser/steadyViewportPerformance.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
  `--user-data-dir=${createBrowserTestProfile('colin-worker-')}`, 'about:blank',
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
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&saved-colin`})
  const ready=`(()=>{const s=window.roofWallScene?.(),u=s?.scene.userData,g=u?.indirectLighting;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&g?.state==='ready'&&!g.pendingUpdate&&!g.pendingLighting&&!g.saving})()`
  await wait(ready,300000)
  console.log('Colin ready')
  const result=await evaluate(`(async()=>{
    const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');
    const {snapshotIndirectGeometry}=await import('/src/indirectVisibility.ts');
    let props;const visit=f=>{if(!f)return;if(f.type?.name==='IndirectLighting')props=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(getEditorFiber());
    if(!props)throw Error('GI props not found');
    const scene=roofWallScene().scene,geometry=snapshotIndirectGeometry(scene),stages=[];
    const html=await(await fetch('/dist/index.html')).text(),main=html.match(/src="([^"]+\\.js)"/)?.[1];
    const bundle=await(await fetch('/dist'+main)).text(),name=bundle.match(/indirectLighting\\.worker-[A-Za-z0-9_-]+\\.js/)?.[0];
    if(!name)throw Error('Built worker not found');
    const worker=new Worker('/dist/assets/'+name,{type:'module'}),started=performance.now();
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Colin preparation timed out: '+stages)),90000);
      worker.onerror=e=>{clearTimeout(timer);reject(Error((e.message||'Worker failed')+' '+e.filename))};
      worker.onmessage=({data})=>{
        if(data.progress){stages.push(data.progress.stage);return}
        clearTimeout(timer);if(!data.ok){reject(Error(data.error));return}
        resolve({ms:performance.now()-started,probes:data.value.field.probes.length,stages,triangles:geometry.reduce((n,p)=>n+p.ranges.reduce((n,r)=>n+r.count/3,0)*p.matrices.length,0)});
      };
      worker.postMessage({id:1,kind:'prepare',floors:props.floors,lights:props.localLights.map(l=>l.position),geometry,obstacles:[]});
    })}finally{worker.terminate()}
  })()`)
  assert.ok(result.probes>0)
  console.log('PASS production worker prepares Colin geometry',JSON.stringify(result))
}finally{ws?.close();browser.kill()}
