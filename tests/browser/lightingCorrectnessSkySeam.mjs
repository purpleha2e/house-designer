import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),before=process.argv.includes('--expect-defect')
try{
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/lightingCorrectnessSkySeam.html`});await b.wait('!!window.skySeamResult')
 const r=await b.evaluate('skySeamResult');assert.ok(!r.error,JSON.stringify(r));assert.equal(r.glError,0);assert.deepEqual(b.errors,[])
 mkdirSync('docs/lighting-correctness/sky-seam',{recursive:true});writeFileSync(`docs/lighting-correctness/sky-seam/${before?'before':'after'}.json`,JSON.stringify(r,null,2))
 if(before)assert.ok(r.maxError>.1,'reproduce missing diagnostic sky seam blend');else assert.ok(r.maxError<.002,'diagnostic sky must use production seam reconstruction')
 console.log(before?'REPRODUCED diagnostic sky seam error':'PASS diagnostic sky seam',r.maxError)
}finally{b.close()}
