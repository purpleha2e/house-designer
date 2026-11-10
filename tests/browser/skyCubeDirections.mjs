import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/skyCubeDirections.html`});await b.wait('!!window.skyCubeDirections')
  const data=await b.evaluate('skyCubeDirections');writeFileSync('tmp/sky-cube-directions.json',JSON.stringify(data,null,2))
  assert.equal(data.glError,0);for(const row of data.rows)row.actual.forEach((v,c)=>assert.ok(Math.abs(v-row.expected[c])<.008,JSON.stringify(row)))
  assert.deepEqual(b.errors,[]);console.log('PASS clear/overcast GPU cube radiance agrees with the transport sky in all six face directions')
}finally{b.close()}
