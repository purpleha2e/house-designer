// With Vite running: node tests/browser/modellingLighting.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const production = process.argv.includes('--production'), textured = process.argv.includes('--textured')
const suffix = (production ? '-production' : '') + (textured ? '-textured' : '')
try {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5173}/tests/browser/modellingLighting.html?${production ? 'production&' : ''}${textured ? 'textured&rendererShadows=cascaded' : ''}` })
  await browser.wait('!!window.modellingLightingResult', 240000)
  const result = await browser.evaluate('window.modellingLightingResult')
  mkdirSync('tmp/modelling-lighting', { recursive: true })
  writeFileSync(`tmp/modelling-lighting/regression${suffix}.json`, JSON.stringify(result, null, 2))
  assert.equal(result.error, undefined, JSON.stringify(result))
  assert.deepEqual(result.shaderFailures, [], 'every capture shader must link on the available hardware')
  assert.equal(result.cancellationSafe, true, 'repeated cancellation must preserve the displayed field and its coordinates')
  assert.equal(result.pauseSafe, true, 'a paused preparation must not clear shared display uniforms or release resident transport programs when it rejects')
  const samples = Object.fromEntries(result.samples.map(sample => [sample.name, sample]))
  assert.ok(samples.closed.energy < .001, 'a sealed wall must block the neighbouring lamp')
  assert.ok(samples.open.energy > samples.closed.energy * 10 + .001, 'removing a wall admits bounced lamp light')
  assert.ok(samples.open.rgb[0] > samples.open.rgb[1] * 1.3, 'red walls must tint the bounced light from a white lamp')
  assert.deepEqual(samples['model-excluded'].rgb, samples.open.rgb, 'complex imported models must not occlude or contribute to architecture-only bounce')
  assert.deepEqual(samples['editor-fill-excluded'].rgb, samples.open.rgb, 'editor ambient/hemisphere/probe fill must not contaminate architectural bounce')
  assert.equal(samples['model-excluded'].captureMeshes, samples.open.captureMeshes, 'complex imported meshes stay out of the capture scene')
  assert.equal(samples['model-excluded'].occupancyParts, samples.open.occupancyParts, 'complex imported meshes stay out of worker occupancy geometry')
  assert.ok(samples.off.energy < .00001, 'turning the lamp off removes its bounce')
  assert.ok(Math.abs(samples.on.energy - samples.open.energy) < samples.open.energy * .02, 're-enabling the lamp restores lighting')
  assert.ok(samples['spot-added'].energy > samples.on.energy, 'adding an enabled spotlight contributes bounce')
  assert.ok(samples['wall-added'].energy < .001, 'adding a partition must refresh occlusion')
  assert.ok(samples['wall-moved'].energy > samples['wall-added'].energy + .001, 'moving the partition must update light transport')
  assert.equal(samples['storey-right-lamp'].stats.views, 16)
  assert.ok(samples['storey-right-lamp'].rightSideEnergy > samples['storey-no-right-lamp'].rightSideEnergy + .01,
    'a weaker lamp in a second room still contributes when the first room fills the shadow budget')
  for (const sample of result.samples.slice(1)) {
    assert.equal(sample.shaderCompiles, 0, `${sample.name} must reuse compiled shaders`)
    assert.equal(sample.programLinks, 0, `${sample.name} must reuse linked programs`)
    assert.equal(sample.glError, 0, `${sample.name} must not produce WebGL errors`)
  }
  assert.equal(result.glError, 0)
  if (textured) {
    if (result.maxTextures === 16) assert.equal(samples.open.stats.captureLights, 4, 'reserve sampler capacity for authored PBR maps on WebGL2 minimum hardware')
    assert.ok(result.captureSamplers.length > 0, 'inspect actual native-capture linked shaders')
    for (const program of result.captureSamplers) {
      assert.ok(program.count <= 16, 'textured capture must fit the WebGL2 minimum sampler budget')
      assert.ok(program.samplers.every(uniform => !/^hd(?:GI|Room|LocalShadow|SunCascade)/.test(uniform.name)), 'capture must not keep editor GI/atlas/cascade textures active')
    }
  }
  assert.deepEqual(browser.errors, [])
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`tmp/modelling-lighting/room${suffix}.png`, Buffer.from(screenshot.data, 'base64'))
  console.log('PASS modelling light transport, colour bounce, geometry updates and shader reuse', JSON.stringify(result))
} finally { browser.close() }
