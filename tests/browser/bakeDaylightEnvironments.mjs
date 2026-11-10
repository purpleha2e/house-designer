// Regenerates linear PMREM bases from the shared analytic sky. No model data.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/bakeDaylightEnvironments.html`});await b.wait('!!window.bakedDaylightEnvironments')
  const result=await b.evaluate('bakedDaylightEnvironments');assert.equal(result.glError,0);assert.deepEqual(b.errors,[])
  for(const [name,value]of Object.entries(result.data)){
    assert.equal(value.width,336);assert.equal(value.height,256)
    const raw=Buffer.from(value.base64,'base64'),packed=gzipSync(raw,{level:9});writeFileSync(`src/assets/environments/daylight-${name}.bin.gz`,packed)
    console.log(JSON.stringify({name,bytes:raw.length,compressedBytes:packed.length}))
  }
}finally{b.close()}
