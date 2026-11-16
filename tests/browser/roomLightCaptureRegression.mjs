import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser = await lightingBrowser()
try {
  await browser.call('Page.navigate', {url:`http://127.0.0.1:${process.argv[2]??5187}/tests/browser/roomLightCapture.html`})
  await browser.wait('!!window.roomCaptureResults')
  const results = await browser.evaluate('roomCaptureResults')
  assert.equal(results.length, 16)
  assert.ok(results.filter(r=>r.capture).every(r=>!r.displayAtlasActive), 'GI capture must omit the display shadow atlas')
  assert.deepEqual(browser.errors, [])
  console.log('PASS display and GI capture compile with zero, point, spot and mixed lights; capture omits display atlas samplers')
} finally {browser.close()}
