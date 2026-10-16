// With Vite or the production diagnostic running: node tests/browser/basicSceneDiagnostic.mjs [port] [report suffix]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  `--user-data-dir=${createBrowserTestProfile('basic-scene-')}`, 'about:blank',
], { windowsHide: true })
const progressive = process.argv.includes('--progressive')
const navigate = !process.argv.includes('--stationary')
const noSavedLighting = process.argv.includes('--no-saved-lighting')
const pbr = process.argv.includes('--pbr')
const opaque = pbr || process.argv.includes('--opaque')
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
    for (let i = 0; i < 1800; i++) { if (await evaluate(expression)) return; if(errors.length)throw Error(JSON.stringify(errors)); if(i%100===0)console.log(await evaluate(progressive ? 'window.basicSceneState?.()?.scene.userData.progressiveStartup' : 'window.basicSceneReport')); await pause(100) }
    throw Error(`Timed out: ${label}: ${JSON.stringify(errors)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Network.enable')
  const textures=[]
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent'&&/\.(png|jpe?g|webp|ktx2|hdr|exr)(?:[?]|$)/i.test(m.params.request.url))textures.push(m.params.request.url)})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5181}/tests/browser/basicSceneDiagnostic.html?${progressive ? 'progressive' : 'basic-scene'}${pbr ? '&pbr-materials' : opaque ? '&opaque-materials' : ''}${noSavedLighting ? '&no-saved-lighting' : ''}`})
  if (progressive) {
    await until('window.basicSceneState?.()?.scene.userData.progressiveStartup?.opaqueReadyMs', 'opaque PBR ready')
    const first = await evaluate(`(()=>{const s=window.basicSceneState();window.progressiveGeometries=new Set();s.scene.traverse(o=>{if(o.isMesh)window.progressiveGeometries.add(o.geometry.uuid)});window.progressiveSources=[];s.scene.traverse(o=>{if(o.isMesh)window.progressiveSources.push({geometry:o.geometry.uuid,role:o.userData.houseDesignerRole??o.type,name:o.name})});return{...s.scene.userData.progressiveStartup,geometryCount:window.progressiveGeometries.size,position:s.camera.position.toArray(),programs:s.gl.info.programs.length}})()`)
    assert.equal(first.phase, 'lighting', 'opaque scene must be displayed before full lighting is ready')
    console.log('Opaque first', first)
    writeFileSync('.tmp-progressive-opaque.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    await evaluate(`(()=>{window.progressiveGaps=[];window.progressiveSampling=true;let last=performance.now();function sample(now){window.progressiveGaps.push(now-last);last=now;if(window.progressiveSampling)requestAnimationFrame(sample)}requestAnimationFrame(sample);document.querySelector('canvas').focus()})()`)
    if (navigate) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
      await pause(5000)
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
    }
    const movement = await evaluate(`(()=>{window.progressiveSampling=false;const s=window.basicSceneState();return{position:s.camera.position.toArray(),frames:s.scene.userData.progressiveStartup.frames,gaps:window.progressiveGaps}})()`)
    if (navigate) {
      assert.notDeepEqual(movement.position, first.position, 'camera must move during background preparation')
      assert.ok(movement.frames > first.frames + 10, 'opaque display must keep rendering')
    }
    console.log('Movement', { frames: movement.frames, maxGap: Math.max(...movement.gaps) })
    await until('window.basicSceneState().gl.info.programs.length > 5', 'background shader compilation started')
    await evaluate(`(()=>{window.progressiveGaps=[];window.progressiveSampling=true;let last=performance.now();function sample(now){window.progressiveGaps.push(now-last);last=now;if(window.progressiveSampling)requestAnimationFrame(sample)}requestAnimationFrame(sample)})()`)
    if (navigate) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
      await pause(3000)
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
    }
    const backgroundMovement = await evaluate(`(()=>{window.progressiveSampling=false;const s=window.basicSceneState();return{position:s.camera.position.toArray(),phase:s.scene.userData.progressiveStartup.phase,programs:s.gl.info.programs.length,gaps:window.progressiveGaps}})()`)
    if (navigate) assert.notDeepEqual(backgroundMovement.position,movement.position,'navigation must still work after lighting compilation starts')
    console.log('Background movement', { phase: backgroundMovement.phase, programs: backgroundMovement.programs, maxGap: Math.max(...backgroundMovement.gaps) })
    await until('window.basicSceneState().scene.userData.progressiveStartup?.lightingReadyMs', 'early direct lighting')
    const lit = await evaluate('({...window.basicSceneState().scene.userData.progressiveStartup, gi: window.basicSceneState().scene.userData.indirectLighting})')
    assert.ok(!lit.lightingError, lit.lightingError)
    assert.equal(lit.phase, 'lit', 'direct lighting must be displayed before full effects')
    console.log('Early lighting', lit)
    writeFileSync('.tmp-progressive-lit.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    if (!noSavedLighting) {
      await until('window.basicSceneState().scene.userData.progressiveStartup?.diffuseReadyMs', 'saved diffuse lighting display')
      assert.equal(await evaluate('window.basicSceneState().scene.userData.progressiveStartup.phase'), 'lit')
      writeFileSync('.tmp-progressive-diffuse.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    }
    let effectsMovement
    if (process.argv.includes('--effects-navigation')) {
      await until('window.basicSceneState().scene.userData.shaderWarmupProfile?.some(p => p.batches.length)', 'full effect compilation started')
      const before = await evaluate('window.basicSceneState().camera.position.toArray()')
      await evaluate(`(()=>{window.progressiveGaps=[];window.progressiveSampling=true;let last=performance.now();function sample(now){window.progressiveGaps.push(now-last);last=now;if(window.progressiveSampling)requestAnimationFrame(sample)}requestAnimationFrame(sample)})()`)
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
      await pause(2000)
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
      effectsMovement = await evaluate(`(()=>{window.progressiveSampling=false;return{position:window.basicSceneState().camera.position.toArray(),gaps:window.progressiveGaps}})()`)
      assert.notDeepEqual(effectsMovement.position, before, 'navigation continues while full effects compile')
      assert.ok(effectsMovement.gaps.length > 10, 'lit view keeps drawing while effects compile')
      assert.ok(Math.max(...effectsMovement.gaps) < 250, 'effect compilation must not cause a long navigation stall')
      console.log('Effects navigation', { frames: effectsMovement.gaps.length, maxGap: Math.max(...effectsMovement.gaps) })
    }
    await until('window.basicSceneState().scene.userData.progressiveStartup?.phase === "full"', 'full lighting handover')
    const final = await evaluate(`(()=>{const s=window.basicSceneState();let reused=0,total=0;const finalGeometries=new Set();s.scene.traverse(o=>{if(o.isMesh){total++;finalGeometries.add(o.geometry.uuid);if(window.progressiveGeometries.has(o.geometry.uuid))reused++}});const missing=window.progressiveSources.filter(o=>!finalGeometries.has(o.geometry));return{...s.scene.userData.progressiveStartup,reused,total,retainedGeometryCount:[...window.progressiveGeometries].filter(id=>finalGeometries.has(id)).length,missing,error:s.gl.getContext().getError(),gi:s.scene.userData.indirectLighting}})()`)
    console.log('Handover', final)
    assert.equal(final.error,0)
    assert.ok(final.lightingReadyMs < final.fullReadyMs, 'full effects must not block the first lit frame')
    if (!noSavedLighting) assert.ok(final.diffuseReadyMs < final.fullReadyMs, 'saved diffuse lighting must be displayed before full effects')
    assert.ok(final.retainedGeometryCount / first.geometryCount > 0.95, 'lighting must not remount the geometry tree')
    if (!noSavedLighting) await until('window.basicSceneState().scene.userData.indirectLighting?.state === "ready"', 'saved GI ready')
    final.gi = await evaluate('window.basicSceneState().scene.userData.indirectLighting')
    final.profile = await evaluate('window.basicSceneState().scene.userData.shaderWarmupProfile')
    final.gpu = await evaluate(`(()=>{const gl=window.basicSceneState().gl.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return{vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),parallelCompile:!!gl.getExtension('KHR_parallel_shader_compile')}})()`)
    final.programs = await evaluate(`(()=>{const s=window.basicSceneState(),gl=s.gl.getContext();return s.gl.info.programs.map(p=>({name:p.name,key:p.cacheKey,uses:p.usedTimes,vertexLength:gl.getShaderSource(p.vertexShader)?.length,fragmentLength:gl.getShaderSource(p.fragmentShader)?.length}))})()`)
    assert.deepEqual(errors,[])
    writeFileSync('.tmp-progressive-startup.json' ,JSON.stringify({first,movement,backgroundMovement,lit,effectsMovement,final},null,2))
    writeFileSync('.tmp-progressive-full.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    console.log('PASS progressive startup',JSON.stringify({...final,programs:final.programs.map(p=>({name:p.name,uses:p.uses,fragmentLength:p.fragmentLength}))}))
  } else {
  await until('window.basicSceneReport?.gpuCompleteMs || window.basicSceneReport?.error','basic scene')
  await pause(1500)
  const report=await evaluate('window.basicSceneReport')
  console.log('Measured scene', JSON.stringify(report))
  assert.ok(!report.error,report.error)
  assert.ok(report.meshes>100,'must load the actual house meshes')
  assert.ok(report.triangles>10000,'must draw real model geometry')
  if (opaque) {
    assert.ok(report.textures > 0, 'opaque mode must actually upload textures')
    assert.ok(report.materials > report.programs, 'materials must share shader programs')
    assert.equal(report.transparentMaterials, 0, 'no transparent or alpha-tested display materials')
  } else {
    assert.equal(report.programs,1,'exactly one basic shader program')
    assert.equal(report.textures,0,'no GPU textures')
  }
  if (pbr) {
    assert.equal(report.lights, 2, 'fixed unshadowed key and hemisphere lights')
    for (const map of ['normalMap', 'roughnessMap', 'metalnessMap']) {
      assert.ok(report.mapUsage[map] > 0, `PBR stage must actually bind ${map}`)
    }
  } else assert.equal(report.lights, 0)
  assert.deepEqual(report.pending,[],'all tracked preparation must complete')
  const state=await evaluate(`(()=>{const s=window.basicSceneState();return{gi:s.scene.userData.indirectLighting,shadows:s.gl.shadowMap.enabled,error:s.gl.getContext().getError(),programs:s.gl.info.programs.length}})()`)
  assert.equal(state.gi,undefined,'GI component must not run')
  assert.equal(state.shadows,false)
  assert.equal(state.error,0)
  assert.equal(state.programs,report.programs,'no delayed shader preparation')
  if (opaque) assert.ok(textures.length > 0, 'test real material textures')
  else assert.deepEqual(textures,[],'no texture network requests')
  assert.deepEqual(errors,[])
  const sourceMaterials = await evaluate(`(()=>{const rows=[];window.basicSceneState().scene.traverse(o=>{
    if(!o.isMesh)return;const ms=Array.isArray(o.material)?o.material:[o.material];
    if(/floor|slab/.test(o.userData.houseDesignerRole??''))rows.push({role:o.userData.houseDesignerRole,visible:o.visible,
      materials:ms.map(m=>({type:m.type,color:m.color?.getHexString(),colorWrite:m.colorWrite,opacity:m.opacity,map:m.map?.name,mapSize:m.map?.image?{width:m.map.image.width,height:m.map.image.height}:null}))});
  });return rows})()`)
  if (opaque) assert.ok(sourceMaterials.some(row => row.role === 'room-floor-finish' &&
    row.materials.some(material => material.mapSize?.width > 0)),
    'compressed surface colour textures must load; imported-model maps alone are insufficient')
  const suffix=process.argv[3]??'development'
  writeFileSync(`.tmp-basic-scene-${suffix}.json`,JSON.stringify({report,state,textures,sourceMaterials},null,2))
  writeFileSync(`.tmp-basic-scene-${suffix}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('PASS basic scene',JSON.stringify(report,null,2))
  }
} finally { ws?.close(); child.kill() }
