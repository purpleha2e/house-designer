import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const browser = await lightingBrowser()
try {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/rendererAttributeDefaults.html` })
  await browser.wait('!!window.attributeDefaultsResult')
  const result = await browser.evaluate('window.attributeDefaultsResult')
  assert.notDeepEqual(result.before[2], [255, 0, 0], 'fixture reproduces stale generic attributes without the fix')
  assert.deepEqual(result.after, [[255, 0, 0], [0, 255, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255], [255, 255, 0]])
  assert.equal(result.restored, true)
  assert.deepEqual(browser.errors, [])
  console.log(JSON.stringify(result))
} finally { browser.close() }
