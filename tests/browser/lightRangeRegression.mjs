// Run with Vite: node tests/browser/lightRangeRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run',
  '--window-size=950,1000', `--user-data-dir=${createBrowserTestProfile('light-range-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    browser.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if(match) resolve(match[1]) })
    browser.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if(request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if(message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if(message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const until = async (expression, label) => {
    for(let i = 0; i < 1800; i++) {
      if(errors.length) throw Error(JSON.stringify(errors))
      if(await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw Error(`Timed out: ${label}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/roofWallRegression.html?lighting-startup&light-ranges` })
  await until('window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === "full"', 'initial display')
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(!input.checked)input.click();document.querySelector('[aria-label="3D view menu"]').click()})()`)
  await evaluate(`(async()=>{
    const {OrthographicCamera,WebGLRenderTarget,Vector3}=await import('/node_modules/.vite/deps/three.js');
    const s=window.roofWallScene(),target=new WebGLRenderTarget(256,256);
    window.sampleRange=(kind)=>{
      const light=s.scene.children.find(o=>kind==='point'?o.isPointLight:o.isSpotLight),camera=new OrthographicCamera(-.7,.7,1.15,-1.15,.01,5);
      if(kind==='point'){camera.position.set(1,1.2,2);camera.lookAt(.1,1.2,2)}
      else{camera.position.set(6,2.3,2);camera.lookAt(6,0,2)}
      camera.updateMatrixWorld(true);s.scene.updateMatrixWorld(true);
      const samples=kind==='point'?[.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2].map(y=>[.1,y,2]):[5.7,5.85,6,6.15,6.3].map(x=>[x,.06,2]);
      const savedLights=[];s.scene.traverse(o=>{if(o.isLight&&o!==light){savedLights.push([o,o.intensity]);o.intensity=0}});
      const enabled=light.shadow.intensity,draw=()=>{
        s.gl.setRenderTarget(target);s.gl.render(s.scene,camera);
        return samples.map(position=>{const p=new Vector3(...position).project(camera),pixel=new Uint8Array(4);s.gl.readRenderTargetPixels(target,Math.floor((p.x+1)*128),Math.floor((p.y+1)*128),1,1,pixel);return [...pixel.slice(0,3)]})
      };
      try{
        light.shadow.intensity=1;light.shadow.needsUpdate=true;
        const shadowed=draw(),c=light.shadow.camera,projection=c.projectionMatrix.elements[10],expected=-(c.far+c.near)/(c.far-c.near);
        light.shadow.intensity=0;const unshadowed=draw();
        return{distance:light.distance,far:c.far,projection,expected,shadowed,unshadowed};
      }finally{light.shadow.intensity=enabled;savedLights.forEach(([o,intensity])=>o.intensity=intensity);s.gl.setRenderTarget(null);s.invalidate()}
    };
    window.disposeRangeProbe=()=>target.dispose();
  })()`)
  const sum = values => values.reduce((a,b)=>a+b,0)
  for(const distance of [24.5,20.5,7,28,9.5]) {
    await evaluate(`window.updateRegressionFloors(fs=>fs.map(f=>({...f,models:f.models.map(m=>['startup-light','range-spot'].includes(m.id)?{...m,lightDistance:${distance}}:m)})))`)
    await until(`window.roofWallScene().scene.children.filter(o=>(o.isPointLight||o.isSpotLight)&&o.power>0).every(o=>o.distance===${distance})`, 'range update')
    for(const kind of ['point','spot']) {
      const result=await evaluate(`window.sampleRange(${JSON.stringify(kind)})`)
      assert.equal(result.far,distance,`${kind}: shadow cutoff follows range`)
      assert.ok(Math.abs(result.projection-result.expected)<1e-12,`${kind}: shadow projection follows range ${distance}`)
      const ratios=result.shadowed.map((rgb,i)=>sum(rgb)/Math.max(1,sum(result.unshadowed[i])))
      assert.ok(ratios.every(r=>r>.97),`${kind}: unobstructed receivers must stay lit after changing range to ${distance}: ${JSON.stringify(result)}`)
      console.log(`PASS ${kind} range ${distance}m: projection consistent; minimum lit ratio ${Math.min(...ratios).toFixed(3)}`)
    }
  }
  await evaluate('window.disposeRangeProbe()')
  assert.deepEqual(errors, [])
} finally { ws?.close(); browser.kill() }
