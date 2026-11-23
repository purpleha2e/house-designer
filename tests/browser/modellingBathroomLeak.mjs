// Run with the editor and asset portal: node tests/browser/modellingBathroomLeak.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const browser = await lightingBrowser()
const out = 'tmp/modelling-bathroom-leak'
mkdirSync(out, { recursive: true })
const ready = `(() => {
  const data = window.perfScene?.()?.scene.userData;
  return data?.progressiveStartup?.phase === 'full' && !data.shaderWarmupPending &&
    data.modellingLighting?.state === 'ready' && !data.modellingLighting.pending;
})()`
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.confirm = () => true;
    window.projectFileFixture = async () => [{ getFile: async () =>
      new File([await (await fetch('/springfield_14.json')).text()], 'springfield_14.json') }];` })
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5188}/tests/browser/editorRegression.html?lightingModel=modelling` })
  await browser.wait('!!window.perfScene?.()')
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.wait(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Load')`)
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load').click()`)
  await browser.wait(ready, 300000)
  const setup = await browser.evaluate(`(async () => {
    const state = perfScene(), { getEditorFiber } = await import('/tests/browser/rendererTestModules.ts');
    let control, liveInput;
    const visit = fiber => {
      if (!fiber) return;
      const p = fiber.memoizedProps;
      if (p?.control?.setEnabled && p.visibleRenderedFloors) control = p.control;
      if (p?.modellingEnabled && p.liveInput) liveInput = p.liveInput;
      visit(fiber.child); visit(fiber.sibling);
    };
    visit(getEditorFiber());
    if (!control || !liveInput) throw Error('Missing live lamp control');
    const lights = liveInput.get().lights;
    const ids = ['c3efd73d-1d28-413f-8301-b32a4c777fc9', '04d995c9-4188-4e94-9bbe-f13e03af4bc5'];
    if (ids.some(id => !lights.some(light => light.id === id && light.power > 0))) throw Error('Fixture bathroom lamps are missing or off');
    window.setBathroomLights = (direct, bounce) => {
      ids.forEach(id => control.setEnabled(id, id === direct));
      liveInput.set(lights.map(light => !ids.includes(light.id) || light.id === bounce ? light : { ...light, power: 0 }));
      state.scene.userData.liveLightRevision = (state.scene.userData.liveLightRevision ?? 0) + 1;
      state.invalidate();
    };
    state.camera.position.set(12.35, 1.48, 4.45);
    state.camera.lookAt(11.55, 1.7, 6.5);
    state.camera.updateMatrixWorld(true);
    state.invalidate();
    return { ids, camera: state.camera.position.toArray(), lights: lights.filter(light => ids.includes(light.id)) };
  })()`)
  const snap = async (name, direct, bounce, update) => {
    const count = await browser.evaluate('perfScene().scene.userData.modellingLighting.publications')
    await browser.evaluate(`setBathroomLights(${JSON.stringify(direct)}, ${JSON.stringify(bounce)})`)
    if (update) await browser.wait(`(${ready}) && perfScene().scene.userData.modellingLighting.publications > ${count}`)
    await new Promise(resolve => setTimeout(resolve, 1300))
    const clip = await browser.evaluate(`(() => {
      const r = perfScene().gl.domElement.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 };
    })()`)
    const image = await browser.call('Page.captureScreenshot', { format: 'png', clip })
    const png = Buffer.from(image.data, 'base64')
    writeFileSync(`${out}/${name}.png`, png)
    return sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  }
  const off = await snap('off', null, null, true)
  const report = { ...setup, samples: [] }
  for (const [index, id] of setup.ids.entries()) {
    for (const [label, direct, bounce, update] of [
      ['direct', id, null, index > 0], ['bounce', null, id, true],
    ]) {
      const row = await snap(`${label}-${index}`, direct, bounce, update)
      // The visible section of the joint above the fridge, away from menus.
      const { width, height, channels } = row.info
      const xStart = Math.round(.45 * width), xEnd = Math.round(.96 * width)
      const yStart = Math.round(.09 * height), yEnd = .19 * height
      let peak = 0, litPixels = 0
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const p = (y * width + x) * channels
          const change = (row.data[p] + row.data[p+1] + row.data[p+2] - off.data[p] - off.data[p+1] - off.data[p+2]) / 3
          peak = Math.max(peak, change)
          if (change > 3) litPixels++
        }
      }
      report.samples.push({ label, id, peak, litPixels, samplePixels: (xEnd - xStart) * (Math.ceil(yEnd) - yStart) })
    }
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  for (const { label, peak, litPixels, samplePixels } of report.samples) {
    assert.ok(peak <= (label === 'direct' ? 1 : 5) && litPixels <= samplePixels * .02,
      `The bathroom lamp must not create a bright ${label} light leak at the closed kitchen joint`)
  }
  assert.deepEqual(browser.errors, [])
} finally {
  browser.close()
}
