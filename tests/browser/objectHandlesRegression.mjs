// With Vite running on port 5180: node tests/browser/objectHandlesRegression.mjs
// Exercises real pointer drags in both views; uses installed Windows Chrome.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'object-handles-'))}`, 'about:blank',
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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html' })
  for (let i = 0; i < 60; i++) {
    await pause(500)
    if (await evaluate('!!window.updateRegressionFloors && !!window.roofWallScene?.()')) break
  }
  await evaluate(`(async () => {
    const library = await import('/src/models/modelLibrary.ts');
    library.registerRuntimeModels([{id:'handle-test-box',name:'Test box',category:'Furniture',shape:'box',color:'#a16207',width:1.8,depth:0.9,height:0.75}]);
    window.updateRegressionFloors([{id:'handle-floor',name:'Handle test',elevation:0,roomHeight:2.4,slabThickness:0.2,walls:[],rooms:[],roofs:[],models:[{id:'handle-box',modelId:'handle-test-box',position:{x:0,y:0},rotation:0,scale:1}]}]);
    window.updateRegressionActiveFloor('handle-floor');window.selectRegressionModel('handle-box');
  })()`)
  await pause(3000)
  await evaluate(`(() => {const s=window.roofWallScene();s.camera.position.set(0,7,5);s.camera.lookAt(0,0.5,0);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await pause(700)
  assert.equal(await evaluate('document.querySelectorAll("[data-object-handles]").length'), 0)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify('[aria-label="3D transform mode"]')}).querySelectorAll('button').length`), 2)
  assert.equal(await evaluate('!!window.roofWallScene().scene.getObjectByName("model-transform-handle-box")'), true)
  const highlightState = () => evaluate(`(() => {
    const root=window.roofWallScene().scene.getObjectByName('model-transform-handle-box');
    const overlay=root.getObjectByName('model-selection-highlight');
    if(!overlay)return null;
    const material=Array.isArray(overlay.material)?overlay.material[0]:overlay.material;
    const original=Array.isArray(overlay.parent.material)?overlay.parent.material[0]:overlay.parent.material;
    return {color:material.color.getHexString(),opacity:material.opacity,depthWrite:material.depthWrite,
      sharedGeometry:overlay.geometry===overlay.parent.geometry,separateMaterial:material!==original,originalColor:original.color.getHexString()};
  })()`)
  assert.deepEqual(await highlightState(),{color:'248cff',opacity:0.28,depthWrite:false,
    sharedGeometry:true,separateMaterial:true,originalColor:'a16207'})
  await evaluate('window.selectRegressionModel(null)')
  await pause(250)
  assert.equal(await highlightState(),null)
  await evaluate("window.selectRegressionModel('handle-box')")
  await pause(250)
  assert.equal((await highlightState()).color,'248cff')
  const handlePosition = selector => evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  const drag = async (from, dx, dy, cancel = false, inspectDuringDrag, modifiers = 0) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, modifiers })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, modifiers })
    for(let i=1;i<=8;i++) {await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+dx*i/8,y:from.y+dy*i/8,buttons:1,modifiers});await pause(20)}
    if(inspectDuringDrag) {await pause(100);await inspectDuringDrag()}
    if(cancel) await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y + dy, button: 'left', clickCount: 1, modifiers })
    await pause(500)
  }
  const controlState = () => evaluate(`(() => {let c;window.roofWallScene().scene.traverse(o=>{if(o.isTransformControls)c=o});return {mode:c.mode,showX:c.showX,showY:c.showY,showZ:c.showZ}})()`)
  assert.equal((await controlState()).mode,'translate')
  const gizmoPoint = (axis, vertex) => evaluate(`(() => {
    const s=window.roofWallScene();let c;s.scene.traverse(o=>{if(o.isTransformControls)c=o});
    const handle=c.gizmo.gizmo[c.mode].children.find(o=>o.name===${JSON.stringify(axis)} && o.visible && ${vertex === undefined ? 'o.isMesh' : 'o.isLine'});
    const p=s.camera.position.clone().set(0,0,0);
    ${vertex === undefined ? 'handle.geometry.computeBoundingBox();handle.geometry.boundingBox.getCenter(p);' : `p.fromBufferAttribute(handle.geometry.attributes.position,${vertex});`}
    p.applyMatrix4(handle.matrixWorld).project(s.camera);const r=s.gl.domElement.getBoundingClientRect();
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}
  })()`)
  await drag(await gizmoPoint('X'),40,0)
  const moved3D=await evaluate('window.regressionFloors[0].models[0]')
  assert.ok(moved3D.position.x>0.1,JSON.stringify(moved3D))
  const rotateButton=await handlePosition('[aria-label="3D transform mode"] button:last-child')
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...rotateButton,button:'left',clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rotateButton,button:'left',clickCount:1})
  await pause(300)
  assert.deepEqual(await controlState(),{mode:'rotate',showX:false,showY:true,showZ:false})
  await drag(await gizmoPoint('Y',16),-30,25)
  const rotated3D=await evaluate('window.regressionFloors[0].models[0]')
  assert.ok(Math.abs(rotated3D.rotation)>0.1,JSON.stringify(rotated3D))
  assert.equal(rotated3D.scale,1)
  assert.equal(rotated3D.widthScale,1)
  assert.equal(rotated3D.depthScale,1)
  await drag(await gizmoPoint('Y',16),-30,25,false,undefined,10)
  const constrainedRotation=await evaluate('window.regressionFloors[0].models[0].rotation')
  assert.ok(Math.abs(constrainedRotation/(Math.PI/4)-Math.round(constrainedRotation/(Math.PI/4)))<1e-8)
  const moveButton=await handlePosition('[aria-label="3D transform mode"] button:first-child')
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...moveButton,button:'left',clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...moveButton,button:'left',clickCount:1})
  await pause(300)
  const beforePlaneMove=await evaluate('window.regressionFloors[0].models[0].position')
  await drag(await gizmoPoint('XZ'),28,25,false,undefined,10)
  const afterPlaneMove=await evaluate('window.regressionFloors[0].models[0].position')
  const planeDX=afterPlaneMove.x-beforePlaneMove.x,planeDY=afterPlaneMove.y-beforePlaneMove.y
  assert.ok(Math.hypot(planeDX,planeDY)>0.1)
  assert.ok(Math.abs(planeDX)<1e-8 || Math.abs(planeDY)<1e-8 || Math.abs(Math.abs(planeDX)-Math.abs(planeDY))<1e-8)
  assert.equal(await evaluate('window.regressionSelectedModelId'), 'handle-box')
  writeFileSync('.tmp-object-handles.png', Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('3D Move/Rotate drags work, with no resize handles or Scale tool')
  // Actual native clicks must reuse resident programs and the pick framebuffer.
  const click = async point => {
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    await pause(250)
  }
  const objectPoint = await evaluate(`(() => {
    const s=window.roofWallScene(),o=s.scene.getObjectByName('model-transform-handle-box');
    const p=s.camera.position.clone().set(0,0.375,0);o.localToWorld(p);p.project(s.camera);
    const r=s.gl.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  })()`)
  const emptyPoint = {x:300,y:180}
  await click(emptyPoint)
  await click(objectPoint)
  assert.equal(await evaluate('window.regressionSelectedModelId'),'handle-box')
  await evaluate(`(() => {
    const gl=window.roofWallScene().gl.getContext();window.pickAllocations={programs:0,framebuffers:0};
    for(const [method,key] of [['createProgram','programs'],['createFramebuffer','framebuffers']]) {
      const original=gl[method].bind(gl);gl[method]=(...args)=>{
        if(key==='programs' || new Error().stack.includes('withColorPickRender'))window.pickAllocations[key]++;
        return original(...args);
      };
    }
  })()`)
  for(let i=0;i<4;i++) {
    await click(emptyPoint)
    assert.equal(await evaluate('window.regressionSelectedModelId'),null)
    await click(objectPoint)
    assert.equal(await evaluate('window.regressionSelectedModelId'),'handle-box')
  }
  assert.deepEqual(await evaluate('window.pickAllocations'),{programs:0,framebuffers:0})
  console.log('Repeated native picks and reselections create no shader programs or pick framebuffers')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/objectHandlesRegression.html'})
  for(let i=0;i<30;i++){await pause(300);if(await evaluate('!!window.handleStage?.()'))break}
  await pause(700)
  for(let i=0;i<30;i++){if(await evaluate('!!window.handleThreeScene?.()?.scene.getObjectByName("model-transform-handle-box")'))break;await pause(300)}
  await evaluate(`(() => {const s=window.handleThreeScene();s.camera.position.set(3,7,8);s.camera.lookAt(3,0.5,3);s.camera.updateMatrixWorld()})()`)
  const planModel = () => evaluate('window.handleFloor.models[0]')
  const planPosition = index => evaluate(`(() => {
    const stage=window.handleStage();
    const nodes=stage.find('Rect').filter(n=>n.width()===9 && n.draggable());
    const n=nodes[${index}];const p=n.getAbsoluteTransform().point({x:4.5,y:4.5});
    const r=stage.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}
  })()`)
  assert.equal(await evaluate("window.handleStage().find('Rect').filter(n=>n.width()===9 && n.draggable()).length"),8)
  // Sample the live canvas, rather than only the final stored model. The fixed
  // edge must stay still on every frame, without project commits while dragging.
  const initialPlan = await planModel()
  const fixedEdge = await planPosition(3)
  const widthHandle = await planPosition(4)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:widthHandle.x,y:widthHandle.y,button:'left',clickCount:1})
  const samples=[]
  for(let i=1;i<=10;i++) {
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:widthHandle.x+i*4,y:widthHandle.y,buttons:1})
    await pause(60)
    const fixed = await planPosition(3)
    const moving = await planPosition(4)
    assert.ok(Math.hypot(fixed.x-fixedEdge.x,fixed.y-fixedEdge.y)<0.1,`Fixed edge jumped: ${JSON.stringify(fixed)}`)
    assert.ok(Math.abs(moving.x-widthHandle.x-i*4)<0.5,`Handle lost pointer: ${JSON.stringify(moving)}`)
    assert.deepEqual(await planModel(),initialPlan)
    assert.equal(await evaluate('window.handleCommits??0'),0)
    const live3D=await evaluate('(() => {const o=window.handleThreeScene().scene.getObjectByName("model-transform-handle-box");return {x:o.position.x,width:o.scale.x}})()')
    assert.ok(live3D.width>1,JSON.stringify(live3D))
    assert.ok(Math.abs(live3D.x-3-(live3D.width-1)*0.9)<0.001)
    const readout=await evaluate('document.querySelector(".model-scale-readout")?.innerText')
    assert.ok(readout?.includes('Width') && readout.includes('Length'),readout)
    const widthInput=await evaluate(`document.querySelector(${JSON.stringify('input[aria-label="Object width"]')}).value`)
    assert.ok(Math.abs(Number(widthInput)-live3D.width*1.8)<0.001,widthInput)
    samples.push(moving.x)
  }
  writeFileSync('.tmp-object-live-sizing.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:widthHandle.x+40,y:widthHandle.y,button:'left',clickCount:1})
  await pause(500)
  assert.equal(await evaluate('window.handleCommits'),1)
  assert.equal(await evaluate('!!document.querySelector(".model-scale-readout")'),true)
  const planWidth=await planModel()
  assert.ok(planWidth.widthScale>1.1,JSON.stringify(planWidth))
  assert.equal(planWidth.depthScale,1)
  assert.ok(Math.abs(planWidth.position.x-3-(planWidth.widthScale-1)*0.9)<0.02)
  await drag(await planPosition(7),30,25)
  assert.equal(await evaluate('window.handleCommits'),2)
  const planCorner=await planModel()
  assert.ok(planCorner.widthScale>planWidth.widthScale)
  assert.ok(planCorner.depthScale>planWidth.depthScale)
  const planCenter = await evaluate(`(() => { const stage=window.handleStage();const n=stage.find('Rect').find(n=>n.width()===14);const p=n.getAbsoluteTransform().point({x:7,y:7});const r=stage.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}})()`)
  await drag({x:planCenter.x+28,y:planCenter.y},-28,28,false,async()=>{
    assert.equal(await evaluate('window.handleCommits'),2)
    assert.ok(Math.abs(await evaluate('window.handleThreeScene().scene.getObjectByName("model-transform-handle-box").rotation.y'))>0.5)
    assert.equal(await evaluate('window.handleFloor.models[0].rotation'),0)
  })
  assert.equal(await evaluate('window.handleCommits'),3)
  const planRotated=await planModel()
  assert.ok(Math.abs(planRotated.rotation)>0.5,JSON.stringify(planRotated))
  await drag(await planPosition(4),0,40)
  assert.equal(await evaluate('window.handleCommits'),4)
  const rotatedWidth=await planModel()
  assert.ok(rotatedWidth.widthScale>planRotated.widthScale)
  assert.equal(rotatedWidth.depthScale,planRotated.depthScale)
  assert.equal(await evaluate('window.handleSelection'),'handle-box')
  const moveCenter = await evaluate(`(() => {const stage=window.handleStage();const n=stage.find('Rect').find(n=>n.width()===14);const p=n.getAbsoluteTransform().point({x:7,y:7});const r=stage.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}})()`)
  await drag(moveCenter,18,12,false,async()=>{
    assert.equal(await evaluate('window.handleCommits'),4)
    const moved3D=await evaluate('(() => {const o=window.handleThreeScene().scene.getObjectByName("model-transform-handle-box");return {x:o.position.x,z:o.position.z}})()')
    assert.ok(Math.hypot(moved3D.x-rotatedWidth.position.x,moved3D.z-rotatedWidth.position.y)>0.1)
    assert.deepEqual(await planModel(),rotatedWidth)
  })
  assert.equal(await evaluate('window.handleCommits'),5)
  const editField=async(label,value,key='Enter')=>{
    const point=await handlePosition(`input[aria-label="Object ${label}"]`)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65})
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65})
    await call('Input.insertText',{text:value})
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:13})
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:13})
    await pause(300)
  }
  await editField('width','2.4')
  let exact=await planModel()
  assert.ok(Math.abs(exact.scale*exact.widthScale*1.8-2.4)<1e-8)
  assert.equal(await evaluate('window.handleCommits'),6)
  await editField('length','1.5')
  exact=await planModel()
  assert.ok(Math.abs(exact.scale*exact.depthScale*0.9-1.5)<1e-8)
  await editField('y scale','1.7')
  exact=await planModel()
  assert.equal(exact.scale,1.7)
  assert.ok(Math.abs(exact.scale*exact.widthScale*1.8-2.4)<1e-8)
  assert.ok(Math.abs(exact.scale*exact.depthScale*0.9-1.5)<1e-8)
  await editField('rotation','45')
  assert.ok(Math.abs((await planModel()).rotation-Math.PI/4)<1e-8)
  assert.equal(await evaluate('window.handleCommits'),9)
  await editField('x scale','0')
  assert.equal(await evaluate('window.handleCommits'),9)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify('input[aria-label="Object x scale"]')}).getAttribute('aria-invalid')`),'true')
  await editField('x scale','9','Escape')
  assert.equal(await evaluate('window.handleCommits'),9)
  await editField('x scale','1.25')
  assert.ok(Math.abs((await planModel()).scale*(await planModel()).widthScale-1.25)<1e-8)
  await editField('z scale','1.1')
  assert.ok(Math.abs((await planModel()).scale*(await planModel()).depthScale-1.1)<1e-8)
  assert.equal(await evaluate('window.handleCommits'),11)
  writeFileSync('.tmp-object-handles-plan.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('2D smooth transforms, live 3D sizing/rotation/movement, live dimension panel and single commits passed',await planModel())
  await click(await handlePosition('[aria-label="Project menu"]'))
  await click(await handlePosition('.ground-image-controls > button'))
  await evaluate(`(() => {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=80;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#0ea5e9';ctx.fillRect(0,0,80,80);
    return new Promise(resolve=>canvas.toBlob(blob=>{
      const input=document.querySelector('input[aria-label="Upload floor image"]');
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'transparent-site.png',{type:'image/png'}));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve();
    },'image/png'));
  })()`)
  for(let i=0;i<30;i++){if(await evaluate('!!window.handleStage().findOne(".ground-image-handles")'))break;await pause(100)}
  await pause(500)
  const ground=()=>evaluate('window.handleFloor.groundImage')
  const uploaded=await ground()
  assert.equal(uploaded.name,'transparent-site.png')
  assert.ok(Math.abs(uploaded.width/uploaded.length-2)<1e-8)
  assert.equal(uploaded.opacity,0.5)
  assert.equal(await evaluate('window.groundImageCommits'),1)
  const alpha=await evaluate(`(() => {
    const image=window.handleStage().findOne('.ground-image').image();
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    c.getContext('2d').drawImage(image,0,0);return c.getContext('2d').getImageData(120,40,1,1).data[3];
  })()`)
  assert.equal(alpha,0)
  // Move the open menu away from the handles while leaving edit mode enabled.
  await click(await handlePosition('[aria-label="Project menu"]'))
  const groundPoint=anchor=>evaluate(`(() => {
    const stage=window.handleStage();const t=stage.findOne('.ground-image-handles');
    const n=t.findOne(${JSON.stringify('.'+anchor)});const p=n.getAbsolutePosition();
    const r=stage.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};
  })()`)
  const fixedGroundCorner=await groundPoint('top-left')
  await drag(await groundPoint('bottom-right'),35,18,false,async()=>{
    assert.equal(await evaluate('window.groundImageCommits'),1)
    const fixed=await groundPoint('top-left')
    assert.ok(Math.hypot(fixed.x-fixedGroundCorner.x,fixed.y-fixedGroundCorner.y)<0.5)
  })
  let resizedGround=await ground()
  assert.ok(resizedGround.width>uploaded.width)
  assert.ok(Math.abs(resizedGround.width/resizedGround.length-2)<1e-6)
  assert.equal(await evaluate('window.groundImageCommits'),2)
  const beforeEdge=await ground()
  await drag(await groundPoint('middle-right'),24,0)
  resizedGround=await ground()
  assert.ok(resizedGround.width>beforeEdge.width)
  assert.ok(Math.abs(resizedGround.length-beforeEdge.length)<1e-8)
  const imagePoint=await evaluate(`(() => {
    const stage=window.handleStage();const n=stage.findOne('.ground-image');
    const p=n.getAbsoluteTransform().point({x:n.width()*0.2,y:n.height()*0.6});
    const r=stage.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};
  })()`)
  await drag(imagePoint,20,15)
  const movedGround=await ground()
  assert.ok(movedGround.position.x>resizedGround.position.x)
  assert.equal(movedGround.width,resizedGround.width)
  assert.equal(await evaluate('window.groundImageCommits'),4)
  const beforeConstrainedImage=await ground()
  const imageDragPoint=await evaluate(`(() => {
    const s=window.handleStage(),n=s.findOne('.ground-image'),p=n.getAbsoluteTransform().point({x:n.width()*0.2,y:n.height()*0.6});
    const r=s.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};
  })()`)
  await drag(imageDragPoint,24,22,false,undefined,10)
  const constrainedImage=await ground()
  assert.ok(Math.abs((constrainedImage.position.x-beforeConstrainedImage.position.x)-(constrainedImage.position.y-beforeConstrainedImage.position.y))<1e-8)
  const finalGround=await ground()
  const ground3D=await evaluate(`(() => {
    const n=window.handleThreeScene().scene.getObjectByName('ground-image-3d');
    return {width:n.geometry.parameters.width,length:n.geometry.parameters.height,opacity:n.material.opacity,x:n.position.x,z:n.position.z};
  })()`)
  assert.equal(ground3D.width,movedGround.width)
  assert.equal(ground3D.length,movedGround.length)
  assert.equal(ground3D.opacity,0.5)
  assert.equal(ground3D.x,finalGround.position.x+finalGround.width/2)
  const portable=JSON.parse(JSON.stringify(await evaluate('window.handleFloor')))
  assert.equal(portable.groundImage.dataUrl,movedGround.dataUrl)
  await click(await handlePosition('[aria-label="Project menu"]'))
  await click(await handlePosition('.ground-image-controls > button'))
  await click(await handlePosition('.ground-image-menu button[aria-pressed="true"]'))
  assert.equal(await evaluate('!!window.handleStage().findOne(".ground-image-handles")'),false)
  writeFileSync('.tmp-ground-image.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  const menuBounds=await evaluate(`(() => {const r=document.querySelector('.ground-image-menu').getBoundingClientRect();return {left:r.left,right:r.right}})()`)
  assert.ok(menuBounds.left>=0 && menuBounds.right<600)
  const opacityPoint=await evaluate(`(() => {const r=document.querySelector('input[aria-label="Floor image opacity"]').getBoundingClientRect();return {x:r.left+r.width*0.75,y:r.top+r.height/2}})()`)
  await click(opacityPoint)
  assert.ok((await ground()).opacity>0.65 && (await ground()).opacity<0.85)
  assert.equal(await evaluate("window.handleThreeScene().scene.getObjectByName('ground-image-3d').material.opacity"),(await ground()).opacity)
  await click(await handlePosition('.ground-image-menu input[type="checkbox"]'))
  assert.equal((await ground()).visible,false)
  assert.equal(await evaluate("!!window.handleThreeScene().scene.getObjectByName('ground-image-3d')"),false)
  await click(await handlePosition('.ground-image-menu input[type="checkbox"]'))
  assert.equal((await ground()).visible,true)
  await click(await handlePosition('.ground-image-menu button:last-child'))
  assert.equal(await ground(),undefined)
  assert.equal(await evaluate("!!window.handleStage().findOne('.ground-image')"),false)
  console.log('Transparent image upload, corner/edge resize, movement, locking, 3D display and portable data passed')
  await click(await handlePosition('[aria-label="Project menu"]'))
  await evaluate(`window.handleSetFloor({...window.handleFloor,walls:[{id:'modifier-wall',kind:'external',start:{x:2,y:2},end:{x:5,y:2},thickness:0.3,height:2.4}]})`)
  await pause(500)
  const wall=()=>evaluate('window.handleFloor.walls[0]')
  const dragWall=async(dx,dy,modifiers)=>{
    const point=await evaluate(`(() => {
      const s=window.handleStage(),w=window.handleFloor.walls[0];
      const p=s.getAbsoluteTransform().point({x:(w.start.x+w.end.x)*30,y:(w.start.y+w.end.y)*30});
      const r=s.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};
    })()`)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1,modifiers})
    for(let i=1;i<=8;i++) {
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+dx*i/8,y:point.y+dy*i/8,buttons:1,modifiers});await pause(30)
    }
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1,modifiers})
    await pause(300)
  }
  let originalWall=await wall()
  await dragWall(23,12,2)
  let translatedWall=await wall()
  assert.ok(translatedWall.start.x>originalWall.start.x && translatedWall.start.y>originalWall.start.y)
  const fineDelta=translatedWall.start.x-originalWall.start.x
  assert.ok(Math.abs(fineDelta/0.1-Math.round(fineDelta/0.1))>0.01)
  originalWall=translatedWall
  await dragWall(25,4,10)
  translatedWall=await wall()
  assert.ok(translatedWall.start.x>originalWall.start.x)
  assert.ok(Math.abs(translatedWall.start.y-originalWall.start.y)<1e-8)
  originalWall=translatedWall
  await dragWall(24,22,10)
  translatedWall=await wall()
  const diagonalX=translatedWall.start.x-originalWall.start.x,diagonalY=translatedWall.start.y-originalWall.start.y
  assert.ok(diagonalX>0.1 && Math.abs(diagonalX-diagonalY)<1e-8)
  assert.ok(Math.abs(diagonalX/0.1-Math.round(diagonalX/0.1))>0.01)
  assert.ok(Math.abs(translatedWall.end.x-translatedWall.start.x-3)<1e-8)
  console.log('Native Ctrl wall drag is continuous; Ctrl+Shift constrains axes and diagonals without rounding')
  await evaluate("window.handleSelectModel('handle-box')")
  await pause(300)
  const beforeConstrainedModel=await planModel()
  const modelCenter=await evaluate(`(() => {
    const s=window.handleStage(),n=s.find('Rect').find(n=>n.width()===14);
    const p=n.getAbsoluteTransform().point({x:7,y:7}),r=s.container().getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};
  })()`)
  await drag(modelCenter,24,22,false,undefined,10)
  const constrainedModel=await planModel()
  const modelDeltaX=constrainedModel.position.x-beforeConstrainedModel.position.x,modelDeltaY=constrainedModel.position.y-beforeConstrainedModel.position.y
  assert.ok(modelDeltaX>0.1 && Math.abs(modelDeltaX-modelDeltaY)<1e-8)
  assert.ok(Math.abs(modelDeltaX/0.1-Math.round(modelDeltaX/0.1))>0.01)
  console.log('Ctrl+Shift is consistent for 2D objects, walls, ground images and 3D rotation')
  const beforeRatioResize=await planModel()
  const beforeFixedCorner=await planPosition(0)
  await drag(await planPosition(7),24,22,false,async()=>{
    const fixed=await planPosition(0)
    assert.ok(Math.hypot(fixed.x-beforeFixedCorner.x,fixed.y-beforeFixedCorner.y)<0.1)
  },10)
  const afterRatioResize=await planModel()
  assert.ok(Math.abs(afterRatioResize.widthScale/afterRatioResize.depthScale-beforeRatioResize.widthScale/beforeRatioResize.depthScale)<1e-8)
  await evaluate("window.handleSelectModel(null);window.handleSetFloor({...window.handleFloor,models:[],walls:[]});window.handleWallMode(true)")
  await pause(300)
  const drawStart={x:178,y:490},drawEnd={x:235,y:545}
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...drawStart,modifiers:10})
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...drawStart,button:'left',clickCount:1,modifiers:10})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...drawStart,button:'left',clickCount:1,modifiers:10})
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...drawEnd,modifiers:10})
  await pause(150)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...drawEnd,button:'left',clickCount:1,modifiers:10})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...drawEnd,button:'left',clickCount:1,modifiers:10})
  await pause(300)
  const drawn=await evaluate('window.handleFloor.walls.find(w=>w.id==="drawn-wall")')
  assert.ok(drawn && Math.abs((drawn.end.x-drawn.start.x)-(drawn.end.y-drawn.start.y))<1e-8,
    JSON.stringify(await evaluate('({walls:window.handleFloor.walls,header:document.querySelector(".pane-header").textContent})')))
  console.log('Ctrl+Shift also preserves resize proportions, constrains 3D plane movement and constrains new walls')
} finally {
  ws?.close()
  child.kill()
}
