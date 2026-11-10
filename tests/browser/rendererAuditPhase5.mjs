import {installBoundedAudit} from './rendererPhase5Native.js'
import {writeFileSync,mkdirSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
const label=process.argv[2]??'before',port=process.argv[3]??'5202',out='tmp/renderer-phase5'
mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={label,started:new Date().toISOString(),samples:[]}
const save=()=>writeFileSync(`${out}/${label}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function settle(){
  const at=Date.now();let stable=0
  while(Date.now()-at<60000){
    const s=await b.evaluate(`(()=>{const s=window.rendererRecovery?.state();if(!s)return null;window.phase5?.install(s);const u=s.scene.userData;return{phase:u.progressiveStartup?.phase,warm:u.shaderWarmupPending,preparation:u.viewportPreparation,scan:u.indirectScanPending}})()`)
    if(b.errors.length)throw Error(b.errors.join('\n'))
    if(s?.phase==='full'&&!s.warm&&!s.scan&&!s.preparation?.pending){if(++stable>=4)return s}else stable=0
    await pause(300)
  }
  throw Error('Short diagnostic preparation deadline reached')
}
async function sample(name){
  await b.call('HeapProfiler.collectGarbage')
  const s=await b.evaluate(`({name:${JSON.stringify(name)},...phase5.snapshot(rendererRecovery.state()),native:phase5NativeSnapshot(),trace:phase5NativeTrace()})`)
  report.samples.push(s);save();console.log(name,JSON.stringify({three:s.three,native:s.native,tracked:s.geometries.length}))
}
try{
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installBoundedAudit.toString()})()`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererShadows=single&rendererShadowSize=2048&phase5`})
  await settle();await sample('initial')
  if(label.includes('overlap')){
    await b.evaluate('rendererRecovery.installAudit().then(a=>window.rendererAudit=a)')
    await b.evaluate('rendererAudit.configure({})')
    // Four paced frames exercise the original audit hooks and camera path.
    await b.evaluate('rendererAudit.sample(750,true)')
    await sample('audit-installed')
    await b.evaluate(`phase5.setOperation('overlap');phase5Operation='overlap';rendererRecovery.testFurniture(true);setTimeout(()=>rendererRecovery.testFinish(true),40);setTimeout(()=>rendererRecovery.testFurniture(false),100);setTimeout(()=>rendererRecovery.testFinish(false),160)`)
    await pause(1000);await settle();await sample('overlap-restored')
    await b.evaluate(`phase5.setOperation('walk');rendererRecovery.setView('walk')`)
    await settle();await sample('walk')
    await b.evaluate(`phase5.setOperation('building');rendererRecovery.setView('building')`)
    await settle();await sample('building-again')
  }
  const original=[['sun-change','testSun(true)'],['sun-restore','testSun(false)'],['furniture-add','testFurniture(true)'],['furniture-remove','testFurniture(false)'],['finish-change','testFinish(true)'],['finish-restore','testFinish(false)']]
  const actions=label.includes('production')?[...original,...original.map(([n,e])=>[n+'-repeat',e]),['openings-change','testOpenings(true)'],['openings-restore','testOpenings(false)']]:[['sun-change','testSun(true)'],['sun-restore','testSun(false)'],['finish-change','testFinish(true)'],['finish-restore','testFinish(false)'],['furniture-add','testFurniture(true)'],['furniture-remove','testFurniture(false)'],['move','testTransforms(true)'],['move-restore','testTransforms(false)']]
  for(const [name,expression] of label.includes('overlap')?[]:actions){
    await b.evaluate(`phase5Operation=${JSON.stringify(name)};phase5.setOperation(phase5Operation);rendererRecovery.${expression}`)
    await pause(600);await settle();await sample(name)
  }
  if(label==='validation'){
    for(const [name,expression]of [['openings-change','testOpenings(true)'],['openings-restore','testOpenings(false)'],['no-op-sun','testSun(false)'],['revision-only','testRevision()'],['walk','setView("walk")'],['building-again','setView("building")']]){
      await b.evaluate(`phase5Operation=${JSON.stringify(name)};phase5.setOperation(phase5Operation);rendererRecovery.${expression}`)
      await pause(600);await settle();await sample(name)
    }
    await b.evaluate('rendererRecovery.setVisible(false)');await pause(800)
    report.beforeRemount=await b.evaluate('phase5NativeSnapshot()');save()
    await b.evaluate('rendererRecovery.setVisible(true)');await settle();await sample('remounted')
  }
  await b.evaluate('rendererRecovery.setVisible(false)');await pause(800)
  report.disposal=await b.evaluate('phase5NativeSnapshot()');save()
}catch(error){report.failure=String(error.stack??error);save();throw error}
finally{b.close()}
