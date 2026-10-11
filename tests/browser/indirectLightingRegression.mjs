// Stage colin_house_v2.json with build:viewer, then run with Vite on port 5180.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const house = process.argv.includes('--house')
const localMode = process.argv.includes('--local')
const strict = process.argv.includes('--strict')
const editor = process.argv.includes('--editor')
const interior = process.argv.includes('--interior')
const open = process.argv.includes('--open')
const quick = process.argv.includes('--quick')
const small = quick || process.argv.includes('--small')
const corners = process.argv.includes('--corners')
const fastBake = process.argv.includes('--fast-bake')
const project = process.argv.find(arg => arg.startsWith('--project='))?.split('=')[1] ?? 'colin'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check', `--window-size=${corners ? '1400,1100' : small ? '1000,750' : '1800,1000'}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'viewer-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),60000)
    child.stderr.on('data', data => {
      const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if(match){clearTimeout(timeout);resolve(match[1])}
    })
    child.on('error',reject)
    child.on('exit',code=>reject(new Error(`Chrome exited ${code}`)))
  })
  ws=new WebSocket(endpoint)
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0
  const pending=new Map()
  ws.addEventListener('message',event=>{
    const result=JSON.parse(event.data),request=pending.get(result.id)
    if(request){pending.delete(result.id);result.error?request.reject(result.error):request.resolve(result.result)}
  })
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),60000)
    pending.set(++id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}})
    ws.send(JSON.stringify({id,method,params,sessionId}))
  })
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))

  const errors=[]
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '))})
  await call('Page.enable');await call('Runtime.enable')
  await call('Emulation.setFocusEmulationEnabled',{enabled:true})
  await call('Page.bringToFront')
  await call('Page.navigate',{url:editor ? `http://127.0.0.1:5180/tests/browser/roofWallRegression.html?${project}&strict&published-materials` : house ? 'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html?published' : `http://127.0.0.1:5180/tests/browser/indirectLightingRegression.html?${localMode ? 'local&' : ''}${open ? 'open&' : ''}${strict ? 'strict' : ''}`})
  const stateFunction = editor ? 'window.roofWallScene' : house ? 'window.viewerState' : 'window.lightingState'
  const state = `${stateFunction}()`
  let previewReduced = false
  let lampInspected = false
  for(let i=0;i<3600;i++){
    await pause(250)
    const status=await evaluate(`(${stateFunction})?.()?.scene.userData.indirectLighting`)
    if(fastBake && status && !previewReduced) {
      await evaluate(`(()=>{const s=${state};window.regressionPreviewDpr=s.gl.getPixelRatio();s.setDpr(.5);s.invalidate()})()`)
      previewReduced = true
    }
    if(i%40===0)console.log('GI progress',JSON.stringify(status&&{generation:status.generation,completed:status.completed,total:status.total,state:status.state}),JSON.stringify(errors).slice(0,400))
    if (editor && process.argv.includes('--edit-performance') && status?.completed > 0) {
      if(process.argv.includes('--profile')){await call('Profiler.enable');await call('Profiler.start')}
      const timings = await evaluate(`(async()=>{
        const s=${state}, candidates=window.regressionFloors.flatMap(f=>f.models.map(m=>({f,m})))
        const free=candidates.find(({m})=>!m.wallAttachment&&!m.roofAttachment&&!m.dormerAttachment&&s.scene.getObjectByName('model-transform-'+m.id))
        if(!free)throw Error('No loaded free model')
        async function measure(label,change,ready){const start=performance.now();change();await new Promise(resolve=>{function frame(){if(ready()||performance.now()-start>8000)resolve();else requestAnimationFrame(frame)}requestAnimationFrame(frame)});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {label,ms:performance.now()-start,registered:ready()}}
        const object=s.scene.getObjectByName('model-transform-'+free.m.id),before=object.position.x
        const move=await measure('move object',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,models:f.models.map(m=>m.id===free.m.id?{...m,position:{...m.position,x:m.position.x+25}}:m)}))),()=>s.scene.getObjectByName('model-transform-'+free.m.id)?.position.x!==before)
        const addId='gi-regression-added-object'
        const add=await measure('add object',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>f.id===free.f.id?{...f,models:[...f.models,{...free.m,id:addId,position:{...free.m.position,x:free.m.position.x+50}}]}:f)),()=>!!s.scene.getObjectByName('model-transform-'+addId))
        const door=candidates.find(({m})=>m.wallAttachment&&s.scene.getObjectByName('model-transform-'+m.id)),doorId='gi-regression-added-door'
        let doorTiming
        if(door)doorTiming=await measure('add door',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>f.id===door.f.id?{...f,models:[...f.models,{...door.m,id:doorId,wallAttachment:{...door.m.wallAttachment,offset:door.m.wallAttachment.offset+120}}]}:f)),()=>!!s.scene.getObjectByName('model-transform-'+doorId))
        return [move,add,...(doorTiming?[doorTiming]:[])]
      })()`)
      console.log('GI background editing timings',JSON.stringify(timings))
      if(process.argv.includes('--profile')){
        const {profile}=await call('Profiler.stop')
        const samples=new Map();profile.samples.forEach((id,i)=>samples.set(id,(samples.get(id)??0)+(profile.timeDeltas[i]??0)))
        console.log('Edit main-thread profile',JSON.stringify([...samples].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,time])=>({ms:time/1000,...profile.nodes.find(node=>node.id===id)?.callFrame}))))
      }
      assert.ok(timings.length===3,'exercise movement, a new object, and a wall-attached model')
      for(const result of timings){assert.ok(result.registered,result.label+' registers');assert.ok(result.ms<3000,result.label+' is not held behind GI work')}
      assert.deepEqual(errors,[]);console.log('GI editing responsiveness regression passed');ws.close();child.kill();process.exit(0)
    }
    if(process.argv.includes('--lamp-corner') && !lampInspected && status?.completed > 0) {
      lampInspected = true
      const savedView=await evaluate(`(()=>{const s=${state};return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),target:s.controls?.target?.toArray()}})()`)
      await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
      await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby walls')){const input=label.querySelector('input');if(input.checked)input.click()}})()`);await pause(200)
      await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
      await evaluate(`(()=>{const s=${state};s.camera.position.set(3.55,4.2,11.4);s.camera.lookAt(4.18,4.35,10.16);s.controls?.target?.set(4.18,4.35,10.16);s.camera.updateMatrixWorld();s.setDpr(window.regressionPreviewDpr??1);s.invalidate()})()`)
      await pause(2500)
      writeFileSync('.tmp-indirect-lamp-corner.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
      assert.deepEqual(errors,[]);console.log('Lamp corner diagnostic passed')
      if(!process.argv.includes('--keep-baking')){ws.close();child.kill();process.exit(0)}
      await evaluate(`(()=>{const s=${state},v=${JSON.stringify(savedView)};s.camera.position.fromArray(v.position);s.camera.quaternion.fromArray(v.quaternion);if(v.target)s.controls?.target?.fromArray(v.target);s.camera.updateMatrixWorld();s.setDpr(.5);s.invalidate()})()`)
    }
    if(corners && i===40 && !process.argv.includes('--shadow-diagnostic')) {
      writeFileSync('.tmp-indirect-corner-live.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    }
    if(corners && process.argv.includes('--shadow-diagnostic') && i===40) {
      console.log('Lights',JSON.stringify(await evaluate(`(()=>{const s=${state},lights=[];s.scene.traverse(o=>{if(o.isLight&&o.shadow)lights.push({type:o.type,position:o.position.toArray(),intensity:o.intensity,shadow:o.castShadow,bias:o.shadow.bias,normalBias:o.shadow.normalBias})});return lights})()`)))
      for(const [name,normalBias,localShadow,sunShadow] of [['default',.1,1,1],['small-bias',.015,1,1],['zero-bias',0,1,1],['no-local',.1,0,1],['no-sun',.1,1,0]]) {
        await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{if(o.shadow){o.shadow.intensity=o.isDirectionalLight?${sunShadow}:${localShadow};if(!o.isDirectionalLight)o.shadow.normalBias=${normalBias};o.shadow.needsUpdate=true}});s.gl.shadowMap.needsUpdate=true;s.invalidate()})()`)
        await pause(1200)
        writeFileSync('.tmp-indirect-shadow-'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
      }
      for(const [name,sun,local,unoccluded] of [['sun-off',0,1,false],['local-off',1,0,false],['local-unoccluded',0,1,true]]) {
        await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{if(o.isLight&&o.shadow){o.shadow.intensity=1;o.userData.originalIntensity??=o.intensity;o.intensity=o.userData.originalIntensity*(o.isDirectionalLight?${sun}:${local})}if(${unoccluded})for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIDistances){const t=u.hdGIDistances.value,d=t.image.data;if(!t.userData.diagnostic){d.fill(0);t.needsUpdate=true;t.userData.diagnostic=true}}}});s.invalidate()})()`)
        await pause(1200)
        writeFileSync('.tmp-indirect-shadow-'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
      }
      console.log('Shadow errors',errors);assert.deepEqual(errors,[]);ws.close();child.kill();process.exit(0)
    }
    if (quick && process.argv.includes('--gi-only') && status?.completed > 0) break
    if(quick && !process.argv.includes('--gi-only') && i===60){
      console.log('Diagnostic',JSON.stringify(status))
      console.log('Scene visibility',JSON.stringify(await evaluate(`(()=>{const s=${state};let total=0,visible=0,standard=0,standardVisible=0;const roles={},walls=[];s.scene.traverse(o=>{if(!o.isMesh)return;total++;if(o.visible)visible++;const m=Array.isArray(o.material)?o.material:[o.material];if(m.some(m=>m.isMeshStandardMaterial)){standard++;if(o.visible&&m.some(m=>m.visible))standardVisible++}const role=o.userData.houseDesignerRole??'';roles[role]??={visible:0,hidden:0};roles[role][o.visible?'visible':'hidden']++;if(role==='wall-engine-render')walls.push({bounds:o.geometry.boundingBox,matrix:o.matrixWorld.elements,materials:m.map(m=>({visible:m.visible,opacity:m.opacity,transparent:m.transparent,colorWrite:m.colorWrite}))})});const ext=s.gl.getContext().getExtension('WEBGL_debug_renderer_info');return {total,visible,standard,standardVisible,roles,walls,override:s.scene.overrideMaterial?.type,renderer:ext?s.gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):''}})()`)))
      assert.deepEqual(errors,[]);ws.close();child.kill();process.exit(0)
    }
    if(interior && i===40){
      await evaluate(`(()=>{const s=${state};window.updateRegressionActiveFloor(window.regressionFloors[1].id);s.camera.position.set(10.1,4.15,7.5);s.camera.lookAt(10.15,4.1,5.92);if(s.controls?.target)s.controls.target.set(10.15,4.1,5.92);s.camera.updateMatrixWorld();s.invalidate()})()`)
      await pause(1200)
      writeFileSync('.tmp-indirect-springfield-start.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    }
    if(status?.state==='ready' && status.rooms > 0 && i > 40)break
  }
  let result=await evaluate(`${state}.scene.userData.indirectLighting`)
  console.log('GI result',JSON.stringify(result));
  assert.deepEqual(errors,[])
  if (!(quick && process.argv.includes('--gi-only'))) assert.equal(result.state,'ready')
  if(previewReduced) {
    await evaluate(`(()=>{const s=${state};s.setDpr(window.regressionPreviewDpr);s.invalidate()})()`)
    await pause(1500)
  }
  if (!editor && !house && process.argv.includes('--updates')) {
    const before = await evaluate(`(()=>{const s=${state};let result;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIUseVolume?.value===1)result={texture:u.hdGIVolume.value.uuid,enabled:u.hdGIUseVolume.value}}});return {...result,builds:s.scene.userData.indirectLighting.geometryBuilds}})()`)
    assert.ok(before.texture, 'a completed GI volume is displayed before editing')
    for(let i=0;i<6;i++){await evaluate('window.changeLighting()');await pause(60)}
    await pause(750)
    const during = await evaluate(`(()=>{const s=${state};let result;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIUseVolume)result={texture:u.hdGIVolume.value.uuid,enabled:u.hdGIUseVolume.value}}});return {...result,builds:s.scene.userData.indirectLighting.geometryBuilds}})()`)
    assert.equal(during.enabled,1,'sun updates never switch off the displayed GI volume')
    assert.equal(during.texture,before.texture,'the completed display cache survives repeated lighting changes')
    assert.equal(during.builds,before.builds,'sun updates reuse worker geometry and visibility')
    for(let i=0;i<1200;i++){await pause(100);if(await evaluate(`${state}.scene.userData.indirectLighting.state==='ready'`))break}
    assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.state`),'ready','the replacement lighting completes')
    console.log('Worker sun-update continuity and geometry reuse passed',before,during)
    assert.deepEqual(errors,[]);ws.close();child.kill();process.exit(0)
  }
  if (editor && process.argv.includes('--sun-rebake')) {
    await evaluate(`window.updateRegressionSunPosition({...window.regressionSunPosition,azimuth:window.regressionSunPosition.azimuth+.25})`)
    await pause(1000)
    assert.ok(await evaluate(`${state}.scene.userData.indirectLighting.generation`) > result.generation, 'moving the sun starts a new bake')
    for(let i=0;i<1440;i++) {
      await pause(250)
      const next=await evaluate(`${state}.scene.userData.indirectLighting`)
      if(i%80===0)console.log('Sun rebake',JSON.stringify({completed:next.completed,total:next.total,state:next.state}))
      if(next.state==='ready') { result=next;break }
    }
    assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.state`),'ready','sun update settles')
  }
  if(interior){
    await pause(1500)
    writeFileSync('.tmp-indirect-springfield-interior.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    const benchmark = await evaluate(`(async()=>{const s=${state};let u;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const candidate=m&&s.gl.properties.get(m).uniforms;if(candidate?.hdGIEnabled)u=candidate}});if(!u?.hdGIUseVolume?.value)throw Error('Cached lighting volume is not ready');async function sample(enabled){u.hdGIEnabled.value=enabled;return await new Promise(resolve=>{const times=[];let previous=performance.now();function frame(now){s.invalidate();times.push(now-previous);previous=now;if(times.length===100){const sorted=times.slice(10).sort((a,b)=>a-b);resolve({mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95:sorted[Math.floor(sorted.length*.95)]});}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})}const cached=await sample(1),baseline=await sample(0);u.hdGIEnabled.value=1;s.invalidate();return {cached,baseline}})()`)
    console.log('Interior frame intervals',JSON.stringify(benchmark))
    assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.generation`),result.generation,'display benchmark reuses the settled cache')
    await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled)u.hdGIEnabled.value=0}});s.invalidate()})()`);await pause(750)
    writeFileSync('.tmp-indirect-springfield-no-gi.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
    await evaluate(`[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Ambient occlusion').querySelector('input').click()`);await pause(1200)
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
    writeFileSync('.tmp-indirect-springfield-no-gi-no-ao.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    console.log('Interior errors',errors)
    ws.close();child.kill();process.exit(0)
  }
  if (editor && process.argv.includes('--gi-only')) {
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`); await pause(200)
    await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby walls')){const input=label.querySelector('input');if(input.checked)input.click()}})()`)
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await evaluate(`(()=>{const s=${state};s.camera.fov=95;s.camera.updateProjectionMatrix();s.invalidate()})()`)
    await pause(1500)
    const capture = async name => {
      const png = Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')
      writeFileSync(`.tmp-indirect-gi-only-${name}.png`, png)
      const {width,height} = await sharp(png).metadata()
      return sharp(png).extract({left:0,top:0,width,height:Math.floor(height*.7)}).removeAlpha().raw().toBuffer()
    }
    const original = await capture('lit')
    // Mutating capture-only lamp references must not change displayed lighting.
    await evaluate(`(()=>{const s=${state},seen=new Set();s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms,t=u?.hdGIDistances?.value;if(t&&!seen.has(t)){seen.add(t);t.image.data.fill(0);t.needsUpdate=true}}});s.invalidate()})()`)
    await pause(1500)
    const cleared = await capture('cache-cleared')
    let delta=0;for(let i=0;i<original.length;i++)delta+=Math.abs(original[i]-cleared[i])
    const meanDelta=delta/original.length
    console.log('GI-only displayed lamp-cache delta',meanDelta)
    assert.ok(meanDelta < .05, 'capture-only lamp visibility cannot cast displayed direct shadows')
    const localShadows = () => evaluate(`(()=>{const lights=[];${state}.scene.traverse(o=>{if((o.isPointLight||o.isSpotLight)&&o.intensity>0)lights.push({enabled:o.castShadow,allocated:!!o.shadow?.map})});return lights})()`)
    assert.ok((await localShadows()).every(light=>!light.enabled), 'local shadow maps are disabled with Light shadows off')
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`); await pause(200)
    await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(!input.checked)input.click()})()`)
    await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    let lights=[]
    for(let i=0;i<120;i++) {
      await pause(500);lights=await localShadows()
      if(lights.some(light=>light.enabled&&light.allocated))break
    }
    assert.ok(lights.some(light=>light.enabled&&light.allocated), 'Light shadows enables actual renderer shadow maps')
    await capture('light-shadows')
    assert.deepEqual(errors,[]);console.log('GI-only / explicit light shadows regression passed')
    ws.close();child.kill();process.exit(0)
  }
  const assertTransparentPrograms = async () => {
    const checked = await evaluate(`(()=>{const s=${state}, context=s.gl.getContext(), seen=new Set(), broken=[];let helpers=0;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m||seen.has(m))continue;seen.add(m);if(m.transparent&&m.opacity===0){const p=s.gl.properties.get(m).currentProgram;if(p){helpers++;if(context.getShaderSource(p.fragmentShader).includes('#define OPAQUE'))broken.push(m.id)}}}});return {helpers,broken}})()`)
    assert.ok(checked.helpers > 0, 'transparent editor picking helpers were rendered')
    assert.deepEqual(checked.broken, [], 'offscreen captures never compile invisible helpers with OPAQUE')
    console.log('Transparent helper programs', checked.helpers)
  }
  if(editor){
    if(process.argv.includes('--artefacts') || corners) {
      // Interior inspections need solid walls; the editor's proximity fade
      // otherwise reveals the lit room behind the very partition under test.
      await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
      await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby walls')){const input=label.querySelector('input');if(input.checked)input.click()}})()`);await pause(500)
      await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
      const tag = process.argv.find(arg=>arg.startsWith('--tag='))?.split('=')[1] ?? 'diagnostic'
      for (const [view,position,target] of corners ? [['saved',null,null],['bedroom-corner',[1.6,4.15,12.3],[3.02,4.1,10.31]],['corridor',[3.65,4.25,13.5],[3.65,4.25,10.16]],['hall-corner',[3.55,4.2,11.4],[4.18,4.35,10.16]]] : [ ['roof',[19,11,24],[7,5,12]], ['wall',[4.75,4.5,12.3],[6.37,4.5,13.32]],
        ['landing',[3.6,4.25,11.9],[4.23,4.1,12.948]], ['landing-back',[3.5,4.25,12],[4.25,4.1,10.87]],
        ['landing-front',[3.6,4.25,14],[3.07,4.1,15.05]] ]) {
        if(position) await evaluate(`(()=>{const s=${state};s.camera.position.set(...${JSON.stringify(position)});s.camera.lookAt(...${JSON.stringify(target)});s.controls?.target?.set(...${JSON.stringify(target)});s.camera.updateMatrixWorld();s.invalidate()})()`)
        for (const mode of ['gi','no-volume','no-local','no-gi','no-shadows']) {
          await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{if(o.isMesh){if(o.userData.originalReceiveShadow===undefined)o.userData.originalReceiveShadow=o.receiveShadow;o.receiveShadow=${mode!=='no-shadows'}&&o.userData.originalReceiveShadow}for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled)u.hdGIEnabled.value=${mode==='no-gi'?0:1}}});s.invalidate()})()`)
          await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{if(o.isPointLight||o.isSpotLight){o.userData.diagnosticIntensity??=o.intensity;o.intensity=${mode==='no-local'?0:1}*o.userData.diagnosticIntensity}for(const m of Array.isArray(o.material)?o.material:[o.material]){const u=m&&s.gl.properties.get(m).uniforms;if(u?.hdGIUseVolume)u.hdGIUseVolume.value=${mode==='no-volume'?0:1}}});s.invalidate()})()`)
          await pause(1500)
          writeFileSync(`.tmp-indirect-${tag}-${view}-${mode}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
        }
        if(corners) {
          await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
          const aoEnabled = await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Ambient occlusion').querySelector('input');const enabled=input.checked;if(enabled)input.click();return enabled})()`);await pause(1200)
          await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
          writeFileSync(`.tmp-indirect-${tag}-${view}-no-shadows-no-ao.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
          if(aoEnabled) {
            await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`);await pause(200)
            await evaluate(`[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Ambient occlusion').querySelector('input').click()`);await pause(200)
            await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
          }
        }
      }
      await evaluate(`(()=>{const s=${state};s.scene.traverse(o=>{if(o.isMesh&&o.userData.originalReceiveShadow!==undefined)o.receiveShadow=o.userData.originalReceiveShadow});s.invalidate()})()`)
      await pause(3000)
      const timings=await evaluate(`(async()=>{const s=${state};return await new Promise(resolve=>{const times=[];let previous=performance.now();function frame(now){s.invalidate();times.push(now-previous);previous=now;if(times.length===120){const sorted=times.slice(20).sort((a,b)=>a-b);resolve({meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)]});}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})})()`)
      console.log('Settled frame intervals',JSON.stringify(timings))
      assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.capturedFaces`),result.capturedFaces,'comparison views reuse the cache')
      console.log('Artifact comparison errors',JSON.stringify(errors));assert.deepEqual(errors,[])
      ws.close();child.kill();process.exit(0)
    }
    await evaluate(`(()=>{const s=${state}; s.camera.position.set(28,18,38);s.camera.lookAt(6,3,8);if(s.controls?.target)s.controls.target.set(6,3,8);s.camera.updateMatrixWorld();s.invalidate()})()`)
    await pause(1200)
    writeFileSync('.tmp-indirect-editor.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    await assertTransparentPrograms()
    const exterior = await sharp('.tmp-indirect-editor.png').raw().toBuffer({resolveWithObject:true})
    let black=0
    for(let i=0;i<exterior.data.length;i+=exterior.info.channels)if(exterior.data[i]<=1&&exterior.data[i+1]<=1&&exterior.data[i+2]<=1)black++
    const fraction=black/(exterior.info.width*exterior.info.height)
    console.log('Exterior black pixel fraction',fraction)
    assert.ok(fraction<.005,'no large black picking planes cover the exterior')
    if(project==='colin'){
      await evaluate(`(()=>{const s=${state};s.camera.position.set(4.75,4.5,12.3);s.camera.lookAt(6.37,4.95,13.32);if(s.controls?.target)s.controls.target.set(6.37,4.95,13.32);s.camera.updateMatrixWorld();s.invalidate()})()`);await pause(1200)
      writeFileSync('.tmp-indirect-editor-ceiling.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
      const ceiling = await sharp('.tmp-indirect-editor-ceiling.png').extract({left:500,top:100,width:600,height:300}).stats()
      assert.ok(ceiling.channels.slice(0,3).every(channel=>channel.mean>20),'interior ceiling remains visible after the bake')
    }
    assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.generation`),result.generation,'editor camera movement retains the settled cache')
    assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.capturedFaces`),result.capturedFaces,'settled editor performs no extra captures')
    assert.deepEqual(errors,[])
    console.log('Editor lighting regression passed')
    ws.close();child.kill()
    process.exit(0)
  }
  assert.deepEqual(errors,[])
  assert.equal(result.state,'ready')
  if(!house){
    await assertTransparentPrograms()
    assert.equal(result.rooms,2)
    if(!open)assert.ok(result.roomMean[1][0] > result.roomMean[2][0]*2+.03,'window room receives more daylight than sealed room')
    if(localMode)assert.ok(result.roomMean[1][0]>result.roomMean[1][1]*2,'cached local light retains its colour despite the main renderer selecting another floor')
  }
  const generation=result.generation
  await evaluate(`${state}.camera.position.x+=.2`);await pause(750)
  assert.equal(await evaluate(`${state}.scene.userData.indirectLighting.generation`),generation,'camera movement reuses the cache')
  if(house){
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Fly').click()`);await pause(750)
    console.log('After fly',await evaluate(`${state}.scene.userData.indirectLighting`))
    await evaluate(`(()=>{const s=${state};s.camera.position.set(4.75,4.5,12.3);s.camera.lookAt(6.37,4.15,13.32);s.camera.updateMatrixWorld()})()`);await pause(750)
    writeFileSync('.tmp-indirect-house-after.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    const benchmark=await evaluate(`(async()=>{const s=${state};let uniforms;s.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m&&s.gl.properties.get(m).uniforms?.hdGIEnabled)uniforms=s.gl.properties.get(m).uniforms}});if(!uniforms)throw Error('Missing GI uniforms');window.indirectUniforms=uniforms;const ext=s.gl.getContext().getExtension('WEBGL_debug_renderer_info');const renderer=ext?s.gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';async function sample(enabled){uniforms.hdGIEnabled.value=enabled;await new Promise(r=>setTimeout(r,300));return await new Promise(resolve=>{const times=[];let previous=performance.now();function frame(now){times.push(now-previous);previous=now;if(times.length===180){const sorted=times.slice(10).sort((a,b)=>a-b);resolve({mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95:sorted[Math.floor(sorted.length*.95)]});}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})}const cached=await sample(1),baseline=await sample(0);uniforms.hdGIEnabled.value=1;return {renderer,cached,baseline}})()`)
    console.log('Frame benchmark',JSON.stringify(benchmark))
    await evaluate('window.indirectUniforms.hdGIEnabled.value=0');await pause(400)
    writeFileSync('.tmp-indirect-house-before.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    await evaluate('window.indirectUniforms.hdGIEnabled.value=1')
    const finalStatus=await evaluate(`${state}.scene.userData.indirectLighting`)
    console.log('Final cache',JSON.stringify(finalStatus))
    assert.equal(finalStatus.completed,result.completed,'settled cache performs no more captures')
    assert.equal(await evaluate('window.viewerHouseUnchanged()'),true)
  }else{
  writeFileSync('.tmp-indirect-fixture.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  if(open){
    const points = await evaluate(`(()=>{const s=${state}, rect=s.gl.domElement.getBoundingClientRect();return [3.98,4.02].map(x=>{const p=s.camera.position.clone().set(x,1.5,2.026).project(s.camera);return {x:Math.round(rect.left+(p.x+1)*rect.width/2),y:Math.round(rect.top+(1-p.y)*rect.height/2)}})})()`)
    const samples = await Promise.all(points.map(p=>sharp('.tmp-indirect-fixture.png').extract({left:p.x-2,top:p.y-2,width:5,height:5}).stats()))
    const seam = Math.max(...samples[0].channels.slice(0,3).map((c,i)=>Math.abs(c.mean-samples[1].channels[i].mean)))
    console.log('Open doorway finish seam',seam)
    assert.ok(seam<8,'one finish changes smoothly across room labels inside an opening')
    assert.ok(result.roomMean[2][0]>.03,'the neighbouring room receives coloured bounced light through the opening')
  }
  await evaluate('window.toggleAO()');await pause(1000)
  writeFileSync('.tmp-indirect-fixture-ao.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  const images=await Promise.all(['.tmp-indirect-fixture.png','.tmp-indirect-fixture-ao.png'].map(path=>sharp(path).raw().toBuffer({resolveWithObject:true})))
  let difference=0,count=0
  for(let y=120;y<450;y++)for(let x=90;x<200;x++)for(let c=0;c<3;c++){
    difference+=Math.abs(images[0].data[(y*images[0].info.width+x)*images[0].info.channels+c]-images[1].data[(y*images[1].info.width+x)*images[1].info.channels+c]);count++
  }
  assert.ok(difference/count<1,'AO with zero strength preserves material colours and tone mapping')
  console.log('AO material pixel difference',difference/count)
  assert.equal(await evaluate('window.lightingState().scene.userData.indirectLighting.generation'),generation,'AO toggle reuses the cache')
  await evaluate('window.changeLighting()');await pause(750)
  assert.ok(await evaluate('window.lightingState().scene.userData.indirectLighting.generation')>generation,'light changes invalidate the cache')
  }
  console.log('Indirect lighting regression passed')
}finally{ws?.close();child.kill()}
