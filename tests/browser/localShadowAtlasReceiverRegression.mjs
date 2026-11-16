import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser = await lightingBrowser()
try {
  for (const dpr of [1, 1.25, 2]) {
    await browser.call('Page.navigate', {url:`http://127.0.0.1:${process.argv[2]??5187}/tests/browser/localShadowAtlas.html?dpr=${dpr}`})
    await browser.wait('!!window.atlasGPUResult')
    const result = await browser.evaluate('atlasGPUResult')
    console.log(JSON.stringify({dpr,...result,seams:{count:result.seams.length,leaks:result.seams.filter(s=>s.visibility>.1)}}))
    assert.ok(result.blocked.every(v=>v<.1), `all six point faces must block at DPR ${dpr}`)
    assert.ok(result.clear.every(v=>v>.9), `all six point faces must stay clear at DPR ${dpr}`)
    assert.ok(result.spotlight[0]<.1&&result.spotlight[1]>.9&&result.spotlight[2]>.9)
    for(const surface of result.surfaces){
      assert.ok(surface.coverage>1000,`${surface.name} must have sufficient visible coverage`)
      assert.ok(surface.darkFraction<.005,`${surface.name} has ${surface.darkFraction*100}% self-shadowed pixels`)
    }
    assert.ok(result.contact.every((v,i)=>v<(i===0?.4:.25)),'thin contact shadow must remain attached, with only the edge partially filtered')
    assert.ok(result.clearFloor.every(v=>v>.95),'unobstructed floor must stay clear')
    assert.ok(result.thinSheet<.1,'a genuinely double-sided thin sheet must still block light')
    assert.ok(result.seams.every(s=>s.visibility<.1),'shadow must remain continuous across cube edges and corners after receiver bias')
    assert.equal(result.error,0)
  }
  assert.deepEqual(browser.errors,[])
  console.log('PASS shadow receiver GPU regressions')
} finally {browser.close()}
