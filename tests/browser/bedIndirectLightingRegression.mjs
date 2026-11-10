// With Vite running: node tests/browser/doorPlanRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('door-plan-')}`, 'about:blank',
], { windowsHide: true })
let ws
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
    if (request) {
      pending.delete(result.id)
      result.error ? request.reject(result.error) : request.resolve(result.result)
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
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
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5186}/tests/browser/roofWallRegression.html?lighting-startup&bed-gi`})
  for(let i=0;i<1800;i++){
    if(await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state === "ready" && !roofWallScene().scene.userData.shaderWarmupPending'))break
    assert.deepEqual(errors,[]);await pause(100)
  }
  assert.equal(await evaluate('roofWallScene().scene.userData.indirectLighting?.state'),'ready')
  const result=await evaluate(`(async()=>{
    const {WebGLRenderTarget,Color}=await import('/tests/browser/rendererTestModules.ts');
    const {getIndirectLightingUniforms}=await import('/src/indirectLightingShader.ts');
    const s=roofWallScene(),bed=regressionPickTargets().find(t=>t.modelId==='gi-bed').object;
    const meshes=[];bed.traverse(o=>{if(o.isMesh&&!o.userData.selectionDecoration)meshes.push(o)});
    const material=meshes[0].material,uniforms=getIndirectLightingUniforms(material);
    if(!uniforms||uniforms.hdGIEnabled.value!==1)throw Error('The bed must receive the live GI shader');
    const lights=[],visibility=[],background=s.scene.background,environment=s.scene.environment,target=s.gl.getRenderTarget();
    const strength=uniforms.hdGIProbeStrength.value,metalness=material.metalness;
    const frame=new WebGLRenderTarget(256,256),pixels=new Uint8Array(256*256*4);
    s.camera.position.set(6,2.3,4);s.camera.lookAt(4,.6,2);s.camera.updateMatrixWorld();
    s.scene.traverse(o=>{
      if(o.isLight){lights.push([o,o.intensity]);o.intensity=0}
      if(o.isMesh){let belongs=false;for(let p=o;p;p=p.parent){if(p===bed)belongs=true;if(p.userData.selectionDecoration){belongs=false;break}}
        visibility.push([o,o.visible]);if(!belongs)o.visible=false}
    });
    s.scene.background=new Color('black');s.scene.environment=null;
    const sample=async strength=>{
      uniforms.hdGIProbeStrength.value=strength;
      s.gl.setRenderTarget(frame);s.gl.render(s.scene,s.camera);
      await s.gl.readRenderTargetPixelsAsync(frame,0,0,256,256,pixels);
      let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];
      return sum/(256*256*3);
    };
    try{
      const off=await sample(0),on=await sample(1);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      const ctx=canvas.getContext('2d'),image=ctx.createImageData(256,256);
      for(let y=0;y<256;y++)image.data.set(pixels.subarray(y*256*4,(y+1)*256*4),(255-y)*256*4);
      ctx.putImageData(image,0,0);const png=canvas.toDataURL();
      material.metalness=1;const metallic=await sample(1);
      return{off,on,metallic,material:material.name,metalness,png};
    }finally{
      material.metalness=metalness;uniforms.hdGIProbeStrength.value=strength;
      for(const [o,value]of lights)o.intensity=value;for(const [o,value]of visibility)o.visible=value;
      s.scene.background=background;s.scene.environment=environment;s.gl.setRenderTarget(target);frame.dispose();s.invalidate();
    }
  })()`)
  assert.equal(result.metalness,0)
  assert.ok(result.on>result.off+1,'baked indirect light visibly illuminates the bed with all direct lights disabled')
  assert.ok(result.on>result.metallic*2,'the erroneous metallic default suppressed the bed diffuse response')
  writeFileSync('node_modules/.cache/bed-indirect-only.png',Buffer.from(result.png.split(',')[1],'base64'))
  delete result.png
  console.log('PASS: actual bed responds to baked indirect light without direct lighting',result)
  assert.deepEqual(errors,[])
}finally{ws?.close();child.kill()}
