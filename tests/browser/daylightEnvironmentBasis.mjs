import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/daylightEnvironmentBasis.html`});await b.wait('!!window.daylightEnvironmentBasis')
  const result=await b.evaluate('daylightEnvironmentBasis');mkdirSync('docs/gi-kitchen-diagnostics/sky-basis',{recursive:true});writeFileSync('docs/gi-kitchen-diagnostics/sky-basis/results.json',JSON.stringify(result,null,2))
  assert.equal(result.glError,0);for(const row of result.results)assert.ok(row.maxAbsoluteError<.003,JSON.stringify(row));assert.deepEqual(b.errors,[])
  console.log('PASS offline sky/ground bases match every full GPU-filtered PMREM texel',JSON.stringify(result.results))
}finally{b.close()}
