import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser=await lightingBrowser()
try {
  for(const angle of [.1,.55,1.1])for(const overhang of [.025,.25]) {
    await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5181}/tests/browser/exteriorFacadeShading.html?angle=${angle}&overhang=${overhang}`})
    await browser.wait('window.facadeReady')
    assert.equal(await browser.evaluate('filterMaxDifference'),0,'compact filter preserves every sampled pixel')
    const wall=await browser.evaluate('facadeProfile(2.32)'),trim=await browser.evaluate('facadeProfile(2.48)')
    console.log({angle,overhang,wall,trim})
    assert.ok(wall.deviation<2, 'a straight eave must not project grid stripes along the wall')
    assert.ok(wall.mean<220, 'the filter preserves the contact shadow beneath the overhang')
    assert.equal(trim.min,255,'the fascia remains free of self-shadowing')
  }
  assert.deepEqual(browser.errors,[])
  console.log('PASS wall contact shading and clean fascia across shallow/deep angled eaves')
} finally {browser.close()}
