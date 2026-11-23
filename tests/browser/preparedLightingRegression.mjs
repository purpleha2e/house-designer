import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser=await lightingBrowser()
try {
 await browser.call('Page.navigate',{url:(process.argv[2]??'http://127.0.0.1:5188')+'/tests/browser/preparedLightingFixture.html'})
 await browser.wait('window.preparedResult || window.preparedFailure')
 const result=await browser.evaluate('({result:window.preparedResult,error:window.preparedFailure})')
 assert.equal(result.error,undefined)
 assert.ok(Math.abs(result.result.uniformSky-1)<.03,JSON.stringify(result))
 // Bound residual numerical/sample energy to 0.01% of the unit sky.
 assert.ok(result.result.sealedRoom<1e-4,JSON.stringify(result))
 assert.equal(result.result.receiversDisposed,0)
 assert.ok(result.result.texturesAfterDisposal<result.result.texturesBeforeDisposal)
 console.log(JSON.stringify(result.result,null,2))
} finally {browser.close()}
