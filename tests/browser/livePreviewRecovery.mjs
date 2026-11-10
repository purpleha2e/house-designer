// Read-only startup verification of the actual production preview address.
import { lightingBrowser } from './lightingHarness.mjs'
import { installSceneEditPreload } from './sceneEditTrace.js'
import { installViewportPerformanceProbe } from './viewportPerformanceProbe.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
const out=process.argv[2]??'tmp/selection-cross-floor/live-preview-ready'
const port=process.argv[3]??'4173'
const early=process.argv.includes('--early')
const sky=process.argv.includes('--sky')
const exterior=process.argv.includes('--exterior')
const performanceProbe=process.argv.includes('--performance')
mkdirSync(out,{recursive:true})
const logs=[], b=await lightingBrowser({onEvent:m=>{
  if(m.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(m.params.type)) logs.push({type:m.params.type,args:m.params.args.map(a=>String(a.value??a.description).slice(0,2000))})
}}),report={samples:[],steps:[]}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function mouse({x,y}){for(const type of ['mouseMoved','mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1})}
async function key(code,key,ms){await b.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});await pause(ms);await b.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})}
async function look(target){
  await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x:1050,y:450,button:'right',buttons:2,clickCount:1});await b.wait('!!document.pointerLockElement',2000)
  for(let i=0;i<3;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'right',buttons:2});await pause(25)}
  const delta=await b.evaluate(`(()=>{const s=previewState(),e=s.camera.rotation.clone().setFromQuaternion(s.camera.quaternion,'YXZ'),d=s.camera.position.clone().set(...${JSON.stringify(target)}).sub(s.camera.position).normalize();let y=Math.atan2(-d.x,-d.z)-e.y;while(y>Math.PI)y-=Math.PI*2;while(y<-Math.PI)y+=Math.PI*2;return{x:-y/.002,y:-(Math.asin(d.y)-e.x)/.002}})()`)
  for(let i=1;i<=4;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:delta.x*i/4,y:delta.y*i/4,button:'right',buttons:2});await pause(50)}
  await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1050,y:450,button:'right',buttons:0,clickCount:1})
}
try {
  await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    (${installSceneEditPreload.toString()})({devtools:true});
    window.previewState=()=>{let state;const walk=f=>{if(!f)return;const v=f.memoizedProps?.value;if(v?.getState){const s=v.getState();if(s.gl?.domElement.isConnected)state=s}walk(f.child);walk(f.sibling)};for(const [root]of sceneEditTrace.roots)walk(root.current);return state};
    window.previewProps=()=>{let plan,context,view;const walk=f=>{if(!f)return;const p=f.memoizedProps;if(p?.activeFloor&&p.onViewportChange)plan=p;if(p?.activeFloor&&p.onRenameRoom)context=p;if(p?.floors&&'showAllFloors'in p)view=p;walk(f.child);walk(f.sibling)};for(const [root]of sceneEditTrace.roots)walk(root.current);return{plan:plan?.activeFloor.id,context:context?.activeFloor.id,selected:context?.selectedModel?.model.id,floors:view?.floors,assignments:view?.surfaceAssignments}};
    window.previewSnapshot=()=>{const s=previewState(),u=s?.scene.userData;return{at:performance.now(),warm:u?.shaderWarmupPending,warmGeneration:u?.shaderWarmupGeneration,failure:u?.shaderWarmupFailure,phase:u?.progressiveStartup,gi:u?.indirectLighting?.state,preparation:u?.viewportPreparation,sky:u?.daylightEnvironment,ambient:u?.ambientFillBudget,display:window.previewLastDisplay,tone:s&&{mapping:s.gl.toneMapping,exposure:s.gl.toneMappingExposure,output:s.gl.outputColorSpace},profiles:u?.shaderWarmupProfile?.slice(-4),camera:s?.camera.position.toArray(),body:document.body.innerText.slice(-2000),cover:!!document.querySelector('.viewport-preparing-overlay'),entries:window.houseDesignerEngineLog?.recent(30),events:previewRecoveryEvents}};
    window.previewRecoveryEvents=[];let nextContext=0;
    window.previewWidgetFrames=[];
    const instrument=setInterval(()=>{const s=previewState();if(!s)return;clearInterval(instrument);const original=s.gl.render;s.gl.render=function(scene,camera){const result=original.apply(this,arguments);if(camera===s.camera&&(scene===s.scene||scene.userData.retainedViewport||'basicGeometryViewport'in scene.userData)){
      window.previewLastDisplay={at:performance.now(),kind:scene===s.scene?'live':scene.userData.retainedViewport?'retained':scene.userData.basicGeometryViewport?'basic':scene.userData.preparedLightingViewport?'lit':'opaque'};
      let control;if(!${performanceProbe})s.scene.traverse(o=>{if(o.isTransformControls&&o.visible)control=o});
      if(control?.object){const expected=control.object.getWorldPosition(s.camera.position.clone()),errors=[];control.gizmo.gizmo[control.mode].traverseVisible(handle=>{if(!handle.isMesh)return;scene.traverseVisible(copy=>{if(copy.isMesh&&copy.geometry===handle.geometry&&copy.material===handle.material&&copy.name===handle.name)errors.push(copy.getWorldPosition(expected.clone()).distanceTo(expected))})});previewWidgetFrames.push({at:performance.now(),object:control.object.name,display:scene===s.scene?'live':'prepared',controlError:control.worldPosition.distanceTo(expected),handleErrors:errors});if(previewWidgetFrames.length>400)previewWidgetFrames.shift()}
    }return result}},100);
    const record=(kind,data)=>previewRecoveryEvents.push({at:performance.now(),kind,...data});
    addEventListener('error',e=>record('error',{message:e.message,stack:e.error?.stack}));
    addEventListener('unhandledrejection',e=>record('rejection',{message:String(e.reason),stack:e.reason?.stack}));
    const original=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl')&&!seen.has(this)){seen.add(this);const id=++nextContext;record('context.created',{type,id});
        for(const event of ['webglcontextlost','webglcontextrestored','webglcontextcreationerror'])this.addEventListener(event,e=>record(event,{id,message:e.statusMessage,connected:this.isConnected,width:this.width,height:this.height,isViewport:this===previewState()?.gl.domElement}));
      }
      return original.call(this,type,...args);
    };
  `})
  if(performanceProbe)await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installViewportPerformanceProbe.toString()})();`})
  await b.call('Page.navigate',{url:'http://127.0.0.1:'+port+'/'})
  for(let i=0;i<(process.argv.includes('--long-startup')?120:60);i++){
    await pause(1500)
    const sample=await b.evaluate('previewSnapshot()')
    report.samples.push(sample)
    if(b.errors.length&&!sky)throw Error('Browser errors invalidate the startup check: '+b.errors.join('\n'))
    if(performanceProbe){const row=await b.evaluate('viewportPerformance.sample()');(report.startupPerformance??=[]).push(row);if(i%15===0)console.log(JSON.stringify({stage:'startup',at:row.at,fps:row.fps,warm:row.warm,gi:row.gi,phase:row.phase}))}
    if(i>8&&!sample.cover&&(early&&sample.phase?.geometryReadyMs!==undefined||sample.warm===false&&sample.gi==='ready'))break
  }
  report.ready=report.samples.at(-1)?.warm===false&&report.samples.at(-1)?.gi==='ready'
  if(!early&&!report.ready)throw Error('Full preparation did not finish within the bounded startup check')
  if(performanceProbe)await b.evaluate(`(()=>{const s=previewState();s.camera.position.set(-6,7,-5);s.camera.lookAt(4,3,8);s.camera.updateMatrixWorld(true);s.invalidate()})()`)
  else{await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1050,y:450});await key('KeyS','s',3000)
    const p=await b.evaluate('previewState().camera.position.toArray()');await look([p[0],p[1],p[2]+10]);await key('KeyD','d',5000);await look([2.5,3,7])}
  if(process.argv.includes('--fullscreen')){const target=await b.evaluate(`(()=>{const e=document.querySelector('[title="Fullscreen 3D view"]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse(target);await b.wait('!!document.fullscreenElement',3000)}
  report.navigation=[];let stable=0
  if(!early){for(let i=0;i<30;i++){await pause(1000);const s=await b.evaluate('previewSnapshot()');report.navigation.push(s);stable=s.warm===false&&s.gi==='ready'?stable+1:0;if(stable>=4)break}
    if(stable<4)throw Error('Preparation after normal camera navigation did not settle')}
  report.before=await b.evaluate('previewProps()')
  for(const id of sky||exterior||performanceProbe?[]:['bdd5d972-b20d-4971-a387-ca4b53f01cd5','f0c759c1-c5c4-4799-a13e-cf2210f19938','bdd5d972-b20d-4971-a387-ca4b53f01cd5','f0c759c1-c5c4-4799-a13e-cf2210f19938']){
    const target=await b.evaluate(`(()=>{const s=previewState(),o=s.scene.getObjectByName('model-transform-${id}');if(!o)return;let box;o.updateWorldMatrix(true,true);o.traverse(m=>{if(m.isMesh&&m.geometry.boundingBox&&!m.userData.selectionDecoration){const b=m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);if(box)box.union(b);else box=b}});if(!box)return;const v=box.getCenter(s.camera.position.clone()).project(s.camera),r=s.gl.domElement.getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2}})()`)
    if(!target||target.x<710||target.x>1395||target.y<50||target.y>810)throw Error('Target offscreen: '+id+' '+JSON.stringify(target))
    const before=await b.evaluate('previewSnapshot()');await mouse(target);await pause(750);const after=await b.evaluate('previewSnapshot()'),props=await b.evaluate('previewProps()');report.steps.push({id,target,before,after,props:{plan:props.plan,context:props.context,selected:props.selected}})
    if(props.selected!==id)throw Error('Wrong selection: '+JSON.stringify(props))
    if(port!=='4173'&&props.plan!==report.before.plan)throw Error('Selection changed the plan floor')
  }
  report.after=await b.evaluate('previewProps()')
  report.widgets=await b.evaluate('previewWidgetFrames')
  if(!sky&&!exterior&&!performanceProbe&&!report.widgets.some(frame=>frame.handleErrors.length))throw Error('No displayed transform handles were observed')
  if(report.widgets.some(frame=>frame.controlError>1e-5||frame.handleErrors.some(error=>error>1e-5)))throw Error('Transform handles detached from the selected object')
  if(JSON.stringify(report.before.floors)!==JSON.stringify(report.after.floors)||JSON.stringify(report.before.assignments)!==JSON.stringify(report.after.assignments))throw Error('Selection changed authored content')
  if(performanceProbe){report.performance=[];for(const variant of ['current','previous','current-again']){await b.evaluate('viewportPerformance.variant('+JSON.stringify(variant)+')');await pause(1500);await b.evaluate('viewportPerformance.sample()');for(let i=0;i<4;i++){await pause(2000);if(b.errors.length)throw Error('Browser errors invalidate the performance comparison: '+b.errors.join('\n'));const sample=await b.evaluate('viewportPerformance.sample()');report.performance.push(sample);console.log(JSON.stringify({stage:variant,fps:sample.fps,warm:sample.warm,gi:sample.gi,passes:sample.passes,ambient:sample.ambientCallback}))}}await b.evaluate('viewportPerformance.stop()')}
  if(exterior){
    // Isolated renderer A/B only: preserve materials, exposure, sky, sun and
    // authored settings. Restore live light intensities after each capture.
    report.exterior=[]
    for(const variant of process.argv.includes('--corrected-fill')?['baseline']:['baseline','ambient-term-only','no-ambient-fill']){
      const lights=await b.evaluate(`(()=>{const s=previewState();window.exteriorFillOriginals??=[];if(!exteriorFillOriginals.length)s.scene.traverse(o=>{if(['ambient-fill','ambient-sky-fill'].includes(o.userData.houseDesignerRole))exteriorFillOriginals.push([o,o.intensity])});for(const [o,intensity]of exteriorFillOriginals)o.intensity=intensity*${variant==='baseline'?1:variant==='ambient-term-only'?.19/(.45+.19):0};s.scene.userData.liveLightRevision=(s.scene.userData.liveLightRevision??0)+1;s.invalidate();return exteriorFillOriginals.map(([o,intensity])=>({role:o.userData.houseDesignerRole,original:intensity,current:o.intensity}))})()`)
      await pause(750);const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+variant+'.png',Buffer.from(shot.data,'base64'));report.exterior.push({variant,lights,state:await b.evaluate('previewSnapshot()')})
      if(process.argv.includes('--corrected-fill')){const state=report.exterior.at(-1).state;if(!state.ambient?.exteriorSkyReady||state.ambient.applied!==state.ambient.requested)throw Error('The exterior sky did not replace the fixed ambient fill')}
    }
    await b.evaluate(`for(const [o,intensity]of exteriorFillOriginals)o.intensity=intensity`)
  }
  if(sky){
    await b.evaluate(`new MutationObserver(()=>{const text=document.querySelector('.viewport-engine-status')?.textContent;if(text&&text!==window.previewStatusText){window.previewStatusText=text;previewRecoveryEvents.push({at:performance.now(),kind:'status',text})}}).observe(document.body,{subtree:true,childList:true,characterData:true})`)
    const point=selector=>b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await mouse(await point('[aria-label="3D view menu"]'));report.skies=[]
    for(const mode of ['overcast','clear']){
      const before=await b.evaluate('previewSnapshot()');await mouse(await point('[aria-label="Daylight sky"]'))
      for(const [key,code]of [[mode==='overcast'?'ArrowDown':'ArrowUp',mode==='overcast'?40:38],['Enter',13]]){await b.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});await pause(100)}
      await b.wait('document.querySelector(\'[aria-label="Daylight sky"]\')?.value==='+JSON.stringify(mode),3000)
      const frames=[];for(let i=0;i<(early&&mode==='overcast'?2:60);i++){await pause(750);const s=await b.evaluate('previewSnapshot()');frames.push(s);if(s.failure||i>5&&s.warm===false&&s.gi==='ready')break}
      report.skies.push({mode,before,frames});const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+mode+'.png',Buffer.from(shot.data,'base64'))
    }
    report.skyEvents=await b.evaluate('window.houseDesignerEngineLog?.recent(500)');report.skyFinal=await b.evaluate('previewSnapshot()')
  }
  if(process.argv.includes('--edit')){
    const input=await b.evaluate(`(()=>{const e=document.querySelector('input[aria-label="Object width"]');if(!e)return;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,value:e.value}})()`)
    if(!input)throw Error('Cross-floor dimension field missing')
    await mouse(input)
    await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65})
    await b.call('Input.insertText',{text:'1.5'})
    await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await pause(1500)
    report.edit={input,after:await b.evaluate('previewProps()')}
    if(report.edit.after.plan!==report.before.plan||report.edit.after.context===report.before.plan)throw Error('Dimension edit changed the plan or lost the foreign selection context')
    const id=report.steps.at(-1).id,find=p=>p.floors.flatMap(f=>f.models).find(m=>m.id===id),a=find(report.after),z=find(report.edit.after)
    if(a.widthScale===z.widthScale)throw Error('Cross-floor width edit did not update the selected model')
    for(const floor of report.after.floors)if(!floor.models.some(m=>m.id===id)&&JSON.stringify(floor)!==JSON.stringify(report.edit.after.floors.find(f=>f.id===floor.id)))throw Error('Dimension edit changed another floor')
    const undo=await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>/^Undo/i.test(e.title||e.getAttribute('aria-label')||''));if(!e||e.disabled)return;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    if(!undo)throw Error('Undo button missing after dimension edit')
    await mouse(undo);await pause(1000);report.edit.undone=await b.evaluate('previewProps()')
    if(JSON.stringify(report.after.floors)!==JSON.stringify(report.edit.undone.floors))throw Error('Undo did not restore the authored floors')
  }
  const image=await b.call('Page.captureScreenshot',{format:'png'})
  writeFileSync(out+'/startup.png',Buffer.from(image.data,'base64'))
  report.scripts=await b.evaluate('[...document.scripts].map(s=>s.src)')
}catch(error){report.failure=String(error);process.exitCode=1}
finally {
  report.errors=b.errors;report.warnings=logs
  writeFileSync(out+'/startup.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({failure:report.failure,ready:report.ready,samples:report.samples.length,startupReadyAt:report.samples.at(-1)?.at,navigationSamples:report.navigation?.length,steps:report.steps.map(s=>({id:s.id,elapsed:s.after.at-s.before.at,beforeWarm:s.before.warm,afterWarm:s.after.warm,beforeGeneration:s.before.warmGeneration,afterGeneration:s.after.warmGeneration,body:s.after.body})),scripts:report.scripts,errors:report.errors,warnings:report.warnings}))
  b.close()
}
