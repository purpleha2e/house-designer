import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/shaderDiagnosticsRegression.html` })
  await b.wait('!!window.shaderDiagnosticsResult')
  const result = await b.evaluate('window.shaderDiagnosticsResult')
  assert.equal(result.failure, undefined); assert.equal(result.logs, 0); assert.equal(result.inlineChecks, 0)
  assert.ok(result.checks > 0); assert.ok(result.inputRan); assert.ok(result.pixel[0] > 240); assert.equal(result.error, 0)
  assert.deepEqual(b.errors, []); console.log('PASS', result)
} finally { b.close() }
