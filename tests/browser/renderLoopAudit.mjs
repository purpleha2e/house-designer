import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {lightingBrowser} from './lightingHarness.mjs'
import {installRenderLoopPreload,installRenderLoopAudit} from './renderLoopAuditProbe.mjs'
const out=process.argv[2]??'tmp/viewport-fps/render-loop',report={started:new Date().toISOString(),runs:[],errors:[]}
mkdirSync(out,{recursive:true})
const save=()=>writeFileSync(out+'/audit.json',JSON.stringify(report,null,2))
const b=await lightingBrowser({uncapped:true})
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1924,height:1049,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})()`})
 await b.call('Page.navigate',{url:'http://localhost:4173/'})
 for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,1000));const v=await b.evaluate(`(()=>{const {state:s,composer:c}=loopFind();return {body:document.body.innerText.slice(0,600),url:location.href,roots:loopPreload.hook.roots.size,renderers:loopPreload.hook.renderers.size,phase:s?.scene.userData.progressiveStartup?.phase,warm:s?.scene.userData.shaderWarmupPending,gi:s?.scene.userData.indirectLighting?.state,composer:!!c,body:document.body.innerText.slice(-300)}})()`);if(i%15===0)console.log('PREPARING',JSON.stringify(v));if(b.errors.length)throw Error(b.errors.join('\n'));if(i>8&&v?.phase==='full'&&v?.warm===false&&v?.gi==='ready'&&v.composer)break;if(i===149)throw Error('Readiness timeout')}
 report.bundle=await b.evaluate(`[...document.scripts].map(s=>s.src).filter(s=>s.includes('/assets/index-'))`)
 report.bundleSha256=createHash('sha256').update(readFileSync('dist/assets/'+report.bundle[0].split('/').at(-1))).digest('hex')
 const project=JSON.parse(readFileSync('colin_house_v2.json','utf8'));const models=Object.fromEntries(project.floors.flatMap(f=>(f.models??[]).map(m=>[m.id,{modelId:m.modelId}])))
 report.initial=await b.evaluate(`(()=>{window.auditModels=${JSON.stringify(models)};const {state:s}=loopFind();s.camera.position.set(-10,9,-11);s.camera.lookAt(4,3,8);s.camera.updateMatrixWorld(true);return(${installRenderLoopAudit.toString()})()})()`)
 await new Promise(r=>setTimeout(r,12000))
 report.settled=await b.evaluate('renderLoopAudit.snapshot()')
 report.inventory=await b.evaluate('renderLoopAudit.inventory')
 for(const [moving,detailed]of [[false,false],[true,false],[true,false],[false,false],[false,true],[true,true]]){console.log('SAMPLING',JSON.stringify({moving,detailed}));const result=await b.evaluate(`renderLoopAudit.sample(${detailed?5000:10000},${moving},${detailed})`);report.runs.push(result);save();console.log('RESULT',JSON.stringify({fps:result.fps,composer:result.composerMs,gpu:result.gpu,frames:result.frames}))}
 // Remove the detailed wrappers before CPU profiling so their dispatch overhead
 // cannot be mistaken for application work. Keep only the composer timer.
 await b.evaluate(`(()=>{renderLoopAudit.stop();window.auditMinimal=async(ms,moving)=>{const {state:s,composer:c}=loopFind(),position=s.camera.position.clone(),rotation=s.camera.quaternion.clone(),original=c.render;let frames=0,active=true,last;const times=[],intervals=[],at=performance.now();c.render=function(...a){const t=performance.now();if(last!==undefined)intervals.push(t-last);last=t;try{return original.apply(this,a)}finally{times.push(performance.now()-t);frames++}};const tick=()=>{if(!active)return;if(moving){const t=(performance.now()-at)/1000;s.camera.position.copy(position);s.camera.position.x+=Math.sin(t*.8)*.25;s.camera.position.z+=Math.cos(t*.8)*.25;s.camera.quaternion.copy(rotation);s.camera.rotateY(Math.sin(t*.5)*.15);s.camera.updateMatrixWorld()}requestAnimationFrame(tick)};if(moving)requestAnimationFrame(tick);try{await new Promise(r=>setTimeout(r,ms))}finally{active=false;c.render=original;s.camera.position.copy(position);s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld()}return{frames,ms:performance.now()-at,composerMs:times.reduce((a,b)=>a+b,0)/times.length,intervalMs:intervals.reduce((a,b)=>a+b,0)/intervals.length}}})()`)
 report.minimal=[]
 for(const moving of [false,true]){report.minimal.push({moving,...await b.evaluate(`auditMinimal(10000,${moving})`)});await b.call('Profiler.enable');await b.call('Profiler.setSamplingInterval',{interval:500});await b.call('Profiler.start');await b.evaluate(`auditMinimal(6000,${moving})`);const {profile}=await b.call('Profiler.stop');await b.call('Profiler.disable');writeFileSync(out+'/'+(moving?'moving':'still')+'.cpuprofile',JSON.stringify(profile));console.log('PROFILE',moving);save()}
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/view.png',Buffer.from(shot.data,'base64'))
 report.final=await b.evaluate('renderLoopAudit.snapshot()')
}catch(e){report.errors.push(String(e));throw e}finally{report.browserErrors=b.errors;save();b.close()}

