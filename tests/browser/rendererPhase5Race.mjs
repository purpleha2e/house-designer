import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installBoundedAudit} from './rendererPhase5Native.js'
const b=await lightingBrowser()
try{
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installBoundedAudit.toString()})(false)`})
  const label=process.argv[2]??'after-verified',reference=label.includes('before')
  await b.call('Page.navigate',{url:`http://127.0.0.1:5202/tests/browser/rendererPhase5Race.html?${reference?'reference&':''}${label.includes('pipeline')?'pipeline&':''}${label.endsWith('gc')?'gc':''}`})
  if(label.endsWith('gc'))for(let i=0;i<4;i++){
    await b.wait(`window.phase5RaceWaitingGC===${i}`,15000)
    await b.call('HeapProfiler.collectGarbage');await b.evaluate('phase5RaceResume()')
  }
  await b.wait('window.phase5Race?.finished',15000)
  const result=await b.evaluate('phase5Race');result.errors=b.errors
  writeFileSync(`tmp/renderer-phase5/race-${process.argv[2]??'before'}.json`,JSON.stringify(result,null,2));console.log(result)
  assert.deepEqual(result.counts.map(r=>r.geometries),reference?[2,3,4]:[1,1,1]);assert.deepEqual(result.counts.map(r=>r.error),[0,0,0]);assert.deepEqual(b.errors,[])
  if(!reference){assert.equal(result.afterOwnerDisposal.geometries,0);assert.equal(result.afterOwnerDisposal.native[0].buffers.actual,0)}
}finally{b.close()}
