import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/giPhysics.html?giSH=1'})
 await b.wait('!!window.giPhysics')
 const result=await b.evaluate(`import('/tests/browser/ceilingExteriorSky.ts').then(m=>m.ceilingExteriorSky())`)
 fs.writeFileSync(`docs/ceiling-transport/exterior-sky-unit${process.argv.includes('--expect-old-failure')?'-before':''}.json`,JSON.stringify(result,null,2))
 assert.equal(result.glError,0);assert.deepEqual(b.errors,[])
 if(process.argv.includes('--expect-old-failure'))assert.ok(result.maxError>1,'Original shader must demonstrate the missing sky')
 else assert.ok(result.maxError<1e-5,'Exterior capture must receive the analytic sky, without illuminating indoor faces or roof undersides')
 console.log('exterior sky regression',result.maxError)
}finally{b.close()}
