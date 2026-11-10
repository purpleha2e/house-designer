import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),results=[]
try{
 for(const order of [1,2]){
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe&giSH=${order}`});await b.wait('!!window.probeDaylight?.bootstrapCheck')
  const r=await b.evaluate('probeDaylight.bootstrapCheck()');results.push(r);writeFileSync('docs/gi-directional-diagnostics/surface-bootstrap-equivalence.json',JSON.stringify(results,null,2))
  assert.equal(r.glError,0);assert.equal(r.baseline.status.fullPassPublications,6);assert.equal(r.candidate.status.fullPassPublications,6);assert.equal(r.candidate.status.surfaceBootstrappedProbes,4);assert.deepEqual(r.baseline.dropped,r.candidate.dropped);assert.ok(r.maxError<.003,JSON.stringify(r));assert.ok(r.maxChannelDelta<=1,JSON.stringify(r));assert.ok(r.cancellation.interrupted&&r.cancellation.delayed,JSON.stringify(r));assert.ok(r.cancellation.generationAfter>r.cancellation.generationBefore);assert.ok(r.cancellation.maxError<.003,JSON.stringify(r));console.log('PASS bootstrap L'+order,JSON.stringify({maxError:r.maxError,different:r.different,values:r.values,maxChannelDelta:r.maxChannelDelta,changedChannels:r.changedChannels,baselineMs:r.baseline.elapsedMs,candidateMs:r.candidate.elapsedMs}))
 }
 assert.deepEqual(b.errors,[])
}finally{b.close()}
