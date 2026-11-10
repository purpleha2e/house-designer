import {lightingBrowser} from './lightingHarness.mjs'
import {installSceneEditPreload} from './sceneEditTrace.js'
import {mkdirSync,writeFileSync} from 'node:fs'
const [port='5260',label='before']=process.argv.slice(2),out=`tmp/selection-cross-floor/${label}`,pause=ms=>new Promise(r=>setTimeout(r,ms))
mkdirSync(out,{recursive:true})
const network=[],b=await lightingBrowser({onEvent:m=>{if(m.method==='Network.requestWillBeSent')network.push({at:m.params.timestamp,url:m.params.request.url.startsWith('data:')?m.params.request.url.slice(0,180)+'?':m.params.request.url,type:m.params.type,initiator:m.params.initiator})}}),report={steps:[]}
const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
const snapshot=`(()=>{const s=selectionAudit.snapshot(),p=selectionAudit.props('ThreeDView'),u=selectionAudit.state().scene.userData;return{...s,activeFloor:p.activeFloorId,all:p.showAllFloors,warmups:u.shaderWarmupProfile?.map(x=>({started:x.startedAt,cancelled:x.cancelled,stages:x.stages})),body:document.body.innerText}})()`
async function shot(name){const r=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
async function mouse({x,y}){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1})}
async function key(code,key,ms){await b.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});await pause(ms);await b.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})}
async function look(target){await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x:1050,y:450,button:'right',buttons:2,clickCount:1});await b.wait('!!document.pointerLockElement',2000);for(let i=0;i<3;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'right',buttons:2});await pause(25)}
 const delta=await b.evaluate(`(()=>{const s=selectionAudit.state(),e=new selectionAudit.Three.Euler().setFromQuaternion(s.camera.quaternion,'YXZ'),d=new selectionAudit.Three.Vector3(...${JSON.stringify(target)}).sub(s.camera.position).normalize();let y=Math.atan2(-d.x,-d.z)-e.y;while(y>Math.PI)y-=Math.PI*2;while(y<-Math.PI)y+=Math.PI*2;return{x:-y/.002,y:-(Math.asin(d.y)-e.x)/.002}})()`)
 for(let i=1;i<=4;i++){await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:delta.x*i/4,y:delta.y*i/4,button:'right',buttons:2});await pause(50)}await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1050,y:450,button:'right',buttons:0,clickCount:1})
}
try{
 await b.call('Network.enable');await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installSceneEditPreload.toString()})({devtools:true});`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/selectionRecovery.html?lightingProfile=1&editorTrace=1`})
 await b.wait('!!window.selectionAudit?.state()?.scene.children.length',60000);await b.wait('!document.querySelector(".viewport-preparing-overlay")',30000)
 await b.evaluate(`(()=>{let last='';new MutationObserver(()=>{const message=document.querySelector('.viewport-engine-status')?.textContent;if(message&&message!==last){last=message;selectionAudit.event('status.display',{message})}}).observe(document.body,{subtree:true,childList:true,characterData:true})})()`)
 await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1050,y:450});await key('KeyS','s',3000)
 const p=await b.evaluate('selectionAudit.state().camera.position.toArray()');await look([p[0],p[1],p[2]+10]);await key('KeyD','d',5000);await look([2.5,3,7])
 report.initial=await b.evaluate(snapshot);report.authoredBefore=await b.evaluate('selectionAudit.authored()');report.identitiesBefore=await b.evaluate('selectionAudit.identities()');save('candidates',await b.evaluate('selectionAudit.candidates()'));await shot('initial')
 const ids=['bdd5d972-b20d-4971-a387-ca4b53f01cd5','f0c759c1-c5c4-4799-a13e-cf2210f19938']
 async function sequence(phase){for(const id of [...ids,...ids]){const target=await b.evaluate(`selectionAudit.candidates().find(t=>t.id===${JSON.stringify(id)})`);if(!target||target.x<710||target.x>1395||target.y<50||target.y>810)throw Error('Target offscreen: '+id+' '+JSON.stringify(target));const before=await b.evaluate(snapshot);await b.evaluate(`selectionAudit.event('test.cross-floor',{id:${JSON.stringify(id)},phase:${JSON.stringify(phase)}})`);await mouse(target);await pause(350);const after=await b.evaluate(snapshot);report.steps.push({phase,id,target,before,after});await shot(`${phase}-${report.steps.length}`)}}
 await sequence('early')
 for(let i=0;i<(process.argv.includes('--quick')?0:50);i++){if(await b.evaluate('!selectionAudit.snapshot().warm&&selectionAudit.snapshot().gi?.state==="ready"'))break;await pause(500)}
 report.later=await b.evaluate(snapshot);await sequence('later');report.final=await b.evaluate(snapshot)
 report.authoredAfter=await b.evaluate('selectionAudit.authored()');report.identitiesAfter=await b.evaluate('selectionAudit.identities()')
}catch(error){report.failure=String(error);process.exitCode=1;await shot('failure').catch(()=>{})}
finally{report.raw=await b.evaluate('({events:selectionAudit.events,workers:[...sceneEditTrace.workers.values()],stages:window.editorPreparationEvents})').catch(error=>({error:String(error)}));report.network=network;report.errors=b.errors;save('report',report);console.log(JSON.stringify({failure:report.failure,initial:report.initial&&{camera:report.initial.camera,all:report.initial.all},steps:report.steps.map(s=>({id:s.id,phase:s.phase,selected:s.after.selected,floor:s.after.activeFloor,loading:s.after.body.includes('Loading models and textures'),gi:s.after.gi?.generation,warm:s.after.warmGeneration})),errors:b.errors}));b.close()}
