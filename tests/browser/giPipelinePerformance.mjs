// With Vite running: node tests/browser/giPipelinePerformance.mjs [port] [project] [seconds]
// Read-only profiling of the existing GI pipeline; uses an isolated headless profile.
// Worker times include queuing/copying; readbacks include GPU completion and timer polling.
// captureMs is CPU submission time, not GPU time. Profiles with asset errors are incomplete.
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const port = process.argv[2] ?? '5180', project = process.argv[3] ?? 'lighting-startup'
const seconds = Number(process.argv[4] ?? 180)
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
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 30000)
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.giProfile={workers:[],reads:[],polls:[]};
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker {
      constructor(url,...args){super(url,...args);this.gi=String(url).includes('indirectLighting.worker');this.requests=new Map();
        if(this.gi)this.addEventListener('message',event=>{const r=this.requests.get(event.data.id);if(r){if(event.data.progress){r.progress=event.data.progress;return}if(event.data.lampQuery){r.lampRows=event.data.lampQuery.size*event.data.lampQuery.lights.length;return}r.ms=performance.now()-r.at;r.ok=event.data.ok;r.finished=true;r.prepareTimings=event.data.value?.prepareTimings;this.requests.delete(event.data.id)}})}
      postMessage(message,...args){if(this.gi&&message.kind!=='lampResult'){const r={kind:message.kind,at:performance.now(),finished:false};if(message.kind==='prepare'){r.parallelLamps=message.parallelLamps;r.lightCount=message.lights.length;r.triangles=message.geometry.reduce((s,p)=>s+p.matrices.length*p.ranges.reduce((t,r)=>t+Math.floor(r.count/3),0),0)}this.requests.set(message.id,r);window.giProfile.workers.push(r)}return super.postMessage(message,...args)}
    };
  ` })
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?${encodeURIComponent(project)}` })
  const start = Date.now()
  let attached = false, status, ready = false, lastLog = 0, initial
  while (Date.now() - start < seconds * 1000) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (!attached) attached = await evaluate(`(()=>{const state=window.roofWallScene?.();if(!state)return false;
      const gl=state.gl, original=gl.readRenderTargetPixelsAsync.bind(gl);window.giProfile.hardware={};
      const context=gl.getContext(),ext=context.getExtension('WEBGL_debug_renderer_info');
      if(ext)window.giProfile.hardware.renderer=context.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      const multiview=context.getExtension('OVR_multiview2');
      window.giProfile.hardware.multiviewViews=multiview?context.getParameter(multiview.MAX_VIEWS_OVR):0;
      window.giProfile.hardware.cores=navigator.hardwareConcurrency;
      gl.readRenderTargetPixelsAsync=async function(...args){const r={at:performance.now(),width:args[3],height:args[4]};window.giProfile.reads.push(r);
        try{return await original(...args)}finally{r.ms=performance.now()-r.at}};return true})()`)
    if (!attached) continue
    await evaluate(`window.roofWallScene().scene.userData.indirectSurfaceCacheEnabled=${(process.argv.includes('--surface-cache') || process.argv.includes('--compare-surfaces')) && !process.argv.includes('--no-surface-cache') && !process.argv.includes('--compare-captures')}`)
    await evaluate(`window.roofWallScene().scene.userData.indirectLegacyCaptureBudget=${process.argv.includes('--legacy-budget')}`)
    await evaluate(`window.roofWallScene().scene.userData.indirectMultiviewEnabled=${process.argv.includes('--multiview') || process.argv.includes('--multiview-2') || process.argv.includes('--compare-multiview')};window.roofWallScene().scene.userData.indirectMultiviewViews=${process.argv.includes('--multiview-2') ? 2 : 3}`)
    const fatal = errors.find(error => !error.startsWith("THREE.GLTFLoader: Couldn't load texture blob:"))
    if (fatal) throw Error(fatal)
    if (process.argv.includes('--compare-multiview')) await evaluate(`(async()=>{
      const state=window.roofWallScene(),source=state.scene,gl=state.gl,batch=source.userData.getIndirectMultiview?.();
      if(!batch||batch.comparisonInstalled)return;
      batch.comparisonInstalled=true;
      const {CubeCamera,WebGLCubeRenderTarget,HalfFloatType,RGBAFormat,LinearSRGBColorSpace,PointLight,SpotLight}=await import('/node_modules/.vite/deps/three.js');
      const {createIndirectProbeIntegrator}=await import('/src/indirectProbeIntegration.ts');
      const size=batch.target.width,cube=new WebGLCubeRenderTarget(size,{type:HalfFloatType,format:RGBAFormat,generateMipmaps:false,colorSpace:LinearSRGBColorSpace});
      const camera=new CubeCamera(.03,80,cube);camera.coordinateSystem=gl.coordinateSystem;camera.updateCoordinateSystem();
      const integrator=createIndirectProbeIntegrator(size),render=batch.render.bind(batch);
      window.giProfile.multiviewComparisons??=[];window.giProfile.multiviewPending??=0;
      let probe=0;
      batch.render=function(cameras,first,sky){
        render(cameras,first,sky);
        const selected=probe<2||probe%24===0;
        if(!selected){if(first+batch.views===6)probe++;return;}
        const capture=source.userData.getIndirectCaptureScene().scene;
        const target=gl.getRenderTarget(),face=gl.getActiveCubeFace(),mip=gl.getActiveMipmapLevel(),stats={...gl.info.render},background=capture.background;
        const active=batch.scene.children.filter(o=>o instanceof PointLight||o instanceof SpotLight);
        try{
          for(const light of active){capture.add(light);if(light instanceof SpotLight)capture.add(light.target);}
          capture.background=sky;camera.position.copy(cameras.position);camera.updateMatrixWorld(true);
          for(let view=first;view<first+batch.views;view++){const cubeFace=batch.faceOrder[view];gl.setRenderTarget(cube,cubeFace);gl.clear();gl.render(capture,camera.children[cubeFace]);}
          if(first+batch.views===6){
            const index=probe++,pass=source.userData.indirectLighting.pass;
            window.giProfile.multiviewPending++;
            // Three's async read restores the current framebuffer; a cube's
            // framebuffer is an array, so unbind it before queuing these copies.
            gl.setRenderTarget(null);
            Promise.all([batch.read(),integrator.read(gl,cube)]).then(([a,b])=>{
              let max=0,total=0,peak=0;
              for(let i=0;i<4;i++)for(const axis of ['x','y','z']){const delta=Math.abs(a.coefficients[i][axis]-b.coefficients[i][axis]);max=Math.max(max,delta);total+=delta;peak=Math.max(peak,Math.abs(b.coefficients[i][axis]));}
              window.giProfile.multiviewComparisons.push({probe:index,pass,max,mean:total/12,peak,...(max>.002?{actual:a.coefficients.slice(0,4).map(c=>c.toArray()),reference:b.coefficients.slice(0,4).map(c=>c.toArray())}:{})});
            }).catch(error=>console.error('Multiview comparison failed:',error)).finally(()=>window.giProfile.multiviewPending--);
          }
        }finally{
          for(const light of active){batch.scene.add(light);if(light instanceof SpotLight)batch.scene.add(light.target);}
          capture.background=background;gl.setRenderTarget(target,face,mip);Object.assign(gl.info.render,stats);
        }
      };
    })()`)
    if (process.argv.includes('--compare-surfaces')) await evaluate(`(async()=>{
      const state=window.roofWallScene(),source=state.scene,gl=state.gl,cache=source.userData.getIndirectSurfaceCache?.();
      if(!cache||cache.surfaceComparisonInstalled)return;
      cache.surfaceComparisonInstalled=true;
      const {CubeCamera,WebGLCubeRenderTarget,HalfFloatType,RGBAFormat,LinearSRGBColorSpace,PointLight,SpotLight}=await import('/node_modules/.vite/deps/three.js');
      const {createIndirectProbeIntegrator}=await import('/src/indirectProbeIntegration.ts');
      const size=cache.layout.size,cube=new WebGLCubeRenderTarget(size,{type:HalfFloatType,format:RGBAFormat,generateMipmaps:false,colorSpace:LinearSRGBColorSpace});
      const camera=new CubeCamera(.03,80,cube);camera.coordinateSystem=gl.coordinateSystem;camera.updateCoordinateSystem();
      const integrator=createIndirectProbeIntegrator(size),read=cache.read.bind(cache),positions=new Map();
      window.giProfile.surfaceComparisons??=[];window.giProfile.surfacePending??=0;
      cache.read=function(probe,pass){
        const actual=read(probe,pass),slot=cache.layout.slots.get(probe);
        if(pass===1)positions.set(probe,[...source.userData.indirectLighting.lastCapture.position]);
        if(slot>=2&&slot%24!==0)return actual;
        const capture=source.userData.getIndirectCaptureScene().scene;
        const target=gl.getRenderTarget(),face=gl.getActiveCubeFace(),mip=gl.getActiveMipmapLevel(),stats={...gl.info.render};
        const background=capture.background,autoClear=gl.autoClear,x=cache.tile.value.x,y=cache.tile.value.y;
        const surface=source.userData.getIndirectSurfaceCaptureScene?.()?.scene;
        const lights=pass===1?surface.children.filter(o=>o instanceof PointLight||o instanceof SpotLight):[];
        let reference;
        try{
          cache.tile.value.set(0,0);gl.autoClear=true;capture.background=cache.sky;
          for(const light of lights){capture.add(light);if(light instanceof SpotLight)capture.add(light.target);}
          camera.position.fromArray(positions.get(probe));camera.updateMatrixWorld(true);
          for(let f=0;f<6;f++){gl.setRenderTarget(cube,f);gl.clear();gl.render(capture,camera.children[f]);}
          // Three's async read also cannot restore a bound cube framebuffer array.
          gl.setRenderTarget(null);reference=integrator.read(gl,cube);
        }finally{
          cache.tile.value.set(x,y);capture.background=background;gl.autoClear=autoClear;
          for(const light of lights){surface.add(light);if(light instanceof SpotLight)surface.add(light.target);}
          gl.setRenderTarget(target,face,mip);Object.assign(gl.info.render,stats);
        }
        window.giProfile.surfacePending++;
        void Promise.all([actual,reference]).then(([a,b])=>{
          let max=0,peak=0,total=0;for(let i=0;i<4;i++)for(const axis of ['x','y','z']){
            const delta=Math.abs(a.coefficients[i][axis]-b.coefficients[i][axis]);max=Math.max(max,delta);total+=delta;peak=Math.max(peak,Math.abs(b.coefficients[i][axis]));
          }
          window.giProfile.surfaceComparisons.push({probe,pass,max,mean:total/12,peak,
            ...(max>.002?{actual:a.coefficients.slice(0,4).map(c=>c.toArray()),reference:b.coefficients.slice(0,4).map(c=>c.toArray())}:{})});
        }).catch(error=>console.error('Surface comparison failed:',error)).finally(()=>window.giProfile.surfacePending--);
        return actual;
      };
    })()`)
    if (process.argv.includes('--compare-captures')) await evaluate(`(async()=>{
      if(window.giProfile.comparisonInstalled)return;
      const {Mesh,MeshStandardMaterial,PointLight,SpotLight,DataUtils}=await import('/node_modules/.vite/deps/three.js');
      const state=window.roofWallScene(),gl=state.gl,source=state.scene,render=gl.render.bind(gl);
      window.giProfile.comparisons=[];window.giProfile.comparisonInstalled=true;
      const faceCounts=new Map();
      gl.render=function(capture,camera){
        render(capture,camera);
        const owned=source.userData.getIndirectCaptureScene?.()?.scene,pass=source.userData.indirectLighting?.pass;
        if(capture!==owned)return;
        const faceNumber=faceCounts.get(pass)??0;faceCounts.set(pass,faceNumber+1);
        // First two probes, then one cubemap every 24 probes across the house.
        if(faceNumber>=12&&faceNumber%144>=6)return;
        const target=gl.getRenderTarget(),face=gl.getActiveCubeFace(),mip=gl.getActiveMipmapLevel();
        const actual=new Uint16Array(target.width*target.height*4),reference=new Uint16Array(actual.length);
        // Three's synchronous read restores the current framebuffer; unbind the
        // cube first so it does not try binding the cube's framebuffer array.
        const readPixels=buffer=>{gl.setRenderTarget(null);try{gl.readRenderTargetPixels(target,0,0,target.width,target.height,buffer,face)}finally{gl.setRenderTarget(target,face,mip)}};
        readPixels(actual);
        const hidden=[],transparent=[],lights=[],seen=new Set(),background=source.background;
        const active=capture.children.filter(o=>o instanceof PointLight||o instanceof SpotLight);
        source.traverse(object=>{
          if(object instanceof PointLight||object instanceof SpotLight){lights.push([object,object.visible,object.intensity]);object.visible=false;object.intensity=0;}
          if(!(object instanceof Mesh))return;
          if(object.userData.selectionDecoration||object.userData.houseDesignerRole==='ground-image'){hidden.push([object,object.visible]);object.visible=false;return;}
          for(const material of Array.isArray(object.material)?object.material:[object.material]){
            if(seen.has(material)||!material.transparent)continue;seen.add(material);
            transparent.push([material,material.opacity,material.visible,material.depthWrite]);
            if(!(material instanceof MeshStandardMaterial)||/glass|glazing/i.test(material.name))material.visible=false;
            else {material.opacity=1;material.depthWrite=true;}
          }
        });
        try{
          for(const light of active){source.add(light);if(light instanceof SpotLight)source.add(light.target);}
          source.background=capture.background;
          gl.setRenderTarget(target,face,mip);gl.clear();render(source,camera);
          readPixels(reference);
          let max=0,total=0,count=0,peak=0,maxIndex=0;
          for(let i=0;i<actual.length;i++){if(i%4===3)continue;const a=DataUtils.fromHalfFloat(actual[i]),b=DataUtils.fromHalfFloat(reference[i]);const d=Math.abs(a-b);if(d>max){max=d;maxIndex=i}total+=d;peak=Math.max(peak,Math.abs(b));count++;}
          const pixel=Math.floor(maxIndex/4),offset=pixel*4;
          window.giProfile.comparisons.push({pass,face,faceNumber,max,mean:total/count,peak,
            ...(max>.002?{pixel:[pixel%target.width,Math.floor(pixel/target.width)],actual:Array.from(actual.slice(offset,offset+3),DataUtils.fromHalfFloat),reference:Array.from(reference.slice(offset,offset+3),DataUtils.fromHalfFloat)}:{})});
        }finally{
          for(const light of active){capture.add(light);if(light instanceof SpotLight)capture.add(light.target);}
          source.background=background;
          for(const [o,visible]of hidden)o.visible=visible;
          for(const [m,opacity,visible,depthWrite]of transparent){m.opacity=opacity;m.visible=visible;m.depthWrite=depthWrite;}
          for(const [l,visible,intensity]of lights){l.visible=visible;l.intensity=intensity;}
          gl.setRenderTarget(target,face,mip);gl.clear();render(capture,camera);
        }
      };
    })()`)
    status = await evaluate(`(()=>{const s=window.roofWallScene().scene.userData.indirectLighting;if(!s)return null;
      const {generation,state,completed,total,probes,rooms,preparing,warming,reading,volumePending,previewPending,pendingUpdate,blocked,pass,captureMs,capturedFaces,firstPreviewMs,bakeStartedAt,maxFaceMs,moving,inFlight,maxInFlight}=s;
      const poll={at:performance.now(),generation,state,completed,total,probes,rooms,preparing,warming,reading,volumePending,previewPending,pendingUpdate,blocked,pass,captureMs,capturedFaces,firstPreviewMs,bakeStartedAt,maxFaceMs,moving,inFlight,maxInFlight,prepareTimings:s.prepareTimings,prepareStage:s.prepareStage,captureSceneMs:s.captureSceneMs,captureMergedMeshes:s.captureMergedMeshes,captureSceneMeshes:s.captureSceneMeshes,captureDrawCalls:s.captureDrawCalls,captureTriangles:s.captureTriangles,multiviewViews:s.multiviewViews,multiviewBatches:s.multiviewBatches,multiviewProbes:s.multiviewProbes,surfaceCacheBytes:s.surfaceCacheBytes,surfaceCachedProbes:s.surfaceCachedProbes,surfaceReplayedProbes:s.surfaceReplayedProbes,surfaceReusedFaces:s.surfaceReusedFaces,surfaceDataFaces:s.surfaceDataFaces};window.giProfile.polls.push(poll);return poll})()`)
    if (Date.now() - lastLog > 10000) { console.log('GI', JSON.stringify(status)); lastLog = Date.now() }
    if (status?.state === 'fallback') throw Error(`GI unavailable: ${JSON.stringify(status)}`)
    if (process.argv.includes('--compare-only') && await evaluate('window.giProfile.comparisons?.filter(r=>r.pass===2).length>=72')) break
    if (process.argv.includes('--prepare-only') && status?.prepareTimings && status?.probes) break
    if (status?.state === 'ready' && !status.volumePending && !status.pendingUpdate) {
      if (process.argv.includes('--relight-sun') && !initial) {
        initial = { status, bakeMs: status.at - status.bakeStartedAt }
        await evaluate(`window.giInitialSurfaceCache=window.roofWallScene().scene.userData.getIndirectSurfaceCache();
          window.updateRegressionSunPosition({...window.regressionSunPosition,azimuth:window.regressionSunPosition.azimuth+.25})`)
        continue
      }
      if (initial && status.generation === initial.status.generation) continue
      ready = true; break
    }
  }
  if (process.argv.includes('--compare-surfaces')) await evaluate('(async()=>{while(window.giProfile.surfacePending)await new Promise(resolve=>setTimeout(resolve,50))})()')
  if (process.argv.includes('--compare-multiview')) await evaluate('(async()=>{while(window.giProfile.multiviewPending)await new Promise(resolve=>setTimeout(resolve,50))})()')
  const data = await evaluate('window.giProfile')
  const stats = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
    return { count: sorted.length, sumMs: sorted.reduce((a, b) => a + b, 0), minMs: sorted[0], maxMs: sorted.at(-1), medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] }
  }
  const summary = { project, ready, valid: errors.length === 0, captureBudget: process.argv.includes('--legacy-budget') ? 'legacy' : 'adaptive', elapsedMs: Date.now() - start,
    bakeMs: status?.bakeStartedAt ? status.at - status.bakeStartedAt : undefined,
    hardware: data.hardware, status, ...(initial ? { initial } : {}),
    workers: Object.fromEntries([...new Set(data.workers.map(r => r.kind))].map(kind => [kind, stats(data.workers.filter(r => r.kind === kind && r.finished).map(r => r.ms))])),
    probeReadbacks: stats(data.reads.filter(r => r.width === 4 && r.height === 1).map(r => r.ms)),
    sampledStates: Object.fromEntries(['blocked','preparing','warming','reading','volumePending','previewPending','moving'].map(key => [key, data.polls.filter(p => p[key]).length])), samples: data.polls.length, errors }
  if (data.comparisons) summary.comparisons = data.comparisons
  if (data.surfaceComparisons) summary.surfaceComparisons=data.surfaceComparisons
  if (data.multiviewComparisons) summary.multiviewComparisons=data.multiviewComparisons
  const viewSuffix = (data.multiviewComparisons ? '-multiview-comparison' : process.argv.includes('--multiview') || process.argv.includes('--multiview-2') ? '-multiview' : '') + (process.argv.includes('--multiview-2') ? '-2' : '')
  const path = `.tmp-gi-pipeline-${project}${data.comparisons ? '-capture-comparison' : data.surfaceComparisons ? '-surface-comparison' : status?.surfaceCacheBytes ? '-surface' : '-uncached'}${viewSuffix}${initial ? '-sun-edit' : ''}-${summary.captureBudget}.json`
  writeFileSync(path, JSON.stringify({ summary, ...data }, null, 2))
  console.log(JSON.stringify(summary, null, 2)); console.log(`Detailed profile: ${path}`)
  if (errors.length || (!ready && !process.argv.includes('--prepare-only') && !process.argv.includes('--compare-only'))) process.exitCode = 1
  if (data.comparisons) {
    assert.ok(data.comparisons.some(r => r.pass === 1) && data.comparisons.some(r => r.pass === 2), 'compare both bounces')
    assert.ok(data.comparisons.every(r => r.max <= .002 + r.peak * .002), 'capture radiance matches the live-scene reference within half-float precision')
  }
  if (process.argv.includes('--compare-surfaces')) {
    assert.ok(status?.surfaceReplayedProbes>0,'second bounce uses cached surfaces')
    assert.ok(data.surfaceComparisons?.some(r=>r.pass===1)&&data.surfaceComparisons.some(r=>r.pass===2),'compare both cached bounces')
    assert.ok(data.surfaceComparisons.every(r=>r.max<=.002+r.peak*.002),'cached transport matches geometry capture within half-float precision')
  }
  if (process.argv.includes('--compare-multiview')) {
    assert.ok(status.multiviewProbes>0,'capture uses the GPU multiview path')
    assert.ok(data.multiviewComparisons?.some(r=>r.pass===1)&&data.multiviewComparisons.some(r=>r.pass===2),'compare both multiview bounces')
    assert.ok(data.multiviewComparisons.every(r=>r.max<=.002+r.peak*.002),'multiview lighting matches separate cube captures within half-float precision')
  }
  if (initial?.status.surfaceCacheBytes) {
    assert.equal(await evaluate('window.giInitialSurfaceCache===window.roofWallScene().scene.userData.getIndirectSurfaceCache()'),true,'sun edits retain surface data')
    assert.equal(status.surfaceDataFaces,0,'sun edits do not draw the surface-data scene')
    assert.ok(status.surfaceReplayedProbes>0,'sun edits reuse surfaces for the second bounce')
    assert.equal(status.capturedFaces+status.surfaceReusedFaces,6*(status.probes*2+status.rooms))
  }
} finally {
  for (const request of pending.values()) clearTimeout(request.timer)
  ws?.close(); child.kill()
}
