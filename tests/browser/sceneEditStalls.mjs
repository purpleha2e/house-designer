import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installSceneEditPreload} from './sceneEditTrace.js'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const [operation='sun',port='5191',timing='immediate',observer='plain',label='']=process.argv.slice(2)
if(!['sun','furniture','finish'].includes(operation))throw Error('Expected sun, furniture or finish')
const folder='tmp/scene-edit-stalls';mkdirSync(folder,{recursive:true})
const b=await lightingBrowser(),report={operation,timing,observer,started:new Date().toISOString(),samples:[]},pause=ms=>new Promise(r=>setTimeout(r,ms))
const save=()=>writeFileSync(`${folder}/${operation}-${timing}-${observer}${label?'-'+label:''}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
const snapshot=()=>b.evaluate('sceneEditTrace.snapshot()')
try{
 const server=await fetch(`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html`,{signal:AbortSignal.timeout(5000)})
 if(!server.ok)throw Error('Audit fixture unavailable: '+server.status)
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installSceneEditPreload.toString()})({devtools:${observer==='devtools'}})`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererAudit=1&sceneEditTrace=1&view=building`})
 await b.wait(`(()=>{const s=window.rendererRecovery?.state();return s?.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending&&s.gl.domElement.isConnected})()`,240000)
 report.initial=await b.evaluate(`(async()=>{const {installSceneEditTrace}=await import('/tests/browser/sceneEditTrace.js');return installSceneEditTrace(rendererRecovery.state())})()`);save();console.log('READY',operation)
 const method={sun:'testSun',furniture:'testFurniture',finish:'testFinish'}[operation]
 for(const [stage,change,duration]of [['forward',true,12000],['restore',false,62000]]){
  report.command=`rendererRecovery.${method}(${change})`
  await b.evaluate(`sceneEditTrace.mark('${stage}',{command:${JSON.stringify(report.command)}});${report.command}`)
  const start=Date.now();let logged=0
  while(Date.now()-start<duration){const at=Date.now(),state=await snapshot();report.samples.push({stage,elapsedMs:Date.now()-start,evaluationMs:Date.now()-at,state});if(Date.now()-logged>10000){logged=Date.now();console.log('STATE',operation,stage,JSON.stringify({elapsed:Date.now()-start,old:state.oldPredicate,physical:state.physical,gi:{generation:state.gi.generation,blocked:state.gi.blocked},warm:state.warm,mainRenders:state.render.mainRenders,commits:state.commits}));save()}const observed=operation==='sun'?state.oldPredicate.sun?.azimuth!==report.initial.oldPredicate.sun?.azimuth:operation==='furniture'?state.oldPredicate.temporary:state.oldPredicate.finish;if(stage==='forward'&&timing==='immediate'&&observed&&!state.warm&&!state.gi.blocked)break;await pause(250)}
 }
 report.final=await snapshot();report.events=await b.evaluate('sceneEditTrace.events');await b.evaluate('sceneEditTrace.stop()');save()
 assert.deepEqual(b.errors,[])
}catch(error){report.failure=String(error);try{report.events=await b.evaluate('sceneEditTrace.events')}catch{}save();console.error(error);process.exitCode=1}finally{b.close()}
