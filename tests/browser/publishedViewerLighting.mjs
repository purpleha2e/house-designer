import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { installSceneEditPreload } from './sceneEditTrace.js'

// Exercise the production bundle and its real saved house, with no editor GI flags.
const url = process.argv[2] ?? 'http://127.0.0.1:5183/'
const output = 'tmp/published-viewer-lighting'
mkdirSync(output, { recursive: true })
const browser = await lightingBrowser()
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true })
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installSceneEditPreload.toString()})()` })
  await browser.call('Page.navigate', { url })
  let result
  for (let i = 0; i < 36; i++) {
    await new Promise(resolve => setTimeout(resolve, 10000))
    result = await browser.evaluate(`(() => {
      let scene, savedOrder;
      const walk = fiber => {
        if (!fiber) return;
        const props = fiber.memoizedProps;
        if (props?.requireSavedCache && props.savedCache) savedOrder = props.savedCache.settings.shOrder ?? 1;
        if (props?.value?.getState?.()?.scene) window.viewerTestStore = props.value;
        for (let dep = fiber.dependencies?.firstContext; dep; dep = dep.next)
          if (dep.memoizedValue?.getState?.()?.scene) window.viewerTestStore = dep.memoizedValue;
        scene ??= window.viewerTestStore?.getState()?.scene;
        walk(fiber.child); walk(fiber.sibling);
      };
      for (const root of sceneEditTrace.roots.keys()) walk(root.current);
      const data = scene?.userData, uniforms = data?.getIndirectUniforms?.();
      let exteriorMaterials = 0;
      scene?.traverse(object => { for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (/-exterior-sky-eaves\d+/.test(material?.customProgramCacheKey() ?? '')) exteriorMaterials++;
      });
      return { gi: data?.indirectLighting, exterior: data?.exteriorSkyOcclusion,
        warming: data?.shaderWarmupPending, savedOrder, order: uniforms?.hdGISHOrder.value,
        giStrength: uniforms?.hdGIDisplayStrength.value, exteriorStrength: uniforms?.hdExteriorSkyStrength.value,
        exteriorFeature: uniforms?.hdExteriorSkyFeature.value, exteriorMaterials,
        touch: matchMedia('(pointer: coarse)').matches, status: document.body.innerText.slice(-600) };
    })()`)
    writeFileSync(`${output}/result.json`, JSON.stringify({ url, ...result }, null, 2))
    console.log(JSON.stringify({ gi: result.gi?.state, exterior: result.exterior?.state, warming: result.warming, status: result.status }))
    assert.notEqual(result.gi?.state, 'fallback', result.gi?.cacheReason)
    assert.deepEqual(browser.errors, [])
    if (result.gi?.state === 'ready' && result.exterior?.enabled && !result.warming) break
  }
  assert.equal(result.gi?.state, 'ready')
  assert.equal(result.gi.source, 'saved')
  assert.equal(result.gi.displayed, true)
  assert.equal(result.gi.capturedFaces, 0, 'Tour must restore the bake without recapturing it')
  assert.equal(result.order, result.savedOrder)
  assert.ok(result.giStrength > 0)
  assert.equal(result.exterior?.state, 'ready')
  assert.equal(result.exterior?.enabled, true)
  assert.equal(result.exteriorStrength, .75)
  assert.equal(result.exteriorFeature, 1)
  assert.ok(result.exteriorMaterials > 0, 'Exterior receivers must use the occlusion shader')
  assert.equal(result.warming, false)
  assert.equal(result.touch, true)
  if (process.argv.includes('--adapt')) {
    await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
    // Controlled slow frames exercise the actual mobile component and Canvas DPR.
    await browser.evaluate(`(() => { window.viewerSlowFrames = true; function slow() {
      if (!viewerSlowFrames) return;
      const end = performance.now() + 90; while (performance.now() < end) {}
      requestAnimationFrame(slow);
    } requestAnimationFrame(slow); })()`)
    try {
      await browser.wait('viewerTestStore.getState().gl.getPixelRatio() <= .85', 20000)
    } finally {
      await browser.evaluate('window.viewerSlowFrames = false')
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
    }
    const reduced = await browser.evaluate(`(() => { const s = viewerTestStore.getState(); return {
      dpr: s.gl.getPixelRatio(), gi: s.scene.userData.indirectLighting,
      exterior: s.scene.userData.exteriorSkyOcclusion, pixels: [s.gl.domElement.width, s.gl.domElement.height]
    }; })()`)
    assert.ok(reduced.dpr <= .85)
    assert.equal(reduced.gi.source, 'saved')
    assert.equal(reduced.gi.generation, result.gi.generation)
    assert.equal(reduced.gi.displayed, true)
    assert.equal(reduced.gi.capturedFaces, 0)
    assert.equal(reduced.exterior.bakes, result.exterior.bakes)
    assert.equal(reduced.exterior.enabled, true)
    await browser.evaluate(`document.querySelector('[aria-label="Open tour menu"]').click()`)
    await browser.evaluate(`(() => { const select = document.querySelector('[aria-label="Render quality"]');
      select.value = 'full'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await browser.wait('viewerTestStore.getState().gl.getPixelRatio() === 1')
    assert.deepEqual(browser.errors, [])
    writeFileSync(`${output}/adaptive.json`, JSON.stringify(reduced, null, 2))
    console.log('PASS mobile resolution adapts under load; saved GI and exterior field reused; Full resolution restores DPR')
  }
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/tour.png`, Buffer.from(screenshot.data, 'base64'))
  console.log('PASS production mobile tour: saved GI displayed, exterior occlusion applied, no runtime errors')
} finally { browser.close() }
