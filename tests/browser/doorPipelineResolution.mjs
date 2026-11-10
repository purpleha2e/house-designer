import fs from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/indirectSHSampling.html'})
 const result=await b.evaluate(`(async()=>{const m=await import('/tests/browser/doorPipelineResolution.ts');return m.doorResolution()})()`)
 fs.writeFileSync('docs/door-pipeline/resolution.json',JSON.stringify(result));console.log(result.results.map(r=>({step:r.step,probes:r.probeCount,ms:r.elapsedMs})))
 if(result.glError||b.errors.length)throw Error(JSON.stringify({glError:result.glError,errors:b.errors}))
}finally{b.close()}
