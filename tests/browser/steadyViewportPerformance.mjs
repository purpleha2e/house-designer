// Profile steady Colin rendering: node tests/browser/steadyViewportPerformance.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
  `--user-data-dir=${createBrowserTestProfile('steady-colin-')}`, 'about:blank',
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
  const hardware=await evaluate(`(async()=>{
    window.S=roofWallScene();window.roomModule=await import('/src/roomLightShader.ts');window.indirectModule=await import('/src/indirectLightingShader.ts');
    const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');
    const visit=f=>{if(!f)return;const value=f.ref?.current;if(value?.passes)window.profileComposer=value;visit(f.child);visit(f.sibling)};visit(getEditorFiber());
    if(!window.profileComposer)throw Error('No composer found');
    window.profileAO=profileComposer.passes.find(p=>p.configuration&&'aoRadius' in p.configuration);
    if(!profileAO)throw Error('No AO pass found: '+profileComposer.passes.map(p=>p.constructor.name));
    const c=S.gl.getContext(),debug=c.getExtension('WEBGL_debug_renderer_info');
    window.profileMetrics={enabled:false,skip:false,cpu:[],gpu:[],draws:[],pending:[],nested:false};
    window.roomUniforms=[];const seen=new Set();S.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){const u=roomModule.getRoomLightUniforms(m);if(u&&!seen.has(u)){seen.add(u);roomUniforms.push([u,u.enabled.value])}}});
    const timer=c.getExtension('EXT_disjoint_timer_query_webgl2'),render=S.gl.render.bind(S.gl);
    S.gl.render=(scene,camera)=>{
      const p=profileMetrics;if(p.skip)return;if(!p.enabled||p.nested)return render(scene,camera);
      const q=timer?c.createQuery():null,at=performance.now(),calls=S.gl.info.render.calls,triangles=S.gl.info.render.triangles;
      p.nested=true;if(q)c.beginQuery(timer.TIME_ELAPSED_EXT,q);
      try{return render(scene,camera)}finally{
        if(q){c.endQuery(timer.TIME_ELAPSED_EXT);p.pending.push(q)}p.nested=false;
        p.cpu.push(performance.now()-at);p.draws.push({calls:S.gl.info.render.calls-calls,triangles:S.gl.info.render.triangles-triangles});
      }
    };
    window.sampleViewport=duration=>new Promise(resolve=>{
      const p=profileMetrics,c=S.gl.getContext(),timer=c.getExtension('EXT_disjoint_timer_query_webgl2'),frames=[];
      p.cpu=[];p.gpu=[];p.draws=[];let started=performance.now(),last=started;
      function tick(now){
        frames.push(now-last);last=now;
        for(let i=p.pending.length-1;i>=0;i--){const q=p.pending[i];if(!c.getQueryParameter(q,c.QUERY_RESULT_AVAILABLE))continue;if(!c.getParameter(timer.GPU_DISJOINT_EXT))p.gpu.push(c.getQueryParameter(q,c.QUERY_RESULT)/1e6);c.deleteQuery(q);p.pending.splice(i,1)}
        if(now-started<duration)requestAnimationFrame(tick);else{
          p.enabled=false;const sort=a=>[...a].sort((a,b)=>a-b),f=sort(frames),sum=a=>a.reduce((s,x)=>s+x,0),seconds=(now-started)/1000;
          resolve({fps:frames.length/seconds,frameMedian:f[Math.floor(f.length*.5)],frameP95:f[Math.floor(f.length*.95)],cpuRenderMsPerSecond:sum(p.cpu)/seconds,gpuMsPerSecond:sum(p.gpu)/seconds,callsPerSecond:sum(p.draws.map(d=>d.calls))/seconds,trianglesPerSecond:sum(p.draws.map(d=>d.triangles))/seconds,renderCalls:p.cpu.length,frames:frames.length,glError:c.getError(),gi:S.scene.userData.indirectLighting.state});
        }
      }p.enabled=true;requestAnimationFrame(tick);
    });
    return {renderer:debug?c.getParameter(debug.UNMASKED_RENDERER_WEBGL):c.getParameter(c.RENDERER),cores:navigator.hardwareConcurrency,width:S.gl.domElement.width,height:S.gl.domElement.height,dpr:S.gl.getPixelRatio(),gi:S.scene.userData.indirectLighting,roomUniforms:roomUniforms.length};
  })()`)
  console.log('HARDWARE',JSON.stringify({...hardware,gi:{state:hardware.gi.state,source:hardware.gi.source,probes:hardware.gi.probes}}))
  mkdirSync('tmp/steady-colin',{recursive:true})
  const results={hardware,samples:{},errors}
  const sample=async name=>{await pause(500);results.samples[name]=await evaluate('sampleViewport(4000)');writeFileSync('tmp/steady-colin/report.json',JSON.stringify(results,null,2));console.log(name,JSON.stringify(results.samples[name]))}
  await sample('baseline')
  // Bypass only the AO pass, retaining identical material programs, resolution
  // and output target. A UI toggle also changes the renderer's shader variants.
  await evaluate('profileAO.enabled=false;S.invalidate()')
  await sample('withoutAO')
  await evaluate('roomUniforms.forEach(([u])=>u.enabled.value=0);S.invalidate()')
  await sample('withoutAOorRoomChecks')
  await evaluate('profileMetrics.skip=true')
  await sample('withoutDraws')
  await evaluate('profileMetrics.skip=false;roomUniforms.forEach(([u,value])=>u.enabled.value=value);S.invalidate()')
  await evaluate('profileAO.enabled=true;S.invalidate()')
  await sample('restoredBaseline')
  assert.deepEqual(errors,[])
  console.log('REPORT tmp/steady-colin/report.json')
} finally {ws?.close();browser.kill()}
