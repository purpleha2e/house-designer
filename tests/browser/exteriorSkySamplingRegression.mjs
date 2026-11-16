import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser=await lightingBrowser()
try {
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5187}/tests/browser/exteriorSkySampling.html`})
  await browser.wait('!!window.exteriorSamplingResults')
  const results=await browser.evaluate('exteriorSamplingResults')
  assert.equal(results.length,21)
  assert.deepEqual(results.filter(r=>r.min<254),[],'exposed angled facades must not mix indoor visibility into stripes')
  const noise=await browser.evaluate('exteriorSamplingNoise')
  assert.ok(noise.after<noise.before*.85,'the facade filter reduces coarse-field striping')
  assert.deepEqual(browser.errors,[])
  console.log('PASS exterior sky sampling: 21 wall orientations/grid offsets, 2688 pixels without indoor light leakage')
  console.log('Facade stripe deviation:',noise)
} finally {browser.close()}
