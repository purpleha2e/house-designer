// With Vite running: node tests/browser/roomLightShadowsRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

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
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?lighting-startup&live-gi` })
  await until('window.roofWallScene?.()?.scene.userData.indirectLighting?.state === "ready"', 'initial scene')
  await evaluate(`window.updateRegressionFloors(window.regressionFloors.map(f=>({...f,
    walls:f.walls.map(w=>w.id==='sealed-partition'?{...w,openings:[{id:'door',modelId:'door',center:2,width:1.5,bottom:0,height:2.1}]}:w)})))`)
  await until('window.roofWallScene().scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'open doorway scene')
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  const set = async (label, value) => {
    await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)})?.querySelector('input');if(!input)throw Error('Missing control '+${JSON.stringify(label)});if(input.checked!==${value})input.click()})()`)
    await pause(400)
  }
  await set('Daylight', false)
  await set('Light shadows', false)
  await evaluate(`(async()=>{
    const {OrthographicCamera,WebGLRenderTarget,Vector3,Raycaster,Mesh,BoxGeometry,MeshStandardMaterial}=await import('/node_modules/.vite/deps/three.js');
    const s=window.roofWallScene(),camera=new OrthographicCamera(-1.8,1.8,1.8,-1.8,.01,10);
    camera.position.set(6,2.3,2);camera.lookAt(6,0,2);camera.updateMatrixWorld();
    const target=new WebGLRenderTarget(512,512),blocker=new Mesh(new BoxGeometry(.35,1.2,.5),new MeshStandardMaterial());
    blocker.position.set(5.5,.6,2);blocker.castShadow=true;blocker.receiveShadow=true;blocker.visible=false;s.scene.add(blocker);
    window.roomShadowProbe={camera,target,blocker};
    window.sampleRoomShadows=()=>{
      const {scene,gl}=s;scene.updateMatrixWorld(true);let mask;
      scene.traverse(o=>{if(o.isLight){if(!o.isPointLight&&!o.isSpotLight)o.intensity=0;if(o.shadow)o.shadow.needsUpdate=true}
        if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){
          const u=gl.properties.get(m).uniforms;if(u?.hdGIIndoorFill)u.hdGIIndoorFill.value=0;if(u?.hdGIProbeStrength)u.hdGIProbeStrength.value=0;
          if(u?.hdRoomLightEnabled)mask=u.hdRoomLightEnabled.value;
        }});
      gl.setRenderTarget(target);gl.render(scene,camera);
      const meshes=[];scene.traverse(o=>{if(o.isMesh&&o.visible)meshes.push(o)});
      const ray=new Raycaster(),pixels=[];
      for(const [x,z] of window.roomShadowPoints??[[5.15,2],[5.15,.35],[6.65,2]]){
        ray.set(new Vector3(x,2.2,z),new Vector3(0,-1,0));const hit=ray.intersectObjects(meshes,false).find(h=>{for(let o=h.object;o;o=o.parent)if(!o.visible)return false;return true});
        const p=hit.point.clone().project(camera),pixel=new Uint8Array(4);gl.readRenderTargetPixels(target,Math.floor((p.x+1)*256),Math.floor((p.y+1)*256),1,1,pixel);
        pixels.push({rgb:[...pixel.slice(0,3)],point:hit.point.toArray(),role:hit.object.userData.houseDesignerRole});
      }
      gl.setRenderTarget(null);return{mask,pixels,shadows:scene.children.filter(o=>o.isPointLight&&o.power>0).map(o=>({cast:o.castShadow,map:!!o.shadow.map}))};
    };
  })()`)
  const roomOnly = await evaluate('window.sampleRoomShadows()')
  await set('Light shadows', true)
  await until('window.roofWallScene().scene.children.some(o=>o.isPointLight&&o.power>0&&o.castShadow&&o.shadow.map)', 'local shadow map')
  const crossRoom = await evaluate('window.sampleRoomShadows()')
  await evaluate('window.roomShadowProbe.blocker.visible=true')
  const shadowed = await evaluate('window.sampleRoomShadows()')
  await evaluate('window.roomShadowProbe.blocker.castShadow=false')
  const unshadowed = await evaluate('window.sampleRoomShadows()')
  // A thin low caster exposes detached contact shadows that the broad box
  // cannot detect. Two lights illuminate its surrounding floor.
  await evaluate(`(async()=>{const {PointLight}=await import('/node_modules/.vite/deps/three.js');const {LOCAL_LIGHT_SHADOW_BIAS,LOCAL_LIGHT_SHADOW_NORMAL_BIAS,LOCAL_LIGHT_SHADOW_RADIUS}=await import('/src/lightShadowResources.ts');const {blocker}=window.roomShadowProbe;
    blocker.scale.set(.1,1/6,1.6);blocker.position.y=.112;blocker.castShadow=true;
    const light=new PointLight('white',.5,12,2);light.position.set(6.5,1.8,3.4);light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);light.shadow.bias=LOCAL_LIGHT_SHADOW_BIAS;light.shadow.normalBias=LOCAL_LIGHT_SHADOW_NORMAL_BIAS;light.shadow.radius=LOCAL_LIGHT_SHADOW_RADIUS;
    window.roofWallScene().scene.add(light);window.roomShadowProbe.secondLight=light;
    window.roomShadowPoints=Array.from({length:14},(_,i)=>[5.5225+i*.01,2]);})()`)
  await pause(500)
  const contactFixed = await evaluate('window.sampleRoomShadows()')
  await evaluate(`window.roofWallScene().scene.traverse(o=>{if(o.isPointLight){o.userData.contactShadowSettings=[o.shadow.bias,o.shadow.normalBias,o.shadow.radius];o.shadow.bias=-.0008;o.shadow.normalBias=.1;o.shadow.radius=2}})`)
  const contactLegacy = await evaluate('window.sampleRoomShadows()')
  await evaluate(`window.roofWallScene().scene.traverse(o=>{if(o.isPointLight)[o.shadow.bias,o.shadow.normalBias,o.shadow.radius]=o.userData.contactShadowSettings})`)
  await evaluate(`window.roomShadowProbe.blocker.castShadow=false`)
  const contactReference = await evaluate('window.sampleRoomShadows()')
  console.log('CONTACT',JSON.stringify({contactLegacy,contactFixed,contactReference}))
  await evaluate('window.roomShadowPoints=[[5.15,2],[6.2,2.9],[7.2,2.8]]')
  const clearFloor = await evaluate('window.sampleRoomShadows()')
  await evaluate(`window.contactCasters=[];window.roofWallScene().scene.traverse(o=>{if(o.isMesh&&o.castShadow){window.contactCasters.push(o);o.castShadow=false}})`)
  const clearReference = await evaluate('window.sampleRoomShadows()')
  await evaluate('window.contactCasters.forEach(o=>o.castShadow=true)')
  console.log('CLEAR_FLOOR',JSON.stringify({clearFloor,clearReference}))
  await evaluate('window.roofWallScene().scene.remove(window.roomShadowProbe.secondLight);window.roomShadowPoints=null')
  await set('Shadows', false)
  const globalOff = await evaluate('window.sampleRoomShadows()')
  await set('Shadows', true)
  await set('Light shadows', false)
  const restored = await evaluate('window.sampleRoomShadows()')
  console.log(JSON.stringify({ roomOnly, crossRoom, shadowed, unshadowed, globalOff, restored }))
  const brightness = sample => sample.rgb.reduce((sum, value) => sum + value, 0) / 3
  assert.ok(brightness(contactLegacy.pixels[0]) > brightness(contactReference.pixels[0]) * .9,
    'old bias reproduces a fully lit gap beside the thin caster')
  for (const [index,pixel] of contactFixed.pixels.entries()) assert.ok(brightness(pixel) < brightness(contactReference.pixels[0]) * (index===0?.4:.25),
    'thin contact shadow stays connected with both lights active')
  clearFloor.pixels.forEach((pixel,i)=>assert.ok(brightness(pixel) >= brightness(clearReference.pixels[i]) * .9,
    'millimetre bias does not add false shadows to unobstructed floor'))
  assert.equal(roomOnly.mask, 1)
  assert.equal(crossRoom.mask, 0, 'local shadows replace the room restriction')
  assert.ok(brightness(crossRoom.pixels[0]) > brightness(roomOnly.pixels[0]) + 15, 'direct light crosses the open doorway')
  assert.ok(brightness(crossRoom.pixels[1]) < brightness(crossRoom.pixels[0]) * .25, 'solid partition still blocks direct light')
  assert.ok(brightness(unshadowed.pixels[2]) > brightness(shadowed.pixels[2]) + 15, 'object in neighbouring room casts a shadow')
  assert.equal(globalOff.mask, 1, 'disabling all shadows restores wall protection')
  assert.equal(restored.mask, 1, 'disabling local shadows restores the room mask')
  // Move the camera downstairs while the editing floor (and its lamps) stays
  // upstairs. The slab's camera-hidden visual cap still has to block them.
  await evaluate(`(()=>{const f=window.regressionFloors[0];window.updateRegressionFloors([
    {...f,models:[]},{...f,id:'upper-shadow-test',name:'Upper',elevation:2.7,
      walls:f.walls.map(w=>({...w,id:'upper-'+w.id})),models:f.models.map(m=>({...m,id:'upper-lamp'}))}
  ]);window.updateRegressionActiveFloor('upper-shadow-test');})()`)
  await set('Light shadows',true)
  await pause(500)
  await until(`window.regressionFloors.length===2&&window.roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!window.roofWallScene().scene.userData.shaderWarmupPending`,'stacked floors')
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(6,1.6,2);s.camera.lookAt(4,1.2,2);s.camera.updateMatrixWorld();s.invalidate();})()`)
  await pause(500)
  const below = await evaluate(`(()=>{const s=window.roofWallScene();const slabs=[],caps=[];s.scene.traverse(o=>{
    if(o.userData.houseDesignerRole==='ceiling-slab-solid')slabs.push({capVisible:o.material[0].visible});
    if(o.userData.houseDesignerRole==='slab-shadow-cap')caps.push(o);
  });window.testSlabCaps=caps;return{slabs,caps:caps.length,light:s.scene.children.find(o=>o.isPointLight&&o.power>0)?.position.toArray()}})()`)
  assert.ok(below.caps>0,'solid slab has independent shadow geometry')
  assert.ok(below.slabs.some(s=>!s.capVisible),'downstairs camera hides the visual top cap')
  assert.ok(below.light[1]>4,'the active lamp remains upstairs')
  const downstairsBlocked=await evaluate('window.sampleRoomShadows()')
  await evaluate('window.testSlabCaps.forEach(o=>o.visible=false)')
  const downstairsLegacy=await evaluate('window.sampleRoomShadows()')
  await evaluate('window.testSlabCaps.forEach(o=>o.visible=true)')
  console.log('DOWNSTAIRS',JSON.stringify({below,downstairsBlocked,downstairsLegacy}))
  assert.ok(brightness(downstairsLegacy.pixels[0])>brightness(downstairsBlocked.pixels[0])+15,'reproduce upstairs light leaking without the shadow cap')
  assert.ok(brightness(downstairsBlocked.pixels[0])<3,'solid slab blocks the upstairs lamp from downstairs')
  assert.deepEqual(errors, [])
  console.log('Cross-room local shadows regression passed')
} finally { ws?.close(); child.kill() }
