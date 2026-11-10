// Uses the real editor's project-file input and controls in an owned profile.
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installSceneEditPreload} from './sceneEditTrace.js'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const [mode='inspect',port='5191',folder='tmp/scene-edit-stalls']=process.argv.slice(2)
mkdirSync(folder,{recursive:true})
const b=await lightingBrowser(),report={mode,steps:[]},pause=ms=>new Promise(r=>setTimeout(r,ms))
const save=()=>writeFileSync(`${folder}/editor-${mode}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
async function click(selector,text){
 const p=await b.evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text?`a.find(e=>e.textContent.trim()===${JSON.stringify(text)})`:'a[0]'};if(!e||e.disabled)throw Error('Missing enabled control');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
 await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:0,...p})
 await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p})
}
async function mouse(point,type='click'){
 if(type==='click'){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:0,...point});await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point})}
}
async function field(selector,text){
 await click(selector);await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:0});await b.call('Input.insertText',{text})
}
async function measured(label,action,predicate,limit=60000){
 await b.evaluate(`sceneEditTrace.mark(${JSON.stringify(label)},{control:true})`)
 const start=Date.now();await action();const samples=[];let traceAt=0,applied=false
 while(Date.now()-start<limit){
  if(await b.evaluate(predicate)){applied=true;break}
  if(Date.now()-traceAt>500){traceAt=Date.now();samples.push(await b.evaluate('sceneEditTrace.snapshot()'))}
  await pause(100)
 }
 const state=await b.evaluate('sceneEditTrace.snapshot()');report.steps.push({label,elapsedMs:Date.now()-start,applied,samples,state});save()
 console.log('UI STEP',label,Date.now()-start,applied)
 assert.ok(applied,'Actual editor control failed: '+label)
 assert.equal(state.health.canvas.connected,true);assert.equal(state.health.lost,false);assert.ok(!state.warmFailure)
}
try{
 const server=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(5000)})
 if(!server.ok)throw Error('Editor server unavailable: '+server.status)
 await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false})
 await b.call('Page.setInterceptFileChooserDialog',{enabled:true})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installSceneEditPreload.toString()})({devtools:false});
  window.showOpenFilePicker=undefined;const fileClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file')window.sceneEditFileInput=this;return fileClick.call(this)};`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/?rendererAudit=1&sceneEditTrace=1&rendererShadows=single`})
 await b.wait(`!!document.querySelector('button[aria-label="Project menu"]')`)
 await click('button[aria-label="Project menu"]');await click('button','Load')
 await b.wait('!!window.sceneEditFileInput')
 const input=await b.call('Runtime.evaluate',{expression:'sceneEditFileInput',returnByValue:false})
 await b.call('DOM.setFileInputFiles',{objectId:input.result.objectId,files:['C:/projects/git/house-designer/house-designer/colin_house_v2.json']})
 console.log('LOADED real editor project-file control')
 await b.evaluate(`(async()=>{
  const m=await import('/tests/browser/rendererTestModules.ts');window.editorState=m.getEditorState;
  window.editorCurrent=()=>{const e=document.getElementById('root'),key=Object.keys(e).find(k=>k.startsWith('__reactContainer$'));return e[key].stateNode.current};
  window.editorProps=name=>{let found;const visit=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(editorCurrent());return found};
  const assignmentCache=new WeakMap();window.editorAssignmentJSON=a=>{if(!assignmentCache.has(a))assignmentCache.set(a,JSON.stringify(a));return assignmentCache.get(a)};
  window.editorCanvasAssignmentsJSON=()=>{let largest=[];const visit=f=>{if(!f)return;const a=f.memoizedProps?.surfaceAssignments;if(a?.length>largest.length)largest=a;visit(f.child);visit(f.sibling)};visit(m.getEditorFiber());return editorAssignmentJSON(largest)};
 })()`)
 await b.wait(`(()=>{const p=editorProps('ThreeDView'),s=editorState();return p?.floors.reduce((n,f)=>n+f.models.length,0)===68&&s?.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`,240000)
 report.initial=await b.evaluate(`(async()=>{const {installSceneEditTrace}=await import('/tests/browser/sceneEditTrace.js');return installSceneEditTrace(editorState())})()`)
 report.inventory=await b.evaluate(`(()=>{const p=editorProps('FloorplanCanvas');return{controls:[...document.querySelectorAll('button,input,select,[role="slider"]')].map(e=>({tag:e.tagName,text:e.textContent.slice(0,120),aria:e.getAttribute('aria-label'),title:e.title,type:e.type,value:e.value,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})),floor:p.activeFloor,threeProps:{sun:editorProps('ThreeDView').lightDirection,selected:editorProps('ThreeDView').selectedModelId},body:document.body.innerText.slice(0,10000)}})()`)
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${folder}/editor-${mode}.png`,Buffer.from(shot.data,'base64'));save();console.log('EDITOR READY',JSON.stringify({gi:report.initial.gi,controls:report.inventory.controls.map(e=>e.aria||e.text||e.title).filter(Boolean)}))
 if(mode==='workflow'||mode==='controls'||mode==='sun-controls'){
  await b.wait(`(()=>{const u=editorState().scene.userData,g=u.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.preparing&&!g.warming&&!g.volumePending&&(!u.softFloorGI||u.softFloorGI.state!=='preparing')})()`,240000)
  report.completedGIBeforeEdits=await b.evaluate('sceneEditTrace.snapshot()');save()
  if(mode==='workflow'||mode==='sun-controls'){
  const originalSun=await b.evaluate('({...editorProps("ThreeDView").lightDirection})')
  const sunlight=async(direction)=>{
   const p=await b.evaluate(`(()=>{const r=document.querySelector('[aria-label="Move light source"]').getBoundingClientRect(),v=${JSON.stringify(direction)},d=(1-(v.elevation-.08)/1.12)*Math.max(r.width,r.height)/2;return{x:r.x+r.width/2+Math.cos(v.azimuth)*d,y:r.y+r.height/2+Math.sin(v.azimuth)*d}})()`)
   await mouse(p)
  }
  for(let i=0;i<2;i++)for(const restore of [false,true]){
   const target={...originalSun,azimuth:originalSun.azimuth+(restore?0:.3)}
   // The mouse-operated pad has pixel granularity; the scene must match the
   // value actually committed by the control, rather than an unreachable float.
   await measured(`sun-${i}-${restore?'restore':'change'}`,()=>sunlight(target),`(()=>{const p=editorProps('ThreeDView'),s=editorState(),rendered=sceneEditTrace.snapshot().oldPredicate.sun;return Math.abs(p.lightDirection.azimuth-(${target.azimuth}))<.07&&Math.abs(rendered.azimuth-p.lightDirection.azimuth)<1e-8&&!s.scene.userData.shaderWarmupPending})()`)
  }
  }
  const id='3fc467b2-f9bc-4f90-a31a-f04a3b6fe969'
  await b.evaluate(`sceneEditTrace.targetModelId='${id}';window.editorPlanPoint=id=>import('/tests/browser/sceneEditTrace.js').then(m=>m.editorPlanModelPoint(id))`)
  let p=await b.evaluate(`editorPlanPoint('${id}')`),original=p.model.position
  await mouse({x:p.x,y:p.y});await b.wait(`editorProps('FloorplanCanvas').selectedModelId==='${id}'`)
  if(mode==='workflow'){
  await measured('move furniture by plan drag',async()=>{
   await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,x:p.x,y:p.y,clickCount:1})
   for(let i=1;i<=5;i++)await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x+i*4,y:p.y})
   await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,x:p.x+20,y:p.y,clickCount:1})
  },`(()=>{const o=editorState().scene.getObjectByName('model-transform-${id}');return o&&Math.abs(o.matrixWorld.elements[12]-${original.x})>.05})()`)
  await measured('undo furniture move',()=>click('button[aria-label="Undo"]'),`(()=>{const o=editorState().scene.getObjectByName('model-transform-${id}');return o&&Math.abs(o.matrixWorld.elements[12]-${original.x})<1e-5})()`)
  p=await b.evaluate(`editorPlanPoint('${id}')`);await mouse({x:p.x,y:p.y});await b.wait(`editorProps('FloorplanCanvas').selectedModelId==='${id}'`)
  }
  await measured('remove furniture using Delete',()=>click('.context-panel button','Delete'),`!editorState().scene.getObjectByName('model-transform-${id}')`)
  await measured('undo furniture removal',()=>click('button[aria-label="Undo"]'),`!!editorState().scene.getObjectByName('model-transform-${id}')`)
  // Picking a wall during reconstruction can select a transient model instead.
  // Observe the existing readiness gates before choosing a stable surface.
  await measured('GI and shader readiness after completed undo',async()=>{},`(()=>{const u=editorState().scene.userData,g=u.indirectLighting;return !u.shaderWarmupPending&&!g?.preparing&&!g?.pendingUpdate&&!g?.volumePending&&u.softFloorGI?.state!=='preparing'})()`,240000)
  const point=await b.evaluate(`import('/tests/browser/sceneEditTrace.js').then(m=>m.editorWallPoint())`)
  report.wallPick=point
  await mouse(point);await b.wait(`['wall-face','wall-surface-fragment'].includes(editorProps('ThreeDView').selectedSurface?.type)`)
  await click('button[aria-label="Materials"]');await field('input[aria-label="Search materials"]','Timeless')
  await b.wait(`!!document.querySelector('.material-tree-item')`)
  const material=await b.evaluate(`document.querySelector('.material-tree-item').getAttribute('data-material-id')`)
  await click(`.material-tree-item[data-material-id="${material}"]`)
  await b.evaluate(`window.editorOriginalAssignments=editorAssignmentJSON(editorProps('ThreeDView').surfaceAssignments)`)
  for(let i=0;i<2;i++){
   await measured(`wall material apply ${i}`,()=>click('button','Apply material'),`editorAssignmentJSON(editorProps('ThreeDScene').surfaceAssignments)!==editorOriginalAssignments&&editorCanvasAssignmentsJSON()===editorAssignmentJSON(editorProps('ThreeDScene').surfaceAssignments)`)
   await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
   await measured(`shader readiness after material apply ${i}`,async()=>{},`!editorState().scene.userData.shaderWarmupPending`,240000)
   await measured(`wall material restore with Undo ${i}`,()=>click('button[aria-label="Undo"]'),`editorAssignmentJSON(editorProps('ThreeDScene').surfaceAssignments)===editorOriginalAssignments&&editorCanvasAssignmentsJSON()===editorOriginalAssignments`)
   await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
   await measured(`shader readiness after material restore ${i}`,async()=>{},`!editorState().scene.userData.shaderWarmupPending`,240000)
  }
  await click('button[aria-label="Materials"]')
  await measured('enter 3D fullscreen',()=>click('button[aria-label="Enter fullscreen"]'),`!!document.fullscreenElement`)
  await measured('return to split 2D and 3D',()=>click('button[aria-label="Exit fullscreen"]'),`!document.fullscreenElement&&editorState().gl.domElement.isConnected`)
  await click('button[aria-label="3D view menu"]')
  await measured('enter head-height walkthrough',()=>click('input[aria-label="Head height"]'),`document.querySelector('input[aria-label="Head height"]').checked&&editorState().gl.domElement.isConnected`)
  await click('button[aria-label="3D view menu"]')
  await b.evaluate(`window.editorWalkStart=editorState().camera.position.toArray();window.editorWalkHeight=editorProps('FloorplanCanvas').activeFloor.elevation+1.8`)
  await measured('walk forward at head height',async()=>{
   await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87})
   try{await b.evaluate('new Promise(resolve=>{let left=8;const tick=()=>--left?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick)})')}
   finally{await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87})}
  },`(()=>{const p=editorState().camera.position;return Math.hypot(p.x-editorWalkStart[0],p.z-editorWalkStart[2])>.01&&Math.abs(p.y-editorWalkHeight)<1e-6})()`)
  await click('button[aria-label="3D view menu"]')
  await measured('leave head-height walkthrough',()=>click('input[aria-label="Head height"]'),`!document.querySelector('input[aria-label="Head height"]').checked&&editorState().gl.domElement.isConnected`)
  await click('button[aria-label="3D view menu"]')
  report.final=await b.evaluate('sceneEditTrace.snapshot()')
  const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${folder}/editor-${mode}-final.png`,Buffer.from(shot.data,'base64'))
  assert.deepEqual(b.errors,[])
 }
 report.events=await b.evaluate('sceneEditTrace.events');await b.evaluate('sceneEditTrace.stop()');save()
}catch(error){report.failure=String(error);try{report.events=await b.evaluate('window.sceneEditTrace?.events');report.failureState=await b.evaluate('window.sceneEditTrace?.snapshot?.()');const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${folder}/editor-${mode}-failure.png`,Buffer.from(shot.data,'base64'))}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
