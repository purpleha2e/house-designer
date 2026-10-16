// With Vite running: node tests/browser/lightShadowToggleRegression.mjs [port] [fixture query]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  `--user-data-dir=${createBrowserTestProfile('room-light-shadows-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description))
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
  const until = async (expression, label) => {
    for (let i = 0; i < 1800; i++) { if (await evaluate(expression)) return; if(errors.length)throw Error(JSON.stringify(errors)); if(i%100===0)console.log(await evaluate('({shader:window.roofWallScene?.()?.scene.userData.shaderWarmupPending,gi:window.roofWallScene?.()?.scene.userData.indirectLighting})')); await pause(100) }
    throw Error(`Timed out: ${label}: ${JSON.stringify(errors)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  if((process.argv[3]??'').includes('saved-gi')) {
    const project=JSON.parse(readFileSync(new URL('../../colin_house_v2.json',import.meta.url),'utf8'));
    await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.regressionSavedGI='+JSON.stringify({project})});
  }
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/roofWallRegression.html?${process.argv[3] ?? 'lighting-startup&live-gi'}` })
  console.log('Waiting for initial scene...')
  await until('window.roofWallScene?.()?.scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'initial scene')
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await evaluate(`(()=>{
    const s=window.roofWallScene();window.shadowToggleState={events:[],draws:0};
    const lights=[];s.scene.traverse(o=>{if((o.isPointLight||o.isSpotLight)&&o.castShadow)lights.push(o)});
    if(!lights.length)throw Error('No pooled shadow lights');
    const render=s.gl.renderBufferDirect.bind(s.gl);
    s.gl.renderBufferDirect=(camera,...args)=>{if(lights.some(l=>l.shadow.camera===camera))shadowToggleState.draws++;return render(camera,...args)};
    for(const l of lights){let value=l.shadow.intensity;Object.defineProperty(l.shadow,'intensity',{configurable:true,get:()=>value,set:v=>{if(v!==value)shadowToggleState.events.push({at:performance.now(),value:v});value=v}})}
    window.toggleLocalShadows=async enabled=>{
      const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');
      const retainedMaps=lights.map(l=>l.shadow.map);
      const before={programs:s.gl.info.programs.map(p=>p.id),generation:s.scene.userData.indirectLighting.generation,maps:lights.map(l=>l.shadow.map?.texture.uuid)};
      const start=performance.now();shadowToggleState.events=[];
      if(input.checked!==enabled)input.click();
      const handlerMs=performance.now()-start;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const appliedMs=Math.max(0,...shadowToggleState.events.map(e=>e.at-start));
      shadowToggleState.draws=0;
      await new Promise(resolve=>setTimeout(resolve,1200));
      return {enabled,handlerMs,appliedMs,before,after:{programs:s.gl.info.programs.map(p=>p.id),generation:s.scene.userData.indirectLighting.generation,maps:lights.map(l=>l.shadow.map?.texture.uuid)},
        mapsRetained:lights.every((l,i)=>!!l.shadow.map&&l.shadow.map===retainedMaps[i]),pending:s.scene.userData.shaderWarmupPending,draws:shadowToggleState.draws,lights:lights.map(l=>({cast:l.castShadow,intensity:l.shadow.intensity,updates:l.shadow.autoUpdate,needs:l.shadow.needsUpdate}))};
    };
  })()`)
  for(const enabled of [true,false,true,false]){
    const r=await evaluate(`toggleLocalShadows(${enabled})`);console.log(JSON.stringify(r));
    assert.ok(r.mapsRetained,'toggle must keep the actual GPU targets alive');
    assert.ok(r.appliedMs <= 5, `shadow switch took ${r.appliedMs}ms`);
    assert.equal(r.pending,false,'toggle must not start shader preparation');
    assert.deepEqual(r.after.programs,r.before.programs,'toggle must reuse shader programs');
    assert.equal(r.after.generation,r.before.generation,'toggle must retain lighting bake');
    assert.deepEqual(r.after.maps,r.before.maps,'toggle must retain shadow targets');
    if(!enabled){assert.equal(r.draws,0,'disabled lights must submit no shadow draws');assert.ok(r.lights.every(l=>l.cast&&l.intensity===0&&!l.updates&&!l.needs));}
  }
  assert.equal(await evaluate('window.roofWallScene().gl.getContext().getError()'),0,'toggles must leave no WebGL errors')
  assert.deepEqual(errors,[])
  console.log('PASS immediate light-shadow toggles')
} finally { ws?.close(); child.kill() }
