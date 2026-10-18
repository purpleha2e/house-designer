// Vite and asset portal running: node tests/browser/windowFrameGiRegression.mjs [port]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const project = JSON.parse(readFileSync('colin_house_v2.json', 'utf8'))
const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('window-frame-gi-')}`, 'about:blank',
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
    const r = JSON.parse(event.data), request = pending.get(r.id)
    if (request) { pending.delete(r.id); r.error ? request.reject(r.error) : request.resolve(r.result) }
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
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
  async function until(expression, label) {
    const start = Date.now(); let lastLog = 0
    while (Date.now() - start < 300000) {
      if (await evaluate(expression)) return
      if (Date.now() - lastLog > 30000) { console.log(label, await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state')); lastLog = Date.now() }
      if (errors.length) throw Error(JSON.stringify(errors))
      await pause(250)
    }
    throw Error(`Timed out: ${label}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='update'||m.type==='full-reload')event.stopImmediatePropagation()})}}` })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(project.indirectLighting)}}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?colin&materials&upper-selection&saved-gi&strict` })
  await until('!!window.roofWallScene?.()', 'scene mounted')
  await evaluate('window.roofWallScene().setDpr(.75)')
  await until('window.roofWallScene().scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'GI ready')
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(1.25,4.35,12.4);s.camera.lookAt(.469,4.05,10.16);s.controls?.target?.set(.469,4.05,10.16);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(1500)
  const points = await evaluate(`(async()=>{
    const {Vector3}=await import('/node_modules/.vite/deps/three.js'),s=window.roofWallScene();
    const root=s.scene.getObjectByName('model-transform-5f48d33f-c453-4839-993a-4f4205773e7f');
    if(!root)throw Error('Missing shaded bedroom window');s.scene.updateMatrixWorld(true);window.frameGiMeshes=[];
    const rect=s.gl.domElement.getBoundingClientRect(),points=[];
    root.traverse(o=>{if(!o.isMesh)return;
      if(!o.receiveShadow)throw Error(o.name+' does not receive building shadows');
      if(o.castShadow!==(o.material.name!=='Window glass'))throw Error(o.name+' has incorrect shadow casting');
      if(o.material.name!=='Window frame')return;
      if(!o.geometry.getAttribute('hdGIWallMount0')&&!o.geometry.getAttribute('hdGIWallMount1'))throw Error('Missing mounted receiver planes');
      window.frameGiMeshes.push({mesh:o,planes:[0,1].map(i=>o.geometry.getAttribute('hdGIWallMount'+i))});
      const p=o.geometry.getAttribute('position'),n=o.geometry.getAttribute('normal'),centre=new Vector3();let count=0;
      for(let i=0;i<p.count;i++){const normal=new Vector3().fromBufferAttribute(n,i).transformDirection(o.matrixWorld);
        if(normal.z>.9){centre.add(new Vector3().fromBufferAttribute(p,i));count++}}
      if(!count)return;centre.divideScalar(count).applyMatrix4(o.matrixWorld).project(s.camera);
      const x=Math.round(rect.left+(centre.x+1)*rect.width/2),y=Math.round(rect.top+(1-centre.y)*rect.height/2);
      if(x>3&&x<innerWidth-3&&y>50&&y<innerHeight-40)points.push({name:o.name,x,y});
    });return points;
  })()`)
  assert.ok(points.length >= 4, 'visible bedroom frame faces can be sampled')
  // Keep GI and camera unchanged while isolating the two former frame leaks.
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');s.scene.traverse(o=>{if(o.isDirectionalLight)o.userData.frameTestIntensity=o.intensity})})()`)
  const samples = {}
  for (const mode of ['unshadowed', 'fixed', 'no-sun', 'exterior-fallback', 'restored']) {
    await evaluate(`(()=>{
      const s=window.roofWallScene();
      for(const {mesh,planes} of window.frameGiMeshes){
        mesh.receiveShadow=${mode !== 'unshadowed'};
        for(let i=0;i<2;i++){
          if(${mode === 'exterior-fallback'})mesh.geometry.deleteAttribute('hdGIWallMount'+i);
          else mesh.geometry.setAttribute('hdGIWallMount'+i,planes[i]);
        }
      }
      s.scene.traverse(o=>{if(o.isDirectionalLight)o.intensity=${mode === 'no-sun' ? 0 : 'o.userData.frameTestIntensity'}});
      s.gl.setRenderTarget(null);s.gl.clear();s.gl.render(s.scene,s.camera);
    })()`)
    const png = Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(`.tmp-viewer-bedroom-frame-${mode}.png`, png)
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    samples[mode] = points.map(p => { const i=(p.y*info.width+p.x)*info.channels; return (data[i]+data[i+1]+data[i+2])/3 })
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
  console.log(JSON.stringify({ faces: points.length, brightness: Object.fromEntries(Object.entries(samples).map(([mode, values]) => [mode, mean(values)])) }, null, 2))
  assert.ok(mean(samples.fixed) < mean(samples.unshadowed) - 40, 'building shadows block direct sunlight on the indoor frame')
  assert.ok(Math.abs(mean(samples.fixed) - mean(samples['no-sun'])) < 3, 'the shaded inner frame has no direct sun contribution')
  assert.ok(mean(samples.fixed) < mean(samples['exterior-fallback']) - 20, 'the frame follows indoor GI instead of exterior ambient')
  assert.deepEqual(samples.restored, samples.fixed, 'restoring shadow reception and indoor GI restores the original pixels')
  assert.deepEqual(errors, [])
  console.log('PASS: The saved bedroom frame receives building shadows and indoor GI; its paint colour and geometry are unchanged.')
} finally { ws?.close(); child.kill() }
