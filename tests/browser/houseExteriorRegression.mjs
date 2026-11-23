import assert from 'node:assert/strict'
import{lightingBrowser}from'./lightingHarness.mjs'
const b=await lightingBrowser();try{
await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/houseExteriorFixture.html'});await b.wait('window.exteriorResult');const r=await b.evaluate('window.exteriorResult');
assert.equal(r.legacyEmitters,1);assert.equal(r.legacyGround,false);assert.equal(r.exteriorEmitters,0);assert.equal(r.glass,1);assert.equal(r.ground,true);assert.equal(r.skyGeometry,false);assert.equal(r.backgroundMatches,true);assert.equal(r.prototype,false);assert.equal(r.authoredRoughness,.25);assert.equal(r.referenceTriangles,36);console.log(JSON.stringify(r))
}finally{b.close()}
