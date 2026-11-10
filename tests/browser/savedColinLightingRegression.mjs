// Restore the saved Colin house at its authored camera/sun and isolate direct/indirect light.
// node tests/browser/savedColinLightingRegression.mjs [port]
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const port = process.argv[2] ?? '5180'
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1200,850', `--user-data-dir=${createBrowserTestProfile('gi-pipeline-')}`, 'about:blank',
], { windowsHide: true })
let ws
const pending = new Map()
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Chrome exited ${code}`)) })
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '))
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') console.log('Browser warning', message.params.args.map(a => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, process.argv.includes('--banister') ? 120000 : 30000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable'); await call('Runtime.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='update'||m.type==='full-reload')e.stopImmediatePropagation()})}};
    window.liveMetrics={reads:0,workers:[],gaps:[],programs:0};
    let last=performance.now();setInterval(()=>{const now=performance.now();liveMetrics.gaps.push(now-last);last=now},16);
    const WorkerBase=Worker;window.Worker=class extends WorkerBase{postMessage(m,...args){if(String(m.kind).match(/preview|volume|plan/))liveMetrics.workers.push(m.kind);return super.postMessage(m,...args)}};
  `})

  await call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&saved-colin`})
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  let last=0,status
  for(let i=0;i<2400;i++){
    await pause(100);status=await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting')
    const fatal=errors.find(e=>!e.startsWith("THREE.GLTFLoader: Couldn't load texture blob:"));if(fatal)throw Error(fatal)
    if(status?.state==='ready'&&!status.pendingLighting&&!status.pendingUpdate&&!status.volumePending&&!status.preparing&&!status.warming&&!status.reading&&!status.saving&&await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase === "full"'))break
    if(Date.now()-last>15000){console.log('loading',status&&{state:status.state,source:status.source,completed:status.completed,total:status.total,blocked:status.blocked});last=Date.now()}
  }
  assert.equal(status.state,'ready')
  assert.equal(status.source,'saved');assert.equal(status.capturedFaces,0);assert.equal(status.probes,244);assert.equal(status.reflections,13)
  console.log('READY',JSON.stringify(status))
  const screenshot=async(name)=>{await pause(100);const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/saved-colin-'+name+'.png',Buffer.from(data,'base64'))}
  if (process.argv.includes('--banister')) {
    await evaluate(`(()=>{const s=roofWallScene(),render=s.gl.render;s.gl.render=function(scene,camera){if(camera===s.camera&&scene.isScene)window.banisterDisplay=scene;return render.call(this,scene,camera)};s.camera.position.set(4.05,3.85,14.88);s.camera.lookAt(5.8,2.7,15.6);s.camera.updateMatrixWorld();s.invalidate()})()`)
    await pause(1200)
    const inspection = await evaluate(`(()=>{
      const s=roofWallScene();s.setFrameloop('never');
      const materials=new Set(),uniforms=new Set(),lights=[];
      banisterDisplay.traverse(o=>{if(o.isLight)lights.push({o,intensity:o.intensity});for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);const u=s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled)uniforms.add(u)}});
      window.banisterInspection={materials:[...materials].map(m=>({m,env:m.envMapIntensity,normalScale:m.normalScale?.clone()})),uniforms:[...uniforms],lights};
      return [...materials].filter(m=>m.name?.startsWith('stairs_')).map(m=>({name:m.name,type:m.type,color:m.color?.getHexString(),roughness:m.roughness,metalness:m.metalness,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity,toneMapped:m.toneMapped,map:!!m.map,mapColorSpace:m.map?.colorSpace,normalMap:!!m.normalMap,normalScale:m.normalScale?.toArray(),envMap:!!m.envMap,envMapIntensity:m.envMapIntensity,override:m.userData.houseDesignerSurfaceMaterialOverride,gi:!!s.gl.properties.get(m).uniforms?.hdGIEnabled}));
    })()`)
    console.log('BANISTER MATERIALS',JSON.stringify(inspection));writeFileSync('tmp/banister-materials.json',JSON.stringify(inspection,null,2))
    assert.ok(inspection.some(m=>m.name==='stairs_handrails'&&m.gi),'oak handrail must retain the indoor GI shader')
    assert.ok(inspection.some(m=>m.name==='stairs_posts'&&m.gi),'oak posts must retain the indoor GI shader')
    for(const mode of ['all','no-reflections','no-direct','no-gi','no-normal']) {
      await evaluate(`(()=>{const s=roofWallScene(),i=banisterInspection;i.materials.forEach(({m,env,normalScale})=>{m.envMapIntensity='${mode}'==='no-reflections'?0:env;if(normalScale)m.normalScale.copy(normalScale).multiplyScalar('${mode}'==='no-normal'?0:1)});i.lights.forEach(({o,intensity})=>o.intensity='${mode}'==='no-direct'?0:intensity);i.uniforms.forEach(u=>u.hdGIProbeStrength.value='${mode}'==='no-gi'?0:1);s.gl.setRenderTarget(null);s.gl.render(banisterDisplay,s.camera)})()`)
      await screenshot('banister-'+mode)
    }
    assert.deepEqual(errors,[])
    console.log('PASS saved banister material inspection')
  } else if (process.argv.includes('--exposure')) {
    const before = await evaluate('({...roofWallScene().scene.userData.indirectLighting})')
    const workers = await evaluate('liveMetrics.workers.length')
    await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
    await pause(200)
    for (const stops of [0, 1, 2]) {
      await evaluate(`(()=>{const input=document.querySelector('input[aria-label="View exposure"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${stops}');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      for (let i=0;i<100 && await evaluate('roofWallScene().gl.toneMappingExposure') !== 2 ** stops;i++) await pause(20)
      assert.equal(await evaluate('roofWallScene().gl.toneMappingExposure'), 2 ** stops)
      const exposure = 2 ** stops
      await pause(500); await screenshot('exposure-' + exposure)
    }
    const after = await evaluate('({...roofWallScene().scene.userData.indirectLighting})')
    assert.equal(after.generation, before.generation); assert.equal(after.capturedFaces, before.capturedFaces)
    assert.equal(await evaluate('liveMetrics.workers.length'), workers, 'exposure must not schedule GI volume or capture work')
    assert.deepEqual(errors, [])
    console.log('PASS fixed-bake exposure comparison', JSON.stringify({generation:after.generation,capturedFaces:after.capturedFaces,exposures:[1,2,4]}))
  } else if (process.argv.includes('--bedrooms')) {
    const beds = await evaluate(`(()=>{const s=roofWallScene(),all=new Set();s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){const u=s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled)all.add(u)}});window.comparisonUniforms=[...all];return regressionFloors.flatMap(f=>f.models.filter(m=>m.modelId==='king-bed').map(m=>({...m,elevation:f.elevation})))})()`)
    for (const [i, bed] of beds.entries()) {
      const x=bed.position.x, z=bed.position.y, dx=Math.sin(bed.rotation), dz=Math.cos(bed.rotation)
      const distance = i >= 2 ? 2.8 : 3.5
      await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(${x+dx*distance+dz*.55},${bed.elevation+1.25},${z+dz*distance-dx*.55});s.camera.lookAt(${x+dx*.7},${bed.elevation+.55},${z+dz*.7});s.camera.updateMatrixWorld();comparisonUniforms.forEach(u=>u.hdGIProbeStrength.value=1);s.invalidate()})()`)
      await pause(700); await screenshot('bed-' + i)
      await evaluate('comparisonUniforms.forEach(u=>u.hdGIProbeStrength.value=0);roofWallScene().invalidate()')
      await pause(300); await screenshot('bed-' + i + '-no-gi')
    }
    assert.equal(await evaluate('roofWallScene().scene.userData.indirectLighting.capturedFaces'), 0)
    const diagnosis = await evaluate(`(async()=>{
      const {Box3,Vector3}=await import('/tests/browser/rendererTestModules.ts');
      const {loadIndirectLighting}=await import('/src/indirectLightingPersistence.ts');
      const {snapshotIndirectGeometry,createIndirectVisibilityFromSnapshot}=await import('/src/indirectVisibility.ts');
      const {inspectIndirectPoint}=await import('/src/indirectLightingDiagnostic.ts');
      const s=roofWallScene(), restored=await loadIndirectLighting(s.scene.userData.getBakedIndirectLighting(),{reflections:false});
      const visibility=createIndirectVisibilityFromSnapshot(snapshotIndirectGeometry(s.scene));
      try{return regressionFloors.flatMap(f=>f.models.filter(m=>m.modelId==='king-bed').map(m=>{
        const dx=Math.sin(m.rotation),dz=Math.cos(m.rotation),rx=dz,rz=-dx;
        const target=regressionPickTargets().find(t=>t.modelId===m.id);
        const box=target?new Box3().setFromObject(target.object):null;
        const points=[{name:'wall-base-left',p:[m.position.x+dx*.01+rx*1.18,f.elevation+.1,m.position.y+dz*.01+rz*1.18],n:[dx,0,dz]},
          {name:'wall-base-right',p:[m.position.x+dx*.01-rx*1.18,f.elevation+.1,m.position.y+dz*.01-rz*1.18],n:[dx,0,dz]},
          {name:'carpet-beside-bed',p:[m.position.x+dx*.8+rx*1.18,f.elevation+.012,m.position.y+dz*.8+rz*1.18],n:[0,1,0]}];
        return {id:m.id,position:m.position,bounds:box&&{min:box.min.toArray(),max:box.max.toArray()},points:points.map(point=>{
          try{return {...point,report:inspectIndirectPoint(restored.field,visibility,new Vector3().fromArray(point.p),new Vector3().fromArray(point.n),[],restored.directCoefficients)}}
          catch(error){return {...point,error:String(error)}}
        })};
      }))}finally{restored.field.dispose();visibility.dispose()}
    })()`)
    writeFileSync('tmp/bedroom-gi-diagnosis.json',JSON.stringify(diagnosis,null,2))
    console.log('DIAGNOSIS',JSON.stringify(diagnosis.map(b=>({...b,points:b.points.map(p=>({name:p.name,error:p.error,displayed:p.report?.displayed,exact:p.report?.exactAtSurface,shifted:p.report?.exactAtShiftedSample,bounces:p.report?.bounces}))}))))
    console.log('PASS saved bedroom GI isolation', JSON.stringify(beds.map((bed,i)=>({i,id:bed.id,position:bed.position}))))
    assert.deepEqual(errors, [])
  } else {
  await screenshot('displayed')
  const control=await evaluate(`(async()=>{
    const s=roofWallScene(),all=new Set();s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){const u=s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled)all.add(u)}});
    window.comparisonUniforms=[...all];return {uniforms:all.size,sun:regressionSunPosition,camera:s.camera.position.toArray(),values:[...all].map(u=>({probe:u.hdGIProbeStrength.value,fast:u.hdFastReady?.value,weight:u.hdFastWeight?.value,volume:u.hdGIVolumeSize.value.toArray()}))}
  })()`); console.log('CONTROL',JSON.stringify({...control,values:control.values.slice(0,1)}));assert.ok(control.uniforms>0)
  await evaluate('comparisonUniforms.forEach(u=>u.hdGIProbeStrength.value=0);roofWallScene().invalidate()');await screenshot('no-probes')
  await evaluate('comparisonUniforms.forEach(u=>u.hdGIProbeStrength.value=1);roofWallScene().invalidate()')
  await evaluate(`(()=>{const s=roofWallScene(),sun=[];s.scene.traverse(o=>{if(o.isDirectionalLight&&o.userData.houseDesignerRole==='sun-light'){sun.push([o,o.intensity]);o.intensity=0}});window.comparisonSun=sun;s.invalidate()})()`)
  await screenshot('no-direct-sun')
  await evaluate('comparisonSun.forEach(([o,i])=>o.intensity=i);roofWallScene().invalidate()')
  await evaluate('comparisonUniforms.forEach(u=>u.hdGIProbeStrength.value=0);comparisonSun.forEach(([o])=>o.intensity=0);roofWallScene().invalidate()');await screenshot('no-probes-no-sun')
  assert.deepEqual(errors,[])
  console.log('PASS saved scene comparisons captured')
  }
} finally {
  ws?.close();child.kill()
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Browser closed'))}
}
