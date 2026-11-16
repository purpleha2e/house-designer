import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const output = 'tmp/viewer-exterior-sky'
mkdirSync(output, { recursive: true })
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true })
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5187}/tests/browser/readOnlyViewerRegression.html` })
  await browser.wait(`!!window.viewerState?.()?.scene.userData.getIndirectUniforms`)
  console.log('Mobile tour mounted; waiting for exterior sky shading')
  await browser.wait(`viewerState().scene.userData.exteriorSkyOcclusion?.state==='ready' &&
    viewerState().scene.userData.exteriorSkyOcclusion.enabled && !viewerState().scene.userData.shaderWarmupPending`, 240000)
  const before = await browser.evaluate(`(()=>{const s=viewerState(),u=s.scene.userData;return {
    exterior:u.exteriorSkyOcclusion,giEnabled:u.indirectLighting?.enabled,
    strength:u.getIndirectUniforms().hdExteriorSkyStrength.value,
    feature:u.getIndirectUniforms().hdExteriorSkyFeature.value,
    touch:matchMedia('(pointer: coarse)').matches}})()`)
  assert.equal(before.giEnabled, true)
  assert.equal(before.strength, .75)
  assert.equal(before.feature, 1)
  assert.equal(before.touch, true)
  assert.ok(before.exterior.bakes > 0)
  await browser.evaluate(`document.querySelector('[aria-label="Open tour menu"]').click()`)
  await browser.evaluate(`[...document.querySelectorAll('.viewer-floor-controls button')].find(b=>b.textContent==='Upstairs').click()`)
  await browser.wait(`document.querySelector('[aria-label="Current floor"]').textContent==='First floor'`)
  await new Promise(resolve => setTimeout(resolve, 1800))
  const after = await browser.evaluate('viewerState().scene.userData.exteriorSkyOcclusion')
  assert.equal(after.enabled, true)
  assert.equal(after.bakes, before.exterior.bakes, 'Floor navigation must reuse the exterior field')
  assert.deepEqual(browser.errors, [])
  writeFileSync(`${output}/result.json`, JSON.stringify({ before, after }, null, 2))
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/tour.png`, Buffer.from(screenshot.data, 'base64'))
  console.log('PASS mobile tour defaults: GI enabled, exterior occlusion at 75%, field reused upstairs', before.exterior)
} finally { browser.close() }
