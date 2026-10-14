// With Vite running: node tests/browser/roomLightShadowsRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './tests/browser/browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
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
    for (let i = 0; i < 600; i++) { if (await evaluate(expression)) return; await pause(100) }
    throw Error(`Timed out: ${label}: ${JSON.stringify(errors)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&upper-selection'})
  await until(`(()=>{let count=0;window.roofWallScene?.()?.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)count++});return count>=2&&!document.body.innerText.includes('Preparing 3D scene')})()`,'house geometry')
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  const set = async (name,value) => {await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(name)})?.querySelector('input');if(!input)throw Error('Missing '+${JSON.stringify(name)});if(input.checked!==${value})input.click()})()`);await pause(250)}
  await set('Light shadows',true);await set('Daylight',false)
  await pause(1500)
  const setup = await evaluate(`(async()=>{
    const {Vector3,OrthographicCamera,WebGLRenderTarget,AmbientLight}=await import('/node_modules/.vite/deps/three.js');
    const {createIndirectVisibility}=await import('/src/indirectVisibility.ts');
    const s=window.roofWallScene();s.setFrameloop('never');
    // Display-only diagnostic: retain authored PBR maps and shadow casting,
    // omitting GI capture samplers that exceed SwiftShader's 16-sampler limit.
    const materialClones=new Map();s.scene.traverse(o=>{if(!o.isMesh)return;const copy=m=>{if(!m.isMeshStandardMaterial)return m;let clone=materialClones.get(m);if(!clone){clone=m.clone();clone.onBeforeCompile=()=>{};clone.customProgramCacheKey=()=> 'two-lamp-shadow-diagnostic';materialClones.set(m,clone)}return clone};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material)});
    const diagnosticFill=new AmbientLight('white',.45);s.scene.add(diagnosticFill);
    s.camera.position.set(6.9,3.8,12.1);s.camera.lookAt(4.1,3.2,10.5);s.camera.updateMatrixWorld();
    const lights=[];s.scene.traverse(o=>{if(o.isPointLight&&o.power>0)lights.push(o)});
    const casters=[];s.scene.traverse(o=>{if(o.isMesh&&o.castShadow)casters.push(o)});
    const camera=new OrthographicCamera(-1.65,1.65,1.5,-1.5,.01,10);camera.position.set(6.1,4.95,11.1);camera.lookAt(6.1,2.7,11.1);camera.updateMatrixWorld();
    const target=new WebGLRenderTarget(400,400),visibility=createIndirectVisibility(s.scene);
    window.shadowDiagnostic={s,lights,casters,camera,target,visibility,diagnosticFill};
    return {lights:lights.map(o=>({p:o.position.toArray(),power:o.power,bias:o.shadow.bias,normalBias:o.shadow.normalBias,radius:o.shadow.radius})),meshes:casters.length}
  })()`);console.log('SETUP',JSON.stringify(setup))
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  for(const [name,bias,normalBias,radius] of [['original',-.0008,.1,2],['small',-.00001,.004,1]]){
    const result=await evaluate(`(()=>{const {s,lights,casters,camera,target,visibility}=window.shadowDiagnostic;const {scene,gl}=s;
      scene.traverse(o=>{if(o.isLight){if(!o.isPointLight)o.intensity=0;else{o.userData.originalPower??=o.power;o.power=o.position.z<7?0:o.userData.originalPower;o.shadow.bias=${bias};o.shadow.normalBias=${normalBias};o.shadow.radius=${radius};o.shadow.needsUpdate=true}}
        if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=gl.properties.get(m).uniforms;if(u?.hdGIIndoorFill)u.hdGIIndoorFill.value=0;if(u?.hdGIProbeStrength)u.hdGIProbeStrength.value=0;m.envMapIntensity=0}});
      const perLight=[];
      for(let index=0;index<lights.length;index++){
        const light=lights[index];if(light.position.z<7)continue;lights.forEach((o,i)=>o.power=i===index?o.userData.originalPower:0);
        const render=()=>{light.shadow.needsUpdate=true;gl.setRenderTarget(target);gl.render(scene,camera);const data=new Uint8Array(400*400*4);gl.readRenderTargetPixels(target,0,0,400,400,data);gl.setRenderTarget(null);return data};
        const actual=render();casters.forEach(o=>o.castShadow=false);const reference=render();casters.forEach(o=>o.castShadow=true);
        let lit=0,dark=0,falseLit=0,falseDark=0;const wrong=[];
        for(let z=9.72;z<12.52;z+=.08)for(let x=4.5;x<7.7;x+=.08){
          const p=camera.position.clone().set(x,2.712,z),screen=p.clone().project(camera),px=Math.floor((screen.x+1)*200),py=Math.floor((screen.y+1)*200);
          const offset=(py*400+px)*4,den=reference[offset]+reference[offset+1]+reference[offset+2];if(den<20)continue;
          const ratio=(actual[offset]+actual[offset+1]+actual[offset+2])/den;
          const origin=p.clone().setY(2.716),dir=light.position.clone().sub(origin),distance=dir.length(),max=distance-.002;
          const blocked=visibility.distance(origin,dir.multiplyScalar(1/distance),max)<max;
          if(blocked){dark++;if(ratio>.7){falseLit++;if(wrong.length<12)wrong.push({x,z,ratio,blocked})}}else{lit++;if(ratio<.3){falseDark++;if(wrong.length<12)wrong.push({x,z,ratio,blocked})}}
        }
        perLight.push({index,lit,dark,falseLit,falseDark,wrong});
      }
      lights.forEach(o=>o.power=o.position.z<7?0:o.userData.originalPower);window.shadowDiagnostic.diagnosticFill.intensity=.45;gl.render(scene,s.camera);return perLight;
    })()`);console.log(name,JSON.stringify(result));
    writeFileSync('.tmp-bedroom-shadows-'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  console.log('ERRORS',JSON.stringify(errors))
}finally{ws?.close();child.kill()}
