import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),result={}
try{
for(const mode of ['open','closed']){
 await browser.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/houseDoorwayFixture.html'+(mode==='closed'?'?closed=1':'')})
 await browser.wait('window.houseLightingLab?.stats().frames>600')
 result[mode]=await browser.evaluate('houseLightingLab.measureView(0,0)')
}
assert.ok(result.open.bounce[0]>.025,'Daylight must pass through an unglazed exterior opening and an open interior doorway: '+JSON.stringify(result))
assert.ok(result.closed.bounce.slice(0,3).every(v=>v<.0001),'An opaque closed interior door must stop daylight in the black-walled rear room')
assert.deepEqual(browser.errors,[]);console.log(JSON.stringify(result))
}finally{browser.close()}
