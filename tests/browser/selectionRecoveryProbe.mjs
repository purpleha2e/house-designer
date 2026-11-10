import {lightingBrowser} from './lightingHarness.mjs'
import {installSceneEditPreload} from './sceneEditTrace.js'
import {mkdirSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
const [port='5250',label='reference-probe']=process.argv.slice(2),out=`tmp/selection-recovery/${label}`
mkdirSync(out,{recursive:true})
const full=process.argv.includes('--full'),pause=ms=>new Promise(r=>setTimeout(r,ms)),frames=[]
let traceDone;const trace=new Promise(r=>traceDone=r)
const b=await lightingBrowser({onEvent:m=>{if(m.method==='Tracing.tracingComplete')traceDone(m.params);if(m.method==='Page.screencastFrame'){b.call('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});if(frames.length<150)frames.push(m.params)}}}),report={steps:[]}
const save=(name,data)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2))
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
async function shot(name){const r=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
async function mouse({x,y}){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1})}
async function control(selector,text){const p=await b.evaluate(`(()=>{const es=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text?`es.find(e=>e.textContent.trim()===${JSON.stringify(text)})`:'es[0]'};if(!e)throw Error('Missing control');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse(p)}
async function step(target,label,delay=180){const before=await b.evaluate('selectionAudit.snapshot()');await b.evaluate(`selectionAudit.event('test.input',{label:${JSON.stringify(label)}})`);await mouse(target);await pause(delay);const after=await b.evaluate('selectionAudit.snapshot()');report.steps.push({label,target:{...target},before,after});if(!full)await shot('click-'+report.steps.length)}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installSceneEditPreload.toString()})({devtools:true});window.confirm=m=>!m.startsWith('Save changes');window.recoveryTasks=[];new PerformanceObserver(l=>recoveryTasks.push(...l.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/selectionRecovery.html?lightingProfile=1&editorTrace=1`})
 await b.wait('!!window.selectionAudit?.state()?.scene.children.length',60000)
 await b.wait('selectionAudit.candidates().filter(t=>t.kind==="model").length>8',60000)
 await b.wait('!document.querySelector(".viewport-preparing-overlay")',30000)
 // Navigate with trusted editor keyboard and mouse controls. Camera observations are read only.
 await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1050,y:450})
 await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83})
 await pause(3000)
 await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83})
 report.navigation={before:await b.evaluate('selectionAudit.snapshot()')}
 await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x:1050,y:450,button:'right',buttons:2,clickCount:1})
 await b.wait('!!document.pointerLockElement',2000)
 for(let i=0;i<3;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'right',buttons:2});await pause(25)}
 const delta=await b.evaluate(`(()=>{const s=selectionAudit.state(),e=new selectionAudit.Three.Euler().setFromQuaternion(s.camera.quaternion,'YXZ'),d=new selectionAudit.Three.Vector3(6,4,9).sub(s.camera.position).normalize();let yaw=Math.atan2(-d.x,-d.z)-e.y;while(yaw>Math.PI)yaw-=Math.PI*2;while(yaw<-Math.PI)yaw+=Math.PI*2;return{x:-yaw/.002,y:-(Math.asin(d.y)-e.x)/.002,e:e.toArray()}})()`)
 for(let i=1;i<=4;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:delta.x*i/4,y:delta.y*i/4,button:'right',buttons:2});await pause(50)}
 await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1050,y:450,button:'right',buttons:0,clickCount:1})
 report.navigation.after=await b.evaluate('selectionAudit.snapshot()');report.navigation.delta=delta
 report.initial=await b.evaluate('selectionAudit.snapshot()');await shot('initial')
 if(full){report.authoredBefore=await b.evaluate('selectionAudit.authored()');report.identitiesBefore=await b.evaluate('selectionAudit.identities()');report.timeOrigin=await b.evaluate('performance.timeOrigin');await b.call('Tracing.start',{traceConfig:{recordMode:'recordContinuously',traceBufferSizeInKb:8192,includedCategories:['devtools.timeline','blink.user_timing','toplevel']},transferMode:'ReturnAsStream'});await b.call('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1400,maxHeight:900,everyNthFrame:1})}
 save('candidates',await b.evaluate(`({targets:selectionAudit.candidates(),floors:selectionAudit.props('ThreeDView').floors.map(f=>({id:f.id,name:f.name,models:f.models.map(m=>({id:m.id,modelId:m.modelId,name:m.name,position:m.position}))})),body:document.body.innerText,canvas:selectionAudit.state().gl.domElement.getBoundingClientRect().toJSON()})`))
 const points=await b.evaluate(`(()=>{const p=selectionAudit.props('ThreeDView'),models=new Map(p.floors.flatMap(f=>f.models.map(m=>[m.id,m])));return selectionAudit.candidates().filter(t=>t.kind==='model'&&t.z<1&&t.z>0&&t.x>750&&t.x<1380&&t.y>150&&t.y<800&&/window/.test(models.get(t.id)?.modelId)).sort((a,b)=>b.center[0]-a.center[0])})()`)
 const windows=points.filter(p=>['dcca9ce0-c90a-4bb4-8d17-32134b8c2cab','d408b0e9-220b-4f17-8683-b48215a68795'].includes(p.id))
 if(windows.length!==2)throw Error('Both target windows must be visible')
 for(const p of [...windows,...windows,...windows]){
  await step(p,'cold window '+p.id,full?110:180)
 }
 if(full){await pause(250);await b.call('Page.stopScreencast');await b.call('Tracing.end');await shot('cold-selected')}
 for(let i=0;i<(process.argv.includes('--quick')?2:full?70:30);i++){if(await b.evaluate('!selectionAudit.snapshot().warm&&selectionAudit.snapshot().gi?.state==="ready"'))break;await pause(500)}
 report.late=await b.evaluate('selectionAudit.snapshot()')
 for(const p of [...windows,...windows])await step(p,'late window '+p.id)
 if(full){
  const door=await b.evaluate(`selectionAudit.candidates().find(t=>t.id==='bdd5d972-b20d-4971-a387-ca4b53f01cd5')`)
  report.doorCandidate=door
  if(door?.x>710&&door.x<1450){await step({...door,x:Math.min(1390,door.x)},'door');await shot('door');await step(windows[0],'door to window')}
  else {await step(await b.evaluate(`selectionAudit.planModelPoint('bdd5d972-b20d-4971-a387-ca4b53f01cd5')`),'door through plan');await shot('door');await step(windows[0],'door to window')}
  for(const p of [...windows,...windows,...windows])await step(p,'rapid alternating window',20)
  await step({x:windows[1].x+70,y:windows[1].y+35},'wall');await shot('wall');await step(windows[1],'wall to window')
  await step({x:1050,y:100},'empty deselect');await shot('deselected')
  const furniture=await b.evaluate(`selectionAudit.planModelPoint('3fc467b2-f9bc-4f90-a31a-f04a3b6fe969')`)
  await step(furniture,'furniture through plan');await shot('furniture');await step(windows[0],'furniture to window')
  report.authoredAfter=await b.evaluate('selectionAudit.authored()');report.identitiesAfter=await b.evaluate('selectionAudit.identities()')
  report.selectionOnlyUnchanged={authored:digest(report.authoredBefore)===digest(report.authoredAfter),sourceIdentities:digest(report.identitiesBefore)===digest(report.identitiesAfter)}
  report.movingBefore=await b.evaluate('selectionAudit.snapshot()')
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68});await pause(40)
  await step(await b.evaluate(`selectionAudit.candidates().find(t=>t.id===${JSON.stringify(windows[1].id)})`),'selection while moving',0)
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68});await pause(80)
  report.movingAfter=await b.evaluate('selectionAudit.snapshot()')
  for(const p of windows)Object.assign(p,await b.evaluate(`selectionAudit.candidates().find(t=>t.id===${JSON.stringify(p.id)})`))
  // A real saved-geometry edit through the public properties panel.
  if(await b.evaluate('selectionAudit.snapshot().selected')!==windows[1].id)await step(windows[1],'select before edit')
  await control('[aria-label="Object width"]')
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65})
  await b.call('Input.insertText',{text:'1.25'});await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await pause(600)
  report.edit={state:await b.evaluate('selectionAudit.snapshot()'),authored:await b.evaluate('selectionAudit.authored()')};await shot('real-width-edit')
  await step(windows[0],'selection after edit')
  await step({x:windows[1].x+70,y:windows[1].y+35},'wall before material edit')
  await control('[aria-label="Materials"]');await control('[aria-label="Search materials"]')
  await b.call('Input.insertText',{text:'Slate'});await b.wait('!!document.querySelector(".material-tree-item")',4000)
  await control('.material-tree-item');await control('button','Apply material');await control('[aria-label="Materials"]');await pause(600)
  report.materialEdit={state:await b.evaluate('selectionAudit.snapshot()'),authored:await b.evaluate('selectionAudit.authored()')};await shot('material-edit')
  await step(windows[0],'selection after material edit')
  await b.evaluate(`selectionAudit.event('test.failure.inject');selectionAudit.injectFailure()`);await pause(100)
  report.injectedFailure=await b.evaluate('selectionAudit.snapshot()');await step(windows[1],'selection after injected failure');await shot('selection-after-failure')
  // Normal project-menu New boundary while selected.
  await control('[aria-label="Project menu"]');await control('button','New');await pause(1300)
  report.replacement=await b.evaluate('selectionAudit.snapshot()');await shot('replacement')
 }
 await pause(1500);report.final=await b.evaluate('selectionAudit.snapshot()');await shot('final')
}catch(error){process.exitCode=1;report.failure=String(error);console.error(error);await shot('failure').catch(()=>{})}
finally{report.raw=await b.evaluate('({events:selectionAudit?.events,workers:[...sceneEditTrace.workers.values()],tasks:recoveryTasks,body:document.body.innerText,stages:window.editorPreparationEvents})').catch(()=>({}));report.errors=b.errors;report.logs=b.logs;
 if(full){await b.call('Page.stopScreencast').catch(()=>{});await b.call('Tracing.end').catch(()=>{});const result=await Promise.race([trace,pause(1500)]);if(result?.stream){let data='';for(;;){const c=await b.call('IO.read',{handle:result.stream});data+=c.data;if(c.eof)break}writeFileSync(`${out}/trace.json`,data);await b.call('IO.close',{handle:result.stream})}}
 b.close();
 for(const [i,f]of frames.entries()){const buffer=Buffer.from(f.data,'base64');writeFileSync(`${out}/frame-${i}.jpg`,buffer);const {data,info}=await sharp(buffer).raw().toBuffer({resolveWithObject:true});const regions=report.steps.slice(0,2).map(s=>{let blue=0;for(let y=Math.max(0,Math.floor(s.target.y)-20);y<Math.min(info.height,s.target.y+20);y++)for(let x=Math.max(0,Math.floor(s.target.x)-12);x<Math.min(info.width,s.target.x+12);x++){const j=(y*info.width+x)*info.channels;if(data[j+2]>data[j]+20&&data[j+1]>data[j]+8)blue++}return{id:s.target.id,blue}});frames[i]={file:`frame-${i}.jpg`,at:f.metadata.timestamp*1000-report.timeOrigin,metadata:f.metadata,regions}}
 report.frames=frames;save('report',report);console.log(JSON.stringify({initial:report.initial,steps:report.steps.map(s=>({label:s.label,id:s.target.id,before:s.before.selected,after:s.after.selected,generation:[s.before.warmGeneration,s.after.warmGeneration]})),unchanged:report.selectionOnlyUnchanged,failure:report.failure,errors:b.errors}))}
