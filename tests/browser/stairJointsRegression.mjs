// Vite and asset portal running: node tests/browser/stairJointsRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1050',
  `--user-data-dir=${createBrowserTestProfile('stair-joints-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (p) { pending.delete(r.id); r.error ? p.reject(r.error) : p.resolve(r.result) }
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') {
      const value = r.params.args.map(a => a.value ?? a.description).join(' ')
      if (!/WebGL context|404|Failed to load resource/.test(value)) errors.push(value)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async expression => {
    const start = Date.now()
    while (Date.now() - start < 90000) { if (await evaluate(expression)) return; if (errors.length) throw Error(JSON.stringify(errors)); await pause(150) }
    const diagnostics = await evaluate(`(()=>{const s=window.roofCreateScene?.(),names=[],roles={};s?.traverse(o=>{if(o.name.startsWith('model-transform'))names.push(o.name);const r=o.userData.houseDesignerRole;if(r)roles[r]=(roles[r]??0)+1});return{names,roles,reveals:window.jointReport?.(),body:document.body.innerText.slice(-1500)}})()`)
    throw Error(`Timed out: ${expression}: ${JSON.stringify(diagnostics)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/roofCreatePreviewRegression.html?basic-scene&pbr-materials` })
  await until(`!!window.roofCreateScene?.() && !!document.querySelector('[aria-label="Project menu"]')`)
  await evaluate(`(async()=>{
    const {createStairDesign}=await import('/src/stairDesign.ts'),{stairDefinition}=await import('/src/stairLibrary.ts');
    const d={...createStairDesign(2.9),layout:'u',turn:'right',landingSteps:3,riserCount:17,stepsBeforeTurn:7,handrailWidth:.075,postWidth:.075};
    const polygon=[[-3,-3],[3,-3],[3,3],[-3,3]];
    const floor=(id,elevation)=>({id,name:id,elevation,roomHeight:2.7,slabThickness:.2,rooms:[],roofs:[],models:[],
      walls:polygon.map(([x,y],i)=>({id:id+'-wall-'+i,kind:'external',height:2.7,thickness:.2,start:{x,y},end:{x:polygon[(i+1)%4][0],y:polygon[(i+1)%4][1]}}))});
    const ground=floor('ground',0),upper=floor('upper',2.9);ground.models=[{id:'joint-stair',modelId:'joint-design',position:{x:0,y:0},rotation:0,scale:1}];
    window.fixture={activeFloorId:'upper',wallKind:'external',threeDView:{floorViewId:'all'},floors:[ground,upper],modelDefinitions:[stairDefinition('joint-design','Joint regression stairs',d)]};
    window.alert=message=>{throw Error(message)};window.showOpenFilePicker=async()=>[{getFile:async()=>new File([JSON.stringify(fixture)],'joints.house.json')}];
    const {Box3,AmbientLight}=await import('/node_modules/.vite/deps/three.js'),{getStairSlabOpenings}=await import('/src/stairSlabOpenings.ts'),{pointIsInsideRoomPolygon}=await import('/src/roomLightMask.ts');
    window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async text=>{window.savedJoints=JSON.parse(text)},close:async()=>{}})});
    window.skirtOverVoid=()=>{let count=0,total=0;const openings=getStairSlabOpenings(fixture.floors[0],fixture.floors[1],fixture.floors,new Map(fixture.modelDefinitions.map(d=>[d.id,d])));roofCreateScene().updateMatrixWorld(true);roofCreateScene().traverse(o=>{if(o.userData.houseDesignerRole!=='skirting')return;const p=o.geometry.getAttribute('position'),v=new Box3().setFromObject(o);if(v.min.y<2.8)return;total++;for(let i=0;i<p.count;i+=3){const a=new (v.min.constructor)();for(let j=0;j<3;j++)a.add(new (v.min.constructor)().fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld));a.multiplyScalar(1/3);if(openings.some(polygon=>pointIsInsideRoomPolygon({x:a.x,y:a.z},polygon)))count++}});return{count,total}};
    window.jointReport=()=>{const scene=roofCreateScene(),reveals=[];scene.updateMatrixWorld(true);scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerOpeningReveal){const b=new Box3().setFromObject(o);reveals.push({min:b.min.toArray(),max:b.max.toArray()})}});return reveals};
    window.jointCapture=async(x)=>{const s=roofCreateStates()[0];s.setFrameloop('never');s.scene.add(new AmbientLight('#ffffff',2));s.scene.traverse(o=>{if(o.isMesh){const role=o.userData.houseDesignerRole??'';o.visible=o.name.startsWith('stair-')||role.includes('slab')||role.includes('floor')}});s.camera.position.set(x+2.4,5.4,3.2);s.camera.lookAt(x,2.2,.2);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)};
  })()`)
  const load = async () => {
    await evaluate(`roofCreateStates()[0].setFrameloop('always');document.querySelector('[aria-label="Project menu"]').click()`)
    await pause(150); await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
    await until(`!!roofCreateScene().getObjectByName('model-transform-joint-stair') && jointReport().length>0`)
    await pause(800)
  }
  const reports = []
  for (const [name, x, faces] of [['hole', 0, 4], ['notch', 2.3, 5]]) {
    await evaluate(`fixture.floors[0].models[0].position.x=${x}`); await load()
    await until(`jointReport().length===${faces}`)
    const reveals = await evaluate('jointReport()')
    assert.equal(reveals.length, faces)
    for(const reveal of reveals) {
      const supported=name==='notch'&&reveal.min[0]>=2.89999
      assert.ok(Math.abs(reveal.min[1]-(supported?2.7:2.68))<.00001,'lining meets the lower wall top or the free ceiling edge')
      assert.ok(Math.abs(reveal.max[1]-(supported?2.9:2.912))<.00001,'lining meets the upper wall base or the free floor-finish edge')
    }
    await until(`skirtOverVoid().total>0`)
    assert.equal((await evaluate('skirtOverVoid()')).count,0,'upper skirting cannot overhang the stair cutout')
    await evaluate(`jointCapture(${x})`); await pause(200)
    writeFileSync(`.tmp-viewer-stair-joints-${name}.png`, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    reports.push({ name, reveals })
  }
  // Pick an exposed lining from inside the void, then apply its real finish.
  const point=await evaluate(`(async()=>{const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js'),s=roofCreateStates()[0];s.scene.getObjectByName('model-transform-joint-stair').visible=false;let face;s.scene.traverse(o=>{if(o.userData.houseDesignerOpeningReveal&&!face)face=o});const p=new Box3().setFromObject(face).getCenter(new Vector3()),normal=face.getWorldDirection(new Vector3()),toward=new Vector3(2.3,p.y,0).sub(p);if(normal.dot(toward)<0)normal.negate();s.camera.position.copy(p).addScaledVector(normal,.55);s.camera.position.y+=.15;s.camera.lookAt(p);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera);const projected=p.clone().project(s.camera),r=s.gl.domElement.getBoundingClientRect();return{x:r.x+(projected.x+1)*r.width/2,y:r.y+(1-projected.y)*r.height/2}})()`)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})
  await until(`document.querySelector('[aria-label="Selection details"]').textContent.includes('Ceiling slab edge')`)
  assert.ok(await evaluate(`document.querySelector('[aria-label="Selection details"]').textContent.includes('upper')`),'slab selection preserves the upper editing floor')
  await evaluate(`document.querySelector('[aria-label="Materials"]').click()`);await pause(200)
  const materialId=await evaluate(`(()=>{const s=document.querySelector('.materials-flyout button[data-material-id][aria-pressed="true"]');if(!s)throw Error('No selected material');return s.dataset.materialId})()`)
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Apply material').click()`)
  await pause(300);await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);await pause(100)
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save').click()`)
  await until('!!window.savedJoints')
  const saved=await evaluate('savedJoints')
  assert.equal(saved.activeFloorId,'upper')
  assert.ok(saved.surfaceAssignments.some(a=>a.target.type==='floor-slab-edge'&&a.target.floorId==='ground'&&a.materialId===materialId),'finish is saved on the actual slab owner')
  const lightingFixture=structuredClone(saved)
  lightingFixture.surfaceAssignments=[]
  lightingFixture.floors.forEach((f,i)=>f.models.push({id:'storey-lamp-'+i,modelId:'point-light',position:{x:1.8,y:0},height:1.8,rotation:0,scale:1,lightPower:120,lightEnabled:true}))
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5186}/tests/browser/roofCreatePreviewRegression.html`})
  await until(`!!window.roofCreateScene?.() && !!document.querySelector('[aria-label="Project menu"]')`)
  await evaluate(`window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(lightingFixture))}],'stairwell-lights.house.json')}];document.querySelector('[aria-label="Project menu"]').click()`)
  await pause(100);await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await until(`(()=>{const lights=[];roofCreateScene().traverse(o=>{if(o.isPointLight&&o.intensity>0)lights.push(o.position.y)});return lights.some(y=>Math.abs(y-1.8)<.01)&&lights.some(y=>Math.abs(y-4.7)<.01)})()`)
  assert.ok(await evaluate(`document.querySelector('[aria-label="Selection details"]').textContent.includes('upper')`),'both storeys emit while upper floor is active')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(reports, null, 2))
  console.log('PASS: Stair voids stop skirting, slab edges accept finishes without switching floor, and lamps from both storeys emit.')
} finally { ws?.close(); child.kill() }
