import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
import { installNativeAudit } from './rendererAuditNative.js'

const origin = process.env.LUMEN_ORIGIN ?? 'http://127.0.0.1:5188'
const landing = process.argv.includes('--landing')
const reverse = process.argv.includes('--reverse')
const paired = process.argv.includes('--paired')
const view = landing ? 'landing' : 'room'
const tag = `distance-${view}${paired ? '-paired' : reverse ? '-reverse' : ''}`
const order = reverse || paired ? ['sdf', 'patches', 'patches', 'sdf'] : ['patches', 'sdf', 'sdf', 'patches']
const folder = new URL('../../docs/lumen-gi/room-review/', import.meta.url)
const path = name => fileURLToPath(new URL(name, folder))
const report = { view, arms: [], captures: {} }
const save = () => writeFile(path(`${tag}.json`), JSON.stringify(report, null, 2))
const read = async name => JSON.parse(await readFile(path(name), 'utf8'))
const browser = await lightingBrowser()
const evaluate = (fn, ...args) => browser.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`)
const scene = 'roofWallScene().scene.userData'
const camera = landing ? 'springfield-14' : 'lighting-room'
const images = {}
await mkdir(folder, { recursive: true })

async function settle(method) {
  await browser.wait(`(() => { const g = ${scene}.lumenGI; if (g?.state === 'error') throw Error(g.detail);
    return g?.trace === '${method}' && g.state === 'ready' && g.daylightReady && g.bounceReady && !g.refining })()`, 540000)
}

async function select(method) {
  await browser.evaluate(`if (!document.querySelector('[aria-label="Lumen trace method"]')) document.querySelector('[aria-label="3D view menu"]').click()`)
  await browser.wait(`!!document.querySelector('[aria-label="Lumen trace method"]')`)
  await evaluate(method => {
    const select = document.querySelector('[aria-label="Lumen trace method"]')
    select.value = method
    select.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('[aria-label="3D view menu"]').click()
  }, method)
}

async function capture(method) {
  const state = await evaluate(async () => {
    const s = roofWallScene(), canvas = s.gl.domElement, r = canvas.getBoundingClientRect()
    const { readDiffuseSceneLighting } = await import('/src/diffuseSceneSnapshot.ts')
    document.documentElement.classList.add('distance-capture')
    return { camera: s.camera.matrixWorld.toArray(), projection: s.camera.projectionMatrix.toArray(),
      exposure: s.gl.toneMappingExposure, width: canvas.width, height: canvas.height,
      lights: readDiffuseSceneLighting(s.scene, 1), fill: s.scene.userData.getIndirectUniforms().hdGIIndoorFill.value,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } }
  })
  try {
    const image = await browser.call('Page.captureScreenshot', { format: 'png', clip: state.clip })
    images[method] = Buffer.from(image.data, 'base64')
    report.captures[method] = state
  } finally {
    await browser.evaluate("document.documentElement.classList.remove('distance-capture')")
  }
}

function meanLumaError(before, after) {
  let total = 0
  for (let i = 0; i < before.length; i += 3) {
    total += Math.abs((before[i] - after[i]) * .2126 + (before[i + 1] - after[i + 1]) * .7152 + (before[i + 2] - after[i + 2]) * .0722)
  }
  return total / (before.length / 3)
}

async function compareImages() {
  const ref = landing ? (await read('../reference.json')).reference : (await read('energy-reference.json')).views.room
  const normalize = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? +v.toFixed(7) : v))
  for (const capture of Object.values(report.captures)) {
    assert.equal(capture.fill, 0)
    assert.deepEqual(normalize([capture.camera, capture.projection, capture.exposure, capture.width, capture.height, capture.lights]),
      normalize([ref.camera, ref.projection, ref.exposure, ref.width, ref.height, ref.inputs]))
  }
  const sources = [images.patches, images.sdf, path(landing ? '../landing-reference.png' : 'room-energy-reference.png')]
  const pixels = await Promise.all(sources.map(source => sharp(source).resize(320).toColourspace('srgb').removeAlpha().raw().toBuffer()))
  assert.ok(pixels.every(buffer => buffer.length === pixels[0].length))
  report.image = { patchesToReference: meanLumaError(pixels[0], pixels[2]), distanceToReference: meanLumaError(pixels[1], pixels[2]),
    betweenMethods: meanLumaError(pixels[0], pixels[1]) }
  const width = 420, height = Math.round(width * ref.height / ref.width), tiles = []
  for (const [index, label] of ['Surface patches', 'Signed distance field', 'Independent path trace'].entries()) {
    const title = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30"><text x="8" y="21" font-family="Arial" font-size="15" fill="white">${label}</text></svg>`)
    tiles.push({input:title,top:0,left:index*width}, {input:await sharp(sources[index]).resize(width,height).png().toBuffer(),top:30,left:index*width})
  }
  await sharp({ create: { width: width * 3, height: height + 30, channels: 3, background: '#20242a' } }).composite(tiles).png().toFile(path(`${tag}-comparison.png`))
}

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: landing ? 1280 : 1586, height: landing ? 900 : 934, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installNativeAudit.toString()})()` })
  await browser.call('Page.navigate', { url: `${origin}/tests/browser/roofWallRegression.html?${camera}&review-view=${view}&materials&lightingModel=existing&lightingView=custom&daylight-only&preview-lighting&giBackend=lumen&giShaderAudit&lumenTrace=${order[0]}` })
  await browser.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === 'full'`, 360000)
  await evaluate(async () => {
    const style = document.createElement('style')
    style.textContent = '.distance-capture body *{visibility:hidden!important}.distance-capture body canvas{visibility:visible!important}'
    document.head.append(style)
    const { installRendererAudit } = await import('/tests/browser/rendererAuditProbe.js')
    window.audit = await installRendererAudit(roofWallScene())
    await audit.configure({ giShader: false, probeGI: false })
  })
  report.hardware = await browser.evaluate('audit.snapshot().hardware')
  report.nativeBefore = await browser.evaluate(`({...${scene}.viewportShaderAudit.totals})`)
  console.log('Renderer ready', view)
  if (paired) {
    await settle('sdf')
    report.paired = await browser.evaluate('audit.sampleLumenDistance()')
    assert.ok(Object.values(report.paired).every(r => r.count >= 16), 'Too few valid trace samples')
  } else {
    let previous = order[0]
    for (const method of order) {
      const started = performance.now()
      if (previous !== method) await select(method)
      await settle(method)
      const readyMs = performance.now() - started
      const cache = await browser.evaluate(`(({distanceBuildMs,distanceBytes,atlasBytes,geometryBuilds,bvhBuilds,cacheProfile})=>
        ({distanceBuildMs,distanceBytes,atlasBytes,geometryBuilds,bvhBuilds,cacheProfile}))(${scene}.lumenGI)`)
      if (method === 'sdf') assert.ok(cache.distanceBytes > 0)
      if (!images[method]) await capture(method)
      const motion = await evaluate(async () => {
        const frame = await audit.sample(2400, true)
        const profile = await audit.sample(2400, true, true)
        const trace = profile.passes.find(p => p.name.includes('/LumenQuarterResolutionTrace/'))
        return { fps: frame.presentedFPS, frameMs: frame.frameMs, gpuMs: frame.gpuFrameMs,
          traceGpuMs: trace?.gpuMs, traceCpuMs: trace?.cpuMsPerFrame }
      })
      report.arms.push({ method, readyMs, cache, motion })
      await save()
      console.log(method, Math.round(readyMs), motion.fps.toFixed(1), motion.traceGpuMs?.median)
      previous = method
    }
    assert.equal(report.arms[0].cache.geometryBuilds, report.arms.at(-1).cache.geometryBuilds)
    assert.equal(report.arms[0].cache.bvhBuilds, report.arms.at(-1).cache.bvhBuilds)
    await compareImages()
    if (!landing) {
      report.aperture = await evaluate(async () => {
        const { checkLumenAperture } = await import('/tests/browser/lumenApertureVisibility.ts')
        return checkLumenAperture(true)
      })
      assert.ok(report.aperture[0][0] > .012)
      assert.deepEqual(report.aperture[1], [0, 0, 0, 0])
    }
  }
  report.nativeAfter = await browser.evaluate(`({...${scene}.viewportShaderAudit.totals})`)
  assert.deepEqual(report.nativeBefore, report.nativeAfter, 'Method switching must reuse prepared shader programs')
  assert.deepEqual(browser.errors, [])
  await save()
} catch (error) {
  report.failure = String(error)
  report.browserErrors = browser.errors
  await save()
  throw error
} finally { browser.close() }
