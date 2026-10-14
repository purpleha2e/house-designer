// With Vite running: node tests/browser/lightingStartupRegression.mjs [port] [project]
// Verifies early GI publication, camera shader reuse and lighting-edit continuity.
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', `--window-size=1200,${process.argv.includes('--probes') ? 1050 : 850}`,
  `--user-data-dir=${createBrowserTestProfile('object-handles-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (pending.has(result.id)) {
      const { resolve, reject } = pending.get(result.id)
      pending.delete(result.id)
      if (result.error) reject(result.error)
      else resolve(result.result)
    }
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
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Page.enable')

  await call('Runtime.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});await call('Page.bringToFront')
  const errors=[];ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '))})
  const port=process.argv[2]??'5180',project=process.argv[3]??'lighting-startup'
  const installSavedHouse=house=>call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI=${JSON.stringify(house)};window.giWorkerCreations=0;const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);if(String(url).includes('indirectLighting.worker'))window.giWorkerCreations++}}`})
  async function restore(url,stateFunction) {
    const started=Date.now();await call('Page.navigate',{url})
    let loaded
    for(let i=0;i<1200;i++){await pause(100);loaded=await evaluate(`${stateFunction}?.()?.scene.userData.indirectLighting`);if(i%100===0)console.log('Saved GI loading',stateFunction,loaded?.state,loaded?.blocked,loaded?.pendingUpdate);if(loaded?.source==='saved'&&loaded?.state==='ready')break}
    console.log('Saved GI restore',stateFunction,Date.now()-started,'ms',JSON.stringify(loaded))
    assert.equal(loaded?.source,'saved','saved lighting loads instead of recalculating: '+JSON.stringify(loaded))
    assert.equal(loaded.capturedFaces,0,'loading performs no cubemap captures')
    assert.equal(loaded.geometryBuilds,0,'loading performs no GI geometry preparation')
    assert.equal(await evaluate('window.giWorkerCreations'),0,'client needs no GI worker')
    await pause(1500)
    assert.equal(await evaluate(`${stateFunction}().scene.userData.indirectLighting.capturedFaces`),0,'later shader preparation does not invalidate saved GI')
  }
  async function verifySavedLightingEdit() {
    const before=await evaluate('window.roofWallScene().scene.userData.indirectLighting.generation')
    await evaluate('window.updateRegressionSunPosition({...window.regressionSunPosition,azimuth:window.regressionSunPosition.azimuth+.2})')
    await pause(1000)
    const status=await evaluate('window.roofWallScene().scene.userData.indirectLighting')
    assert.ok(status.generation>before,'a lighting edit invalidates persisted GI')
    assert.equal(status.source,'baked','the edited house needs replacement lighting')
    assert.equal(status.displayed,true,'previous lighting remains visible during the replacement')
    assert.equal(await evaluate('!!window.roofWallScene().scene.userData.getBakedIndirectLighting()'),false,'Save cannot reuse stale lighting after an edit')
  }
  if(process.argv.includes('--saved-only')) {
    const {createRuntimePortalCatalog}=await import('../../src/portalCatalog.ts')
    const catalog=createRuntimePortalCatalog(await(await fetch('http://127.0.0.1:'+port+'/api/portal/catalog')).json())
    const house={title:'Saved GI regression',materials:catalog.materials,project:JSON.parse(readFileSync('.tmp-indirect-baked-'+project+'.house.json','utf8'))}
    await installSavedHouse(house)
    await restore('http://127.0.0.1:'+port+'/tests/browser/readOnlyViewerRegression.html?saved-gi','window.viewerState')
    assert.equal(await evaluate('window.viewerHouseUnchanged()'),true)
    await restore('http://127.0.0.1:'+port+'/tests/browser/roofWallRegression.html?'+project+'&strict&materials&saved-gi','window.roofWallScene')
    await verifySavedLightingEdit()
    assert.deepEqual(errors,[])
    console.log('Saved GI client and editor reload regression passed:',project)
    ws.close();child.kill();process.exit(0)
  }
  await call('Page.navigate', { url: 'http://127.0.0.1:'+port+'/tests/browser/roofWallRegression.html?'+project+'&strict&materials'+(process.argv.includes('--live')?'&live-gi':'') })
  for(let i=0;i<180;i++){await pause(250);if(await evaluate('!!window.roofWallScene?.()'))break}
  if(process.argv.includes('--surface-cache'))await evaluate('window.roofWallScene().scene.userData.indirectSurfaceCacheEnabled=true')
  await evaluate('(()=>{const s=window.roofWallScene();s.setDpr(.5);s.camera.position.set(2,1.6,2);s.camera.lookAt(2,1.6,0);s.controls?.target?.set(2,1.6,0);s.camera.updateMatrixWorld();s.invalidate()})()')
  const status=()=>evaluate('window.roofWallScene().scene.userData.indirectLighting')
  let preview
  for(let i=0;i<1800;i++){await pause(100);const s=await status();if(i%100===0)console.log('GI progress',s?.state,s?.completed,s?.total);if(s?.displayed){preview=s;break}}
  assert.ok(preview?.displayed,'startup publishes a visible volume')
  assert.ok(preview.completed<preview.probes,'startup displays GI before the first full probe pass')
  console.log('Startup preview',preview.completed,'of',preview.probes,'probes')
  if(process.argv.includes('--live')) {
    assert.ok(preview.previewUpdates>0,'startup uses the independent live-preview worker path')
    writeFileSync('.tmp-indirect-live-preview.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    const before=await status()
    for(let i=0;i<40;i++) {
      await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(${2 + Math.sin(i/10)*.3},1.6,2);s.controls?.target?.set(2,1.6,0);s.camera.lookAt(2,1.6,0);s.camera.updateMatrixWorld();s.invalidate()})()`)
      await pause(50)
    }
    const after=await status()
    assert.equal(after.generation,before.generation,'navigation preserves the bake')
    assert.ok(after.capturedFaces>before.capturedFaces,'captures make progress during continuous navigation')
    console.log('Navigation capture progress',after.capturedFaces-before.capturedFaces,'faces; first preview',preview.firstPreviewMs,'ms')
  }
  for(let i=0;i<20;i++){if(/GI refining/.test(await evaluate(`document.querySelector('[aria-label="Indirect lighting progress"]').textContent`)))break;await pause(100)}
  assert.match(await evaluate(`document.querySelector('[aria-label="Indirect lighting progress"]').textContent`),/GI refining/)
  if(process.argv.includes('--probes')) {
    await pause(1500)
    assert.match(await evaluate(`document.querySelector('[aria-label="3D engine status"]').textContent`),/GI /,'engine status reports lighting activity')
    assert.equal(await evaluate(`!!window.roofWallScene().scene.getObjectByName('indirect-lighting-probes')`),false,'probe display starts off')
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    const generation=(await status()).generation
    const toggle=`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='GI probes')?.querySelector('input');if(!input)throw Error('Missing GI probes render setting');input.click()})()`
    await evaluate(toggle);await pause(1500)
    const markers=await evaluate(`(()=>{const s=window.roofWallScene(),m=s.scene.getObjectByName('indirect-lighting-probes');return m&&{count:m.count,decoration:m.userData.selectionDecoration,active:m.material.uniforms.activeProbe.value,captured:Array.from(m.geometry.attributes.probeCaptured.array.slice(0,m.count)).filter(Boolean).length,lit:Array.from(m.geometry.attributes.probeSH0.array.slice(0,m.count*3)).some(v=>v>.001),hits:(()=>{const hits=[];m.raycast(null,hits);return hits.length})()}})()`)
    assert.ok(markers?.count>0,'actual worker probes are displayed')
    assert.ok(markers.captured>0&&markers.lit,'markers contain measured light')
    assert.equal(markers.decoration,true,'markers are excluded from GI geometry and capture')
    assert.equal(markers.hits,0,'markers never intercept picking')
    assert.equal((await status()).generation,generation,'enabling probes preserves the lighting cache')
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(2,1.6,2);s.camera.lookAt(6,1.6,6);s.controls?.target?.set(6,1.6,6);s.camera.updateMatrixWorld();s.invalidate()})()`);await pause(1500)
    writeFileSync('.tmp-indirect-probes-'+project+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await evaluate(toggle);await pause(750)
    assert.equal(await evaluate(`!!window.roofWallScene().scene.getObjectByName('indirect-lighting-probes')`),false,'disabling probes removes diagnostic mesh')
    assert.equal((await status()).generation,generation,'disabling probes preserves the lighting cache')
    assert.deepEqual(errors,[])
    console.log('GI probe render setting passed:',project,JSON.stringify(markers))
    ws.close();child.kill();process.exit(0)
  }
  if(project!=='lighting-startup'&&!process.argv.includes('--cache')){
    assert.ok(Object.values(preview.roomMean).some(colour=>colour.some(value=>value>.001)),'the early GI probes contain scene light')
    assert.deepEqual(errors,[]);console.log('Project GI startup passed:',project);ws.close();child.kill();process.exit(0)
  }
  let settled
  for(let i=0;i<6000;i++){await pause(100);const s=await status();if(i%100===0)console.log('GI completion',s?.state,s?.completed,s?.total);if(s?.state==='ready'&&!s.volumePending){settled=s;break}}
  assert.equal(settled?.state,'ready','the final GI volume and reflections complete')
  // The complete house can still be compressing its cache after captures finish.
  for(let i=0;i<600;i++){if(await evaluate(`document.querySelector('[aria-label="Indirect lighting progress"]').textContent==='GI ready'`))break;await pause(100)}
  assert.equal(await evaluate(`document.querySelector('[aria-label="Indirect lighting progress"]').textContent`),'GI ready')
  if(process.argv.includes('--cache')) {
    let cache
    for(let i=0;i<600;i++){cache=await evaluate('window.roofWallScene().scene.userData.getBakedIndirectLighting?.()');if(cache)break;await pause(100)}
    assert.ok(cache,'completed lighting is compressed and available to project Save')
    assert.ok(cache.reflections.length>0,'room reflections are included')
    const house=await evaluate(`(async()=>{const models=await import('/src/models/modelLibrary.ts'),materials=await import('/src/materials/materialCatalog.ts');return {title:'Saved GI regression',materials:[...materials.surfaceMaterialsById.values()],project:{activeFloorId:window.regressionActiveFloorId,floors:window.regressionFloors,sunPosition:window.regressionSunPosition,surfaceAssignments:window.regressionAssignments,modelDefinitions:[...models.modelsById.values()].filter(m=>window.regressionFloors.some(f=>f.models.some(p=>p.modelId===m.id))),wallKind:'external',indirectLighting:window.roofWallScene().scene.userData.getBakedIndirectLighting()}}})()`)
    writeFileSync('.tmp-indirect-baked-'+project+'.house.json',JSON.stringify(house.project))
    await installSavedHouse(house)
    const compare=await evaluate(`(async()=>{const t=await import('/node_modules/.vite/deps/three.js'),{LightProbeGenerator}=await import('/node_modules/three/examples/jsm/lights/LightProbeGenerator.js'),{createIndirectProbeIntegrator}=await import('/src/indirectProbeIntegration.ts');const s=window.roofWallScene(),scene=new t.Scene(),target=new t.WebGLCubeRenderTarget(16,{type:t.HalfFloatType,format:t.RGBAFormat,colorSpace:t.LinearSRGBColorSpace}),cube=new t.CubeCamera(.1,10,target);scene.background=new t.Color().setRGB(.25,.1,.05);const wall=new t.Mesh(new t.PlaneGeometry(4,4),new t.MeshBasicMaterial({color:new t.Color().setRGB(.8,.2,.05),toneMapped:false}));wall.position.z=-2;scene.add(wall);cube.update(s.gl,scene);const integrator=createIndirectProbeIntegrator(16);await integrator.compile(s.gl,target);const gpu=await integrator.read(s.gl,target),cpu=await LightProbeGenerator.fromCubeRenderTarget(s.gl,target);const differences=gpu.coefficients.slice(0,4).flatMap((c,i)=>c.toArray().map((v,j)=>Math.abs(v-cpu.sh.coefficients[i].toArray()[j])));integrator.dispose();target.dispose();wall.geometry.dispose();wall.material.dispose();return {max:Math.max(...differences),cpu:cpu.sh.coefficients.slice(0,4).map(c=>c.toArray()),gpu:gpu.coefficients.slice(0,4).map(c=>c.toArray())}})()`)
    console.log('GPU SH integration comparison',JSON.stringify(compare));assert.ok(compare.max<.003,'GPU integration matches the six-face reference, including direction and HDR colour')
    await restore('http://127.0.0.1:'+port+'/tests/browser/readOnlyViewerRegression.html?saved-gi','window.viewerState')
    assert.equal(await evaluate('window.viewerHouseUnchanged()'),true,'read-only loading never modifies the model')
    await restore('http://127.0.0.1:'+port+'/tests/browser/roofWallRegression.html?'+project+'&strict&materials&saved-gi','window.roofWallScene')
    await verifySavedLightingEdit()
    assert.deepEqual(errors,[])
    console.log('Saved GI client and editor reload regression passed:',project,'cache bytes',JSON.stringify(cache).length)
    ws.close();child.kill();process.exit(0)
  }
  await evaluate('(()=>{const s=window.roofWallScene(),g=s.gl.getContext(),f=g.createProgram.bind(g);window.oldProgramKeys=new Set(s.gl.info.programs.map(p=>p.cacheKey));window.navigationPrograms=0;g.createProgram=function(){window.navigationPrograms++;return f()}})()')
  for(let repeat=0;repeat<2;repeat++)for(const pos of [[2,1.6,-.4],[2,1.6,4],[8,1.6,2],[2,1.6,-.4],[28,18,38],[2,1.6,-.4]]){await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.fromArray(${JSON.stringify(pos)});s.camera.lookAt(2,1.6,2);s.controls?.target?.set(2,1.6,2);s.camera.updateMatrixWorld();s.invalidate()})()`);await pause(750)}
  const programs=await evaluate('window.navigationPrograms');console.log('Navigation created shader programs:',programs)
  if(programs)console.log('New program materials',await evaluate(`(()=>{const s=window.roofWallScene(),entries=[];s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m)continue;const ps=s.gl.properties.get(m).programs;for(const [key,p] of ps??[])if(!window.oldProgramKeys.has(key))entries.push({role:o.userData.houseDesignerRole,material:m.type,key:m.customProgramCacheKey(),program:key,side:m.side,transparent:m.transparent,env:m.envMap?.image?.height})}});return entries})()`))
  assert.equal(programs,0,'moving through faded walls reuses prepared shader programs')
  assert.equal((await status()).generation,settled.generation,'navigation retains GI')
  if(process.argv.includes('--surface-cache')){
    assert.ok(settled.surfaceDataFaces>0,'the initial bake records surface data')
    await evaluate('void (window.startupSurfaceCache=window.roofWallScene().scene.userData.getIndirectSurfaceCache())')
  }
  const before=await evaluate('(()=>{const s=window.roofWallScene();let id;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIUseVolume?.value===1)id=u.hdGIVolume.value.uuid}});return id})()')
  await evaluate('window.updateRegressionSunPosition({...window.regressionSunPosition,azimuth:window.regressionSunPosition.azimuth+.25})');await pause(50)
  const during=await evaluate('(()=>{const s=window.roofWallScene();let id;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIUseVolume?.value===1)id=u.hdGIVolume.value.uuid}});return id})()')
  assert.equal(during,before,'lighting edits retain the displayed volume while updating')
  if(process.argv.includes('--live')) {
    let live
    for(let i=0;i<100;i++){await pause(100);live=await status();if(live.previewUpdates>0&&!live.pendingUpdate)break}
    assert.ok(live.previewUpdates>0&&live.displayed,'a sun edit publishes a live preview before completion')
    assert.equal(await evaluate('!!window.roofWallScene().scene.userData.getBakedIndirectLighting?.()'),false,'a preview cannot be exported as a finished bake')
    assert.ok(live.completed<live.total,'the live result arrives before reflections and final refinement')
    console.log('Sun edit first preview',live.firstPreviewMs,'ms')
    for(let i=0;i<1200;i++){await pause(100);live=await status();if(live.state==='ready'&&!live.volumePending&&!live.pendingUpdate)break}
    assert.equal(live.state,'ready')
    if(process.argv.includes('--surface-cache')){
      assert.equal(live.surfaceDataFaces,0,'sun edits reuse all captured material data')
      assert.ok(live.surfaceReplayedProbes>0)
      assert.equal(await evaluate('window.startupSurfaceCache===window.roofWallScene().scene.userData.getIndirectSurfaceCache()'),true)
    }
    const builds=live.geometryBuilds
    await evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id==='startup-light'?{...m,lightPower:500}:m)})))`)
    for(let i=0;i<200;i++){await pause(100);live=await status();if(live.partial&&live.previewUpdates>0&&!live.pendingUpdate)break}
    assert.equal(live.partial,true,'lamp power edits use affected zones')
    assert.ok(live.reusedProbes>0,'the sealed neighbouring room retains its completed lighting')
    assert.equal(live.geometryBuilds,builds,'lamp power edits reuse geometry and visibility')
    assert.ok(live.previewUpdates>0&&live.displayed)
    if(process.argv.includes('--surface-cache'))assert.equal(live.surfaceDataFaces,0,'lamp power edits reuse material data')
    console.log('Lamp edit first preview',live.firstPreviewMs,'ms; geometry builds',live.geometryBuilds)
    // Superseding an unfinished preview cannot publish or export the old edit.
    const oldGeneration=live.generation
    await evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id==='startup-light'?{...m,lightPower:750}:m)})))`)
    for(let i=0;i<1200;i++){await pause(100);live=await status();if(live.generation>oldGeneration&&live.state==='ready'&&!live.volumePending&&!live.pendingUpdate)break}
    assert.ok(live.generation>oldGeneration)
    assert.equal(live.state,'ready','the superseding edit finishes')
    assert.ok(live.displayed)
    const moveBuilds=live.geometryBuilds, moveGeneration=live.generation, moveStarted=Date.now()
    await evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id==='startup-light'?{...m,position:{...m.position,x:m.position.x+.4}}:m)})))`)
    for(let i=0;i<300;i++){await pause(100);live=await status();if(live.generation>moveGeneration&&!live.pendingUpdate&&live.previewUpdates>0)break}
    assert.ok(live.previewUpdates>0&&live.generation>moveGeneration,'moving the lamp produces a new live result')
    assert.equal(live.geometryBuilds,moveBuilds,'lamp movement keeps the prepared geometry')
    console.log('Moved lamp preview from edit',Date.now()-moveStarted,'ms')
    for(let i=0;i<1200;i++){await pause(100);live=await status();if(live.state==='ready'&&!live.volumePending&&!live.pendingUpdate)break}
    assert.equal(live.state,'ready')
    assert.equal(live.geometryBuilds,moveBuilds,'the completed lamp move reused geometry')
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(2,2.1,2);s.controls?.target?.set(3,.4,3.8);s.camera.lookAt(3,.4,3.8);s.camera.updateMatrixWorld();s.invalidate()})()`)
    await pause(750)
    writeFileSync('.tmp-indirect-live-final.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  assert.deepEqual(errors,[])
  console.log('GI startup, progress, navigation and rebake continuity passed')
}finally{ws?.close();child.kill()}
