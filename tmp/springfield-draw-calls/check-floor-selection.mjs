import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { writeFileSync } from 'node:fs'
const browser = await lightingBrowser()
try {
  await browser.call('Page.navigate', { url: 'http://127.0.0.1:5187/tests/browser/roofWallRegression.html?springfield-14&published-materials&preview-lighting' })
  await browser.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === 'full' && !window.roofWallScene().scene.userData.shaderWarmupPending`, 300000)
  const result = await browser.evaluate(`import('/tests/browser/doorwayFloorRegression.js').then(m => m.checkDoorwayFloors())`)
  writeFileSync('tmp/springfield-draw-calls/floor-selection.json', JSON.stringify({ result, errors: browser.errors }, null, 2))
  console.log(JSON.stringify({ result, errors: browser.errors }, null, 2))
  if (browser.errors.length) throw Error('Browser errors during floor selection')
} finally { browser.close() }
