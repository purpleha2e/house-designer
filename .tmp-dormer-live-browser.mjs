import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'loft-regression-'))
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${profile}`, 'about:blank',
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
  await call('Page.enable')
  if (process.argv.includes('shader-warmup')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?springfield-14&materials&edit-floor'})
    for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && !document.querySelector('.viewport-preparing-overlay') && document.body.innerText.includes('Engine idle')`))break}
    await new Promise(r=>setTimeout(r,1500))
    for(const mode of ['ao','direct']) {
    if(mode==='direct') {
      await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click();await new Promise(r=>setTimeout(r,300));const set=async(label,value)=>{const input=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===label).querySelector('input');if(input.checked!==value)input.click();await new Promise(r=>setTimeout(r,800))};await set('Ambient occlusion',false);await set('Fade nearby roofs (1.5 m)',true);[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click()})()`)
      for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`document.body.innerText.includes('Engine idle')`))break}
    }
    const baseline=await evaluate(`window.roofWallScene().gl.info.programs.map(p=>p.id)`)
    console.log('MODE',mode)
    console.log('WARM BASELINE',baseline.length)
    const seen=new Set(baseline)
    for(const [position,target] of [ [[13.6,4.5,7.5],[14.6,4.8,8.7]], [[12.3,4.2,3.5],[14.6,4.8,1.3]], [[7.8,4.2,3.8],[5.7,4.8,1.9]], [[7.4,4.2,9.7],[5.7,4.8,11.6]], [[13.1,4.2,11.2],[14.6,4.8,11.6]], [[18,9,17],[10,5,7]] ]) {
      await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(...${JSON.stringify(position)});s.camera.lookAt(...${JSON.stringify(target)});s.camera.updateMatrixWorld();s.invalidate()})()`)
      await new Promise(r=>setTimeout(r,1200))
      const programs=await evaluate(`window.roofWallScene().gl.info.programs.map(p=>({id:p.id,key:p.cacheKey}))`)
      const added=programs.filter(p=>!seen.has(p.id));added.forEach(p=>seen.add(p.id))
      console.log('VIEW',position,'PROGRAMS',programs.length,'NEW',added.map(p=>({id:p.id,key:p.key.slice(-180)})))
    }
    console.log('OVERLAY',await evaluate(`!!document.querySelector('.viewport-preparing-overlay')`))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-shader-warmup-'+mode+'.png',Buffer.from(shot.data,'base64'))
    }
  } else if (process.argv.includes('wall-edge')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?springfield-14&materials&edit-floor'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[1].id)`)
    await evaluate(`window.updateRegressionFloors(window.regressionFloors.map((f,i)=>i===1?{...f,models:f.models.map(m=>m.modelId==='point-light'?{...m,lightEnabled:true}:m)}:f))`)
    await new Promise(r=>setTimeout(r,2500))
    await evaluate(`(async()=>{const wait=()=>new Promise(r=>setTimeout(r,500));const control=label=>[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===label)?.querySelector('input');[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click();await wait();window.setEdgeOption=async(label,value)=>{const c=control(label);if(!c)throw Error('Missing '+label);if(c.checked!==value){c.click();await wait()}};for(const label of ['Ambient occlusion','Daylight','Lights','Fade nearby walls (1.5 m)'])await window.setEdgeOption(label,false);await window.setEdgeOption('Night fill',true);const s=window.roofWallScene();s.camera.position.set(4,4.2,7.8);s.camera.lookAt(6.3,4.6,10.9);s.camera.updateMatrixWorld();s.invalidate();[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click()})()`)
    const savedCamera=JSON.parse(readFileSync('springfield_14.json','utf8')).threeDView.camera
    console.log('CAMERA',savedCamera)
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(13.6,4.5,7.5);s.camera.lookAt(14.6,4.8,8.7);s.camera.updateMatrixWorld();s.invalidate()})()`)
    for(const [name,ao,day,shadows] of [['fill',false,true,false],['local',false,true,false]]){
      await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click();await new Promise(r=>setTimeout(r,300));await window.setEdgeOption('Ambient occlusion',${ao});await window.setEdgeOption('Daylight',${day});await window.setEdgeOption('Shadows',${shadows});[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click()})()`)
      await new Promise(r=>setTimeout(r,1500))
      if(name==='local'){
        await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click();await new Promise(r=>setTimeout(r,300));await window.setEdgeOption('Lights',true);[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click()})()`)
        await new Promise(r=>setTimeout(r,1500))
      }
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-wall-edge-'+name+'.png',Buffer.from(shot.data,'base64'))
    }
  } else if (process.argv.includes('ambient-fill')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials&edit-floor'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[1].id)`)
    await new Promise(r=>setTimeout(r,2500))
    await evaluate(`(async()=>{const wait=()=>new Promise(r=>setTimeout(r,500));const control=label=>[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===label)?.querySelector('input');if(!control('Soft ambient shading')){[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render').click();await wait()}window.setAmbientCheckOption=async(label,value)=>{const c=control(label);if(!c)throw Error('Missing '+label);if(c.checked!==value){c.click();await wait()}};for(const label of ['Ambient occlusion','Daylight','Lights','Fade nearby walls (1.5 m)'])await window.setAmbientCheckOption(label,false);await window.setAmbientCheckOption('Night fill',true);const s=window.roofWallScene();s.camera.position.set(4,3.8,7.8);s.camera.lookAt(6.3,3.5,10.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
    for(const soft of [false,true]){
      await evaluate(`window.setAmbientCheckOption('Soft ambient shading',${soft})`)
      await new Promise(r=>setTimeout(r,1500))
      console.log(soft?'SOFT':'FLAT',await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene();s.gl.render(s.scene,s.camera);const c=s.gl.getContext(),width=c.drawingBufferWidth,height=c.drawingBufferHeight;const pixels=new Uint8Array(width*height*4);c.readPixels(0,0,width,height,c.RGBA,c.UNSIGNED_BYTE,pixels);return [[6.35,3.8,9.3],[5.4,3.8,10.9042021]].map(p=>{const v=new Vector3(...p).project(s.camera);const i=(Math.floor((v.y+1)*height/2)*width+Math.floor((v.x+1)*width/2))*4;return [...pixels.slice(i,i+3)]})})()`))
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-ambient-'+(soft?'soft':'flat')+'.png',Buffer.from(shot.data,'base64'))
    }
    await evaluate(`window.setAmbientCheckOption('Night fill',false)`)
    console.log('FILL OFF',await evaluate(`(()=>{const a=[];window.roofWallScene().scene.traverse(o=>{if(['ambient-fill','ambient-sky-fill'].includes(o.userData.houseDesignerRole))a.push(o.intensity)});if(a.some(v=>v!==0))throw Error('Ambient fill ignored Night fill');return a})()`))
  } else if (process.argv.includes('doorway-floors')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?springfield-14&materials'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await new Promise(r=>setTimeout(r,2000))
    const result=await evaluate(`import('/tests/browser/doorwayFloorRegression.js').then(m=>m.checkDoorwayFloors())`)
    console.log('DOORWAY FLOORS',result)
    await evaluate(`(()=>{const s=window.roofWallScene(),p=${JSON.stringify(result.previewPoint)},floor=window.regressionFloors.find(f=>f.id===${JSON.stringify(result.floorId)});const w=floor.walls.filter(w=>w.kind==='internal'&&w.openings?.length).sort((a,b)=>{const dist=w=>Math.abs((w.end.y-w.start.y)*(p[0]-w.start.x)-(w.end.x-w.start.x)*(p[2]-w.start.y))/Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y);return dist(a)-dist(b)})[0];const dx=w.end.x-w.start.x,dz=w.end.y-w.start.y,l=Math.hypot(dx,dz),side=(-dz*(p[0]-w.start.x)+dx*(p[2]-w.start.y))>0?1:-1;s.camera.position.set(p[0]-side*dz/l*0.9,p[1]+0.7,p[2]+side*dx/l*0.9);s.camera.lookAt(p[0],p[1]+0.04,p[2]);s.camera.updateMatrixWorld();s.invalidate()})()`)
    await new Promise(r=>setTimeout(r,1500))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-doorway-floors.png',Buffer.from(shot.data,'base64'))
  } else if (process.argv.includes('wall-light-leaks')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&edit-floor'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[1].id)`)
    await new Promise(r=>setTimeout(r,4000))
    console.log('SKIRTING',await evaluate(`import('/tests/browser/loftSkirtingLightLeakRegression.js').then(m=>m.checkLoftSkirtingLightLeak())`))
    await evaluate(`window.updateRegressionFloors(window.regressionFloors.slice(0,2).map((f,i)=>i===1?{...f,ceilingMode:'open',models:f.models.filter(m=>!m.roofAttachment)}:f))`)
    await new Promise(r=>setTimeout(r,6000))
    console.log('ROOF SEAMS',await evaluate(`import('/tests/browser/loftRoofLightLeakRegression.js').then(m=>m.checkLoftRoofLightLeak())`))
  } else if (process.argv.includes('wall-acne')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?springfield-14&materials'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    console.log('scene',await evaluate(`(()=>{const s=window.roofWallScene();return {camera:s.camera.position.toArray(),sun:window.regressionSunPosition,floors:window.regressionFloors.map(f=>({id:f.id,elevation:f.elevation,models:f.models.length,walls:f.walls.filter(w=>w.kind==='external')}))}})()`))
    await new Promise(r=>setTimeout(r,3000))
    console.log('WALL SHADOWS',await evaluate(`import('/tests/browser/exteriorWallShadowRegression.js').then(m=>m.checkExteriorWallShadows())`))
    console.log('LEGACY SHADOWS',await evaluate(`import('/tests/browser/exteriorWallShadowRegression.js').then(m=>m.checkExteriorWallShadows({legacy:true}))`))
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(7,4,-2);s.camera.lookAt(7.5,3.9,1.6);s.camera.updateMatrixWorld();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')for(const m of o.material){m.map=null;m.normalMap=null;m.color.set('#cccccc');m.needsUpdate=true}});const sun=s.scene.children.find(o=>o.userData.houseDesignerRole==='sun-light');sun.position.set(sun.target.position.x-20,8,sun.target.position.z-2);sun.shadow.needsUpdate=true;s.invalidate()})()`)
    for(const mode of ['normal','no-walls','bias','depth']) {
      await evaluate(`(()=>{const s=window.roofWallScene();s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')o.castShadow=${mode!=='no-walls'}});const sun=s.scene.children.find(o=>o.userData.houseDesignerRole==='sun-light');sun.shadow.normalBias=${mode==='bias'?.08:.015};sun.shadow.bias=${mode==='depth'?-.0001:0};sun.shadow.needsUpdate=true;s.invalidate()})()`)
      await new Promise(r=>setTimeout(r,3500))
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-wall-acne-'+mode+'.png',Buffer.from(shot.data,'base64'))
    }
  } else if (process.argv.includes('door-plan')) {
    await call('Page.navigate',{url:'http://127.0.0.1:5182/.tmp-door-plan.html'})
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));if(await evaluate(`window.doorStage?.()?.find('.door-plan-symbol').length===6`))break}
    console.log('Door symbols',await evaluate(`(()=>{const stage=window.doorStage();if(!stage)throw Error('No stage');const symbols=stage.find('.door-plan-symbol');if(symbols.length!==6)throw Error('Missing doors');if(stage.find('.door-swing').length!==7)throw Error('Missing swing arcs');return symbols.map(s=>({bounds:s.getClientRect(),arcs:s.find('.door-swing').length}))})()`))
    const before=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-door-plan.png',Buffer.from(before.data,'base64'))
    const target=await evaluate(`(()=>{const stage=window.doorStage(),shape=stage.find('.door-swing')[0],p=shape.getAbsoluteTransform().point({x:15,y:-35});const hit=stage.getIntersection(p);if(hit!==shape)throw Error('Swing area not selectable');const r=stage.container().getBoundingClientRect();return{x:r.x+p.x,y:r.y+p.y}})()`)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1})
    await new Promise(r=>setTimeout(r,500))
    console.log('Selection',await evaluate(`(()=>{if(window.doorSelection!=='door-0')throw Error('Door selection failed');return window.doorSelection})()`))
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1})
    for(const dx of [8,16,24])await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x+dx,y:target.y,button:'left',buttons:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x+24,y:target.y,button:'left',clickCount:1})
    await new Promise(r=>setTimeout(r,500))
    console.log('Drag',await evaluate(`(()=>{const m=window.doorFloor.models[0];if(m.position.x<=1.1||m.wallAttachment?.wallId!=='wall-0')throw Error('Door drag failed '+JSON.stringify(m));return m.position})()`))
  } else if (process.argv.includes('roof-selection')) {
    await call('Page.navigate', {url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    for (const part of ['exterior', 'gable', 'underside']) {
      const target = await evaluate(`(async()=>{
        const {Vector3}=await import('/node_modules/.vite/deps/three.js'); const s=window.roofWallScene();
        const meshes=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole==='${part === 'exterior' ? 'roof-top' : part === 'gable' ? 'roof-infill' : 'roof-underside'}'${part === 'gable' ? '&&!o.userData.interior&&o.userData.solidGable' : ''})meshes.push(o)});
        let best;for(const mesh of meshes){const g=mesh.geometry,p=g.attributes.position;for(let i=0;i<(g.index?.count??p.count);i+=3){const v=[0,1,2].map(j=>mesh.localToWorld(new Vector3().fromBufferAttribute(p,g.index?g.index.getX(i+j):i+j)));const n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));const area=n.length();if((${part === 'gable' ? 'Math.abs(n.y)/area < 0.1' : 'true'})&&(!best||area>best.area))best={area,n:n.normalize(),center:v[0].add(v[1]).add(v[2]).multiplyScalar(1/3),roofId:mesh.userData.roofId}}}
        if(!best)throw Error('No target surface');s.camera.position.copy(best.center).addScaledVector(best.n,${part === 'underside' ? '1' : '8'});s.camera.lookAt(best.center);s.camera.updateMatrixWorld();s.invalidate();const r=s.gl.domElement.getBoundingClientRect();return {roofId:best.roofId,x:r.x+r.width/2,y:r.y+r.height/2};})()`)
      console.log('aim', part, target, await evaluate(`(()=>{const s=window.roofWallScene();return {p:s.camera.position.toArray(),q:s.camera.quaternion.toArray(),rect:s.gl.domElement.getBoundingClientRect().toJSON()}})()`))
      await new Promise(r=>setTimeout(r,1500))
      await evaluate(`(()=>{const c=window.roofWallScene().gl.domElement;const e={clientX:${target.x},clientY:${target.y},button:0,pointerId:1,bubbles:true};c.dispatchEvent(new PointerEvent('pointerdown',{...e,buttons:1}));c.dispatchEvent(new PointerEvent('pointerup',{...e,buttons:0}));})()`)
      await new Promise(r=>setTimeout(r,2000))
      const before=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp-roof-selection-${part}.png`,Buffer.from(before.data,'base64'))
      console.log(part, await evaluate(`(()=>{const a=[];window.roofWallScene().scene.traverse(o=>{if(/^roof-.*-highlight$/.test(o.userData.houseDesignerRole??''))a.push({role:o.userData.houseDesignerRole,roofId:o.userData.roofId,depthWrite:o.material.depthWrite})});const sel=window.regressionSurface;if(sel?.type!=='roof'||sel.roofId!==${JSON.stringify(target.roofId)}||(sel.part??'exterior')!=='${part}')throw Error('Unexpected selection '+JSON.stringify(sel));if(!a.length||a.some(o=>o.role!=='roof-${part}-highlight'||o.roofId!==sel.roofId||o.depthWrite))throw Error('Incorrect highlights '+JSON.stringify(a));return {selection:sel,highlights:a}})()`))
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp-roof-selection-${part}.png`,Buffer.from(shot.data,'base64'))
    }
  } else if (process.argv.includes('render-options')) {
    await call('Page.navigate', {url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    console.log('ROOF OPTIONS', await evaluate(`import('/tests/browser/roofRenderOptionsRegression.js').then(m=>m.checkRoofRenderOptions())`))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-roof-render-options.png',Buffer.from(shot.data,'base64'))
  } else if (process.argv.includes('red-dormer')) {
    for (const edit of process.argv.includes('loft-only') ? ['loft'] : [false,true]) {
      await call('Page.navigate', {url:`http://127.0.0.1:5182/tests/browser/roofWallRegression.html?red-house-5&materials${edit?'&edit-floor':''}`})
      for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
      await new Promise(r=>setTimeout(r,2500))
      if (edit === 'loft') {
        await evaluate(`window.updateRegressionActiveFloor(window.regressionFloors[1].id)`)
        await new Promise(r=>setTimeout(r,4000))
      }
      await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene();let wall;s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='dormer-walls')wall=o});s.camera.position.copy(wall.localToWorld(new Vector3(-0.8,0.8,-2.6)));s.camera.lookAt(wall.localToWorld(new Vector3(0,-0.05,-0.05)));s.camera.updateMatrixWorld();s.invalidate()})()`)
      await new Promise(r=>setTimeout(r,1500))
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp-red-dormer-${edit?'edit':'all'}-${process.argv.includes('after')?'after':'before'}.png`,Buffer.from(shot.data,'base64'))
      if (process.argv.includes('after')) console.log(edit?'RED LOFT':'RED ALL', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkExternalWallDormer())`))
    }
  } else if (process.argv.includes('seam')) {
    await call('Page.navigate', {url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials&edit-floor'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await new Promise(r=>setTimeout(r,3000))
    for (const index of [0,1]) {
      console.log(await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js'); const s=window.roofWallScene();const ceilings=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='dormer-ceiling')ceilings.push(o)});const c=ceilings[${index}];c.geometry.computeBoundingBox();const b=c.geometry.boundingBox;s.camera.position.copy(c.localToWorld(new Vector3(0.15,b.max.y-1.4,b.min.z-0.8)));s.camera.lookAt(c.localToWorld(new Vector3(0,b.max.y-0.2,b.min.z+0.4)));s.camera.updateMatrixWorld();s.invalidate();return {model:c.userData.modelId,bounds:b}})()`))
      await new Promise(r=>setTimeout(r,1500))
      const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp-dormer-seam-${index}-${process.argv.includes('after')?'after':'before'}.png`,Buffer.from(shot.data,'base64'))
    }
  } else if (process.argv.includes('low') || process.argv.includes('move') || process.argv.includes('reveal')) {
    for (const edit of [false, true]) {
      await call('Page.navigate', {url:`http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials${edit?'&edit-floor':''}`})
      for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
      await new Promise(r=>setTimeout(r,3000))
      if(process.argv.includes('reveal')) console.log(edit?'REVEAL LOFT':'REVEAL ALL', await evaluate(`import('/tests/browser/dormerWindowRevealRegression.js').then(m=>m.checkDormerWindowReveals())`))
      if(process.argv.includes('move')) console.log(edit?'MOVE LOFT':'MOVE ALL', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkDormerMove())`))
      console.log(edit?'LOW LOFT':'LOW ALL', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkWideLowDormer())`))
      for (const inside of [false,true]) {
        await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene();const model=window.regressionFloors.flatMap(f=>f.models).find(m=>m.dormerWidth===2.25&&m.dormerHeight===0.6);let wall;s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='dormer-walls'&&o.userData.modelId===model.id)wall=o});s.camera.position.copy(wall.localToWorld(new Vector3(${inside?'0.1,1,-2.8':'2,2.1,5'})));s.camera.lookAt(wall.localToWorld(new Vector3(0,0.7,-0.15)));s.camera.updateMatrixWorld();s.invalidate()})()`)
        await new Promise(r=>setTimeout(r,1200))
        const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp-low-dormer-${edit?'edit':'all'}-${inside?'inside':'outside'}.png`,Buffer.from(shot.data,'base64'))
      }
    }
  } else if (process.argv.includes('exterior')) {
    await call('Page.navigate', {url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&materials&dormer-materials'})
    for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.userData.houseDesignerRole||o.type==='Group') && document.body.innerText.includes('Engine idle')`))break}
    await new Promise(r=>setTimeout(r,4000))
    await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene();let wall;s.scene.traverse(o=>{if(!wall&&o.userData.houseDesignerRole==='dormer-walls')wall=o});s.camera.position.copy(wall.localToWorld(new Vector3(2,2,5)));s.camera.lookAt(wall.localToWorld(new Vector3(0,0.9,-0.5)));s.camera.updateMatrixWorld();s.invalidate();window.selectRegressionModel(wall.userData.modelId)})()`)
    await new Promise(r=>setTimeout(r,3000))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('.tmp-dormer-textured-exterior.png',Buffer.from(shot.data,'base64'))
    console.log('Textured exterior captured')
  } else {
  await call('Page.navigate', { url: 'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&dormer-materials' })
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o => o.type === 'Group') && !document.body.innerText.includes('Preparing 3D scene')`)) break
  }
  await new Promise(resolve => setTimeout(resolve, 4000))
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render')?.click()})()`)
  await new Promise(resolve=>setTimeout(resolve,300))
  await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby roofs')){const input=label.querySelector('input');if(input?.checked)input.click()}})()`)
  await new Promise(resolve=>setTimeout(resolve,1500))
  for (const edit of [false, true]) {
    if (edit) {
      await call('Page.navigate', {url:'http://127.0.0.1:5182/tests/browser/roofWallRegression.html?loft-test&dormer-materials&edit-floor'})
      for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1000));if(await evaluate(`!!window.roofWallScene?.()?.scene.children.some(o=>o.type==='Group') && !document.body.innerText.includes('Preparing 3D scene')`))break}
      await new Promise(r=>setTimeout(r,4000))
    }
    await evaluate(`(()=>{for(const label of document.querySelectorAll('label'))if(label.textContent.includes('Fade nearby roofs')){const input=label.querySelector('input');if(input?.checked)input.click()}})()`)
    console.log('EXTERIOR', await evaluate(`import('/tests/browser/dormerMaterialsRegression.js').then(m=>m.checkDormerExterior())`))
    console.log('MATERIALS', await evaluate(`import('/tests/browser/dormerMaterialsRegression.js').then(m=>m.checkDormerMaterials())`))
    console.log('LIVE', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkLiveDormerWallIntersections())`))
    console.log(edit ? 'LOFT EDIT' : 'ALL FLOORS', await evaluate(`import('/tests/browser/loftDormerInteriorRegression.js').then(m=>m.checkLoftDormerInterior())`))
    await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(3.0,5.95,8.0);s.camera.lookAt(5.65,5.95,9.84);s.camera.updateMatrixWorld();s.invalidate();const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Render');if(document.querySelector('label'))b?.click()})()`)
    await new Promise(r=>setTimeout(r,1500))
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(edit?'.tmp-dormer-cheeks-edit.png':'.tmp-dormer-cheeks.png',Buffer.from(shot.data,'base64'))
    await evaluate(`(async()=>{const {Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene();let wall;s.scene.traverse(o=>{if(!wall&&o.userData.houseDesignerRole==='dormer-walls')wall=o});s.camera.position.copy(wall.localToWorld(new Vector3(2,2,5)));s.camera.lookAt(wall.localToWorld(new Vector3(0,0.9,-0.5)));s.camera.updateMatrixWorld();s.invalidate()})()`)
    await new Promise(r=>setTimeout(r,1200))
    const exteriorShot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(edit?'.tmp-dormer-exterior-edit.png':'.tmp-dormer-exterior.png',Buffer.from(exteriorShot.data,'base64'))
  }
  }
}finally{ws?.close();child.kill()}
