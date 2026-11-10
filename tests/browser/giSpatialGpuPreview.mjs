import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),results=[]
try{
 for(const mode of ['legacy','occluder-local']){
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/indirectGpuPreviewRegression.html?giSpatial=${mode}`});await b.wait('!!window.gpuPreviewResult')
  const r=await b.evaluate('gpuPreviewResult');assert.ok(!r.error,JSON.stringify(r));assert.equal(r.glError,0);assert.equal(r.mode,mode);if(mode==='occluder-local')assert.ok(r.localCells>0)
  results.push(r);console.log('PASS GPU preview',mode,JSON.stringify(r.results))
 }
 assert.deepEqual(b.errors,[]);writeFileSync('docs/gi-spatial-accuracy/gpu-preview.json',JSON.stringify(results,null,2))
}finally{b.close()}
