// Full-house regression for publication of edits and exact restorations.
// No recovery remounts, retries, GL readbacks, or production diagnostic hooks.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installSceneEditPreload} from './sceneEditTrace.js'
const port=process.argv[2]??'5191',out=process.argv[3]??'tmp/scene-edit-stalls',report={steps:[]},b=await lightingBrowser()
mkdirSync(out,{recursive:true})
const save=()=>writeFileSync(`${out}/regression.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function steady(){
 const a=await b.evaluate('sceneEditTrace.snapshot()')
 await b.evaluate('new Promise(resolve=>{let left=180;const tick=()=>--left?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick)})')
 const z=await b.evaluate('sceneEditTrace.snapshot()'),submissions=z.render.houseSubmissions-a.render.houseSubmissions
 return{durationMs:z.at-a.at,frames:z.health.frames-a.health.frames,houseSubmissions:submissions,houseCpuMsPerSubmission:(z.render.houseCpuMs-a.render.houseCpuMs)/submissions,geometries:z.health.geometries,textures:z.health.textures,programs:z.programs}
}
async function image(label){
 const clip=await b.evaluate(`(()=>{const r=rendererRecovery.state().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
 const shot=await b.call('Page.captureScreenshot',{format:'png',clip});const png=Buffer.from(shot.data,'base64');writeFileSync(`${out}/regression-${label}.png`,png);return png
}
async function applied(label,command,predicate){
 const before=await b.evaluate('sceneEditTrace.snapshot()'),at=Date.now();await b.evaluate(`sceneEditTrace.mark(${JSON.stringify(label)},{command:${JSON.stringify(command)}});${command}`)
 let state,ok=false
 while(Date.now()-at<60000){const observation=await b.evaluate(`(()=>{const applied=(${predicate});return{applied,state:sceneEditTrace.snapshot()}})()`);state=observation.state;if(observation.applied){ok=true;break}await pause(100)}
 report.steps.push({label,command,elapsedMs:Date.now()-at,applied:ok,before,state});save();console.log('REGRESSION',label,Date.now()-at,ok)
 assert.ok(ok,label+' must reach the committed scene without a remount');assert.equal(state.health.canvas.connected,true);assert.equal(state.health.lost,false);assert.ok(!state.warmFailure)
}
try{
 const response=await fetch(`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html`,{signal:AbortSignal.timeout(5000)});assert.ok(response.ok)
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installSceneEditPreload.toString()})({devtools:false})`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererAudit=1&rendererShadows=single&view=building`})
 await b.wait(`(()=>{const s=window.rendererRecovery?.state();return s?.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending&&s.gl.domElement.isConnected})()`,240000)
 report.initial=await b.evaluate(`(async()=>{const m=await import('/tests/browser/sceneEditTrace.js');return m.installSceneEditTrace(rendererRecovery.state())})()`)
 await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(style)})()`)
 report.steadyBefore=await steady()
 const before=await image('before'),sun=report.initial.oldPredicate.sun.azimuth,position=report.initial.physical.sun.position
 for(let i=0;i<3;i++){
  await applied('sun change '+i,'rendererRecovery.testSun(true)',`Math.abs(sceneEditTrace.snapshot().oldPredicate.sun.azimuth-(${sun}))>.01&&!rendererRecovery.state().scene.userData.shaderWarmupPending`)
  await applied('sun restore '+i,'rendererRecovery.testSun(false)',`(()=>{const v=sceneEditTrace.snapshot();return Math.abs(v.oldPredicate.sun.azimuth-(${sun}))<1e-10&&v.physical.sun.position.every((n,i)=>Math.abs(n-${JSON.stringify(position)}[i])<1e-7)&&!v.warm})()`)
  await applied('furniture add '+i,'rendererRecovery.testFurniture(true)',`(()=>{const v=sceneEditTrace.snapshot();return v.oldPredicate.temporary&&v.physical.temporary&&!v.warm})()`)
  await applied('furniture remove '+i,'rendererRecovery.testFurniture(false)',`(()=>{const v=sceneEditTrace.snapshot();return !v.oldPredicate.temporary&&!v.physical.temporary&&!v.warm})()`)
  await applied('finish change '+i,'rendererRecovery.testFinish(true)',`(()=>{const v=sceneEditTrace.snapshot();return v.oldPredicate.finish&&!v.warm})()`)
  await applied('finish restore '+i,'rendererRecovery.testFinish(false)',`(()=>{const v=sceneEditTrace.snapshot();return !v.oldPredicate.finish&&!v.warm})()`)
 }
 await applied('superseded furniture edits',`(async()=>{rendererRecovery.testFurniture(true);await new Promise(requestAnimationFrame);rendererRecovery.testFurniture(false);await new Promise(requestAnimationFrame);rendererRecovery.testFurniture(true);await new Promise(requestAnimationFrame);rendererRecovery.testFurniture(false)})()`,`(()=>{const v=sceneEditTrace.snapshot();return !v.oldPredicate.temporary&&!v.physical.temporary&&!v.warm&&v.current.flatMap(r=>r.components).filter(c=>c.name==='ThreeDView').every(c=>!c.publicationPending)})()`)
 report.steadyAfter=await steady()
 const after=await image('after'),a=await sharp(before).ensureAlpha().raw().toBuffer({resolveWithObject:true}),z=await sharp(after).ensureAlpha().raw().toBuffer(),diff=Buffer.alloc(z.length)
 let changedPixels=0,max=0,sum=0
 for(let i=0;i<z.length;i+=4){let changed=false;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-z[i+c]);changed||=d>0;max=Math.max(max,d);sum+=d;diff[i+c]=Math.min(255,d*16)}changedPixels+=Number(changed);diff[i+3]=255}
 await sharp(diff,{raw:a.info}).png().toFile(`${out}/regression-diff.png`)
 report.imageDifference={changedPixels,maxChannelError:max,meanAbsoluteError:sum/(z.length/4*3)}
 report.final=await b.evaluate('sceneEditTrace.snapshot()');report.events=await b.evaluate('sceneEditTrace.events');await b.evaluate('sceneEditTrace.stop()');save()
 assert.deepEqual(b.errors,[]);assert.equal(changedPixels,0,'exact restoration must preserve the same-camera displayed image')
}catch(error){report.failure=String(error);try{report.events=await b.evaluate('window.sceneEditTrace?.events')}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
