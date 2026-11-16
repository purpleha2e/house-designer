import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs';
import {existsSync,unlinkSync} from 'node:fs';
import {installRenderLoopPreload,installRenderLoopAudit} from '../tests/browser/renderLoopAuditProbe.mjs';
const out='tmp/springfield-motion';mkdirSync(out,{recursive:true});const report={runs:[]};
// Diagnostic copy only: retain the saved transport to isolate steady-state rendering.
const fixture=JSON.parse(readFileSync('springfield_14.json'));fixture.indirectLighting.captureVisibilityVersion=3;
fixture.indirectLighting.assetKey=JSON.parse(readFileSync('tmp/motion-cache-inspect.json')).result.result.value.a[0].cacheAssetKey;
writeFileSync(out+'/springfield_14.json',JSON.stringify(fixture));
const b=await lightingBrowser();
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})();window.confirm=()=>false;`});
 await b.call('Page.navigate',{url:'http://localhost:4173/?giSH=2'});await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`,30000);
 await b.call('Page.setInterceptFileChooserDialog',{enabled:true});await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`);
 const {root}=await b.call('DOM.getDocument');const {nodeId}=await b.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await b.call('DOM.setFileInputFiles',{nodeId,files:[resolve(out+'/springfield_14.json')]});
 await b.wait(`document.body.innerText.includes('springfield_14')`,30000);
 await b.evaluate(`document.querySelector('.editor-grid').style.gridTemplateColumns='180px 8px minmax(0,1fr)'`);
 for(let i=0;i<150;i++){const state=await b.evaluate(`(()=>{const s=loopFind().state,u=s?.scene.userData;return{phase:u?.progressiveStartup?.phase,warm:u?.shaderWarmupPending,gi:u?.indirectLighting?.state,pending:u?.indirectLighting?.pendingUpdate,scan:u?.indirectScanPending,body:document.body.innerText.slice(-220)}})()`);if(i%10===0)console.log('Preparing',JSON.stringify(state));if(state.phase==='full'&&!state.warm&&!state.scan&&state.gi==='ready'&&!state.pending)break;if(i===149)throw Error('Ready timed out');await new Promise(r=>setTimeout(r,1000))}
 report.hardware=await b.browserCall('SystemInfo.getInfo');report.hardware={gpu:report.hardware.gpu.devices};
 const p=JSON.parse(readFileSync('springfield_14.json'));report.start=await b.evaluate(`(()=>{window.auditModels=${JSON.stringify(Object.fromEntries(p.floors.flatMap(f=>f.models.map(m=>[m.id,{modelId:m.modelId}]))))};return (${installRenderLoopAudit.toString()})()})()`);save();console.log('GPU',JSON.stringify(report.start.graphics));
 for(const name of ['stationary','moving','moving-front-to-back','moving-no-ao','moving-no-shadows','moving-no-gi','moving-no-room-mask']){
  if(name==='moving-front-to-back')await b.evaluate(`loopFind().state.gl.setOpaqueSort((a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||a.z-b.z||a.material.id-b.material.id||a.id-b.id)`);
  if(name==='moving-no-ao')await b.evaluate(`for(const p of loopFind().composer.passes)if(p.configuration&&'aoRadius'in p.configuration)p.enabled=false`);
  if(name==='moving-no-shadows')await b.evaluate(`loopFind().state.gl.shadowMap.autoUpdate=false;loopFind().state.gl.shadowMap.needsUpdate=false`);
  if(name==='moving-no-gi'||name==='moving-no-room-mask')await b.evaluate(`(()=>{const {state:s}=loopFind();s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){const u=s.gl.properties.get(m).uniforms;const v=u?.${name==='moving-no-gi'?'hdGIEnabled':'hdRoomLightEnabled'};if(v)Object.defineProperty(v,'value',{get:()=>0,set:()=>{},configurable:true})}})})()`);
  const r=await b.evaluate(`renderLoopAudit.sample(5000,${name!=='stationary'},false)`);report.runs.push({name,...r});save();console.log('RESULT',JSON.stringify({name,fps:r.fps,cpu:r.composerMs,gpu:r.gpu,counts:r.counts}));
 }
 console.log('AVAILABLE FOR DIAGNOSTIC COMMANDS');
 for(let i=0;i<300;i++){if(existsSync(out+'/exit')){unlinkSync(out+'/exit');break}if(existsSync(out+'/command.js')){const expression=readFileSync(out+'/command.js','utf8');unlinkSync(out+'/command.js');try{writeFileSync(out+'/command-result.json',JSON.stringify(await b.evaluate(expression),null,2))}catch(e){writeFileSync(out+'/command-result.json',String(e))}}await new Promise(r=>setTimeout(r,1000))}
 await b.evaluate(`renderLoopAudit.stop()`);
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/view.png',Buffer.from(shot.data,'base64'));
}catch(e){report.error=String(e);console.log(String(e));process.exitCode=1}finally{report.errors=b.errors;save();b.close()}
