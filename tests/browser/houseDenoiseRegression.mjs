import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser({onEvent:event=>{
 if(event.method==='Runtime.consoleAPICalled') console.log(event.params.args.map(a=>a.value??a.description).join(' '))
}})
try{
 await browser.call('Page.navigate',{url:(process.argv[2]??'http://127.0.0.1:5188')+'/tests/browser/houseDenoiseFixture.html'})
 await browser.wait('window.denoiseResult || window.denoiseFailure',240000)
 const {result,error}=await browser.evaluate('({result:window.denoiseResult,error:window.denoiseFailure})')
 assert.equal(error,undefined)
 assert.ok(result.noiseRatio<.55,JSON.stringify(result))
 assert.ok(result.hdrMean>2.2&&result.hdrMean<2.8,JSON.stringify(result))
 assert.equal(result.cancelled,true)
 assert.equal(result.saveBefore,false)
 assert.equal(result.finished.phase,'complete')
 assert.equal(result.finished.denoising.complete,true)
 assert.equal(result.rawUnchanged,true)
 assert.equal(result.repeatMatches,true)
 assert.equal(result.imagesDiffer,true)
 assert.equal(result.denoisingStatus,true)
 console.log(JSON.stringify(result,null,2))
}finally{browser.close()}
