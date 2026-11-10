import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/giBarrierRegression.html`});await b.wait('!!window.runBarrierRegression')
 const result=await b.evaluate('runBarrierRegression()');assert.equal(result.glError,0);assert.deepEqual(b.errors,[])
 writeFileSync('docs/gi-barrier-filtering/gpu-regressions.json',JSON.stringify(result,null,2));console.log('PASS GPU reconstruction:',result.results.length,'geometry cases × legacy/A/B, including inter-storey blending')
 const cancellation=await b.evaluate('runBarrierCancellation()');writeFileSync('docs/gi-barrier-filtering/cancellation.json',JSON.stringify(cancellation,null,2));console.log('PASS rapid edit generations:',JSON.stringify(cancellation))
 const switching=await b.evaluate('runBarrierCachedPrograms()');writeFileSync('docs/gi-barrier-filtering/cached-programs.json',JSON.stringify(switching,null,2));assert.deepEqual(b.errors,[]);console.log('PASS cached PBR program switching')
}finally{b.close()}
