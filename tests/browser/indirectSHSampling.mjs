import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/indirectSHSampling.html`});await b.wait('!!window.indirectSHSamplingResult',180000);const r=await b.evaluate('indirectSHSamplingResult');assert.ok(!r.error,JSON.stringify(r));assert.equal(r.glError,0);assert.ok(r.maxError<.003,JSON.stringify(r));assert.deepEqual(b.errors,[]);writeFileSync('docs/gi-directional-diagnostics/gpu-sh-sampling.json',JSON.stringify(r,null,2));console.log('PASS GPU/CPU L1 and L2 volume, floor and packed diagnostic sky sampling',JSON.stringify(r))}finally{b.close()}
