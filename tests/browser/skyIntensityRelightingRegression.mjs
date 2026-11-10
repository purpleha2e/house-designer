import {lightingBrowser} from './lightingHarness.mjs'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const b=await lightingBrowser(),report=[]
try{await b.call("Log.enable");for(const query of ['sky&static&sun&size16','sky&static&sun&size16&overcast','static&sun&size16','static&night-surface']){
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/skyIntensityRelightingRegression.html?'+query});await b.wait('!!window.surfaceRelightingResult');const r=await b.evaluate('surfaceRelightingResult');report.push({query,...r,errors:b.errors,logs:b.logs});fs.writeFileSync('docs/sky-intensity/gpu-relighting-tests.json',JSON.stringify(report,null,2));assert.equal(r.error,undefined);assert.equal(r.glError,0);for(const row of r.results){assert.ok(row.max<=.005+row.peak*.01,JSON.stringify(row));assert.ok(row.secondBounce<=.005+row.peak*.01,JSON.stringify(row))}console.log('PASS',query,'max',Math.max(...r.results.map(r=>r.max)))}assert.deepEqual(b.errors,[])}finally{b.close()}
