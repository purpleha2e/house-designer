import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/roomExposure.html' })
  await b.wait('!!window.roomExposureResult')
  const result = await b.evaluate('roomExposureResult')
  const [dark, bright, black] = result.rows
  assert.ok(dark.initial.stops < .1, JSON.stringify(dark))
  assert.ok(dark.settled.stops > 1.8 && dark.settled.stops <= 2.001, JSON.stringify(dark))
  assert.ok(dark.settled.rgb[0] > dark.initial.rgb[0] * 1.5, JSON.stringify(dark))
  assert.ok(bright.settled.stops < .03, JSON.stringify(bright))
  assert.equal(black.settled.rgb[0], 0, 'Exposure must not add light to black')
  assert.ok(black.settled.stops <= 2.001)
  assert.ok(Math.abs(result.manual[0] - dark.initial.rgb[0]) <= 3, JSON.stringify(result))
  assert.deepEqual(b.errors, [])
  mkdirSync('tmp/room-exposure', { recursive: true })
  writeFileSync('tmp/room-exposure/regression.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { b.close() }
