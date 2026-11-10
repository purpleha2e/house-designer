import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),out=process.argv[3]??'docs/gi-directional-diagnostics/replay-regression'
mkdirSync(out,{recursive:true})
try{
 for(const order of [1,2]){
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/indirectSurfaceRelightingRegression.html?static&sun&size16&giSH=${order}`})
  await browser.wait('!!window.surfaceRelightingResult',240000)
  const result=await browser.evaluate('surfaceRelightingResult')
  writeFileSync(`${out}/l${order}.json`,JSON.stringify(result,null,2))
  assert.ok(!result.error,JSON.stringify(result));assert.equal(result.glError,0);assert.equal(result.relighting,true);assert.ok(result.occlusion.max>.001,'the reference must actually exercise occlusion')
  for(const sample of result.results){assert.ok(sample.max<=.005+sample.peak*.01,JSON.stringify(sample));assert.ok(sample.secondBounce<=.005+sample.peak*.01,JSON.stringify(sample))}
  console.log(`PASS L${order} cached replay, all bands, sun, occlusion, moved lamps and emission`)
 }
 assert.deepEqual(browser.errors,[])
}finally{browser.close()}
