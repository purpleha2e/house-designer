import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { lightingBrowser } from './lightingHarness.mjs'

const origin = process.env.HOUSE_URL ?? 'http://127.0.0.1:8143'
const output = new URL('../../tmp/six-ray-landing/', import.meta.url)
await mkdir(output, { recursive: true })
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url)))
const archive = await read('../../experiments/ml-gi/results/phase5-v1/springfield.json')
const camera = (await read('../../docs/lighting-lab/springfield-hall/landing-check/landing-view.json')).stats.camera
const projectHash = createHash('sha256').update(await readFile(new URL('../../springfield_14.json', import.meta.url))).digest('hex')
const receivers = archive.comparison.receivers.map(({ name, position, normal, floor }) => ({ name, position, normal, floor }))
const browser = await lightingBrowser()
const report = { projectHash, camera, modes: {}, sun: {}, screenshots: {} }
const status = () => browser.evaluate(`(() => {
  const u=window.roofWallScene?.()?.scene.userData
  return { ray:u?.sixRayGI, legacy:u?.indirectLighting, stage:u?.progressiveStartup,
    warming: u?.shaderWarmupPending, scan:u?.indirectScanPending, warmup:u?.shaderWarmupProfile?.at(-1)?.phase }
})()`)
async function wait(expression, timeout = 240000) {
  const expires = Date.now() + timeout
  while (!await browser.evaluate(expression)) {
    const state = await status()
    if (state.ray?.state === 'error') throw Error(state.ray.detail)
    if (Date.now() > expires) throw Error('Timed out: ' + JSON.stringify(state).slice(0, 2500))
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
async function select(label, value) {
  await browser.evaluate(`(() => {
    const button = document.querySelector('[aria-label="3D view menu"]')
    if (button?.getAttribute('aria-expanded') !== 'true') button?.click()
  })()`)
  await wait(`Boolean(document.querySelector('[aria-label="${label}"]'))`)
  await browser.evaluate(`(() => {
    const select = document.querySelector('[aria-label="${label}"]')
    select.value = ${JSON.stringify(String(value))}
    select.dispatchEvent(new Event('change', { bubbles:true }))
    document.querySelector('[aria-label="3D view menu"]').click()
  })()`)
}
const ready = (mode, after = 0) => `(() => {
  const r = window.roofWallScene?.()?.scene.userData.sixRayGI
  return r?.active === '${mode}' && r.state === 'ready' && r.visible === r.published && r.published > ${after}
})()`
const pose = () => browser.evaluate(`(async () => {
  const s=roofWallScene(), pose=${JSON.stringify(camera)}
  s.camera.position.fromArray(pose.position);s.camera.quaternion.fromArray(pose.quaternion);s.camera.fov=pose.fov
  s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true)
  s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1
  s.invalidate()
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
})()`)
function readReceivers() {
  return browser.evaluate(`(async () => {
    const s=roofWallScene(), { field, lighting }=s.scene.userData.getSixRayField()
    const { sampleDisplayedIndirect }=await import('/src/indirectLightingDiagnostic.ts')
    const points=${JSON.stringify(receivers)}
    const vector=(coords)=>s.camera.position.clone().fromArray(coords)
    const measured=points.map(({name,position,normal,floor})=>({name,
      ...sampleDisplayedIndirect(field,floor,vector(position).addScaledVector(vector(normal),.045),vector(normal))}))
    return { measured, lighting }
  })()`)
}
async function independentReference() {
  const probes = report.modes['six-fixed'].inspections.map(point => point.origin)
  const initial = report.modes['six-fixed'].lighting
  const changed = report.sun['six-fixed'].lighting
  return browser.evaluate(`(async () => {
    const s=roofWallScene()
    const { snapshotReferenceScene }=await import('/src/diffuseSceneSnapshot.ts')
    const { createSceneLightingReference }=await import('/tests/sceneLightingReference.ts')
    const { indirectSHRadianceBasis }=await import('/src/indirectSH.ts')
    const { data }=await snapshotReferenceScene(s,undefined,{textureLimit:128,diffusePbr:true})
    const count=256
    const directions=Array.from({length:count},(_,i)=>{
      const y=1-2*(i+.5)/count, r=Math.sqrt(1-y*y), phi=i*Math.PI*(3-Math.sqrt(5))
      return [r*Math.cos(phi),y,r*Math.sin(phi)]
    })
    const basis=directions.map(d=>indirectSHRadianceBasis(s.camera.position.clone().fromArray(d)))
    const fixed=createSceneLightingReference({...data,...${JSON.stringify(initial)}})
    const sun=createSceneLightingReference({...data,...${JSON.stringify(changed)}})
    const receivers=${JSON.stringify(receivers)}.map(r=>({...r,geometricNormal:r.normal}))
    const evaluate=(ref,r)=>ref.evaluate(r,16384,3,9981,3)
    const projected=${JSON.stringify(probes)}.map((point,j)=>{
      const values=new Float64Array(12)
      fixed.incoming(point,directions,16,3,150+j,false,3).forEach(({radiance},i)=>{
        basis[i].forEach((b,k)=>radiance.forEach((c,l)=>values[3*k+l]+=c*b*4*Math.PI/count))
      })
      return Array.from(values)
    })
    const original=receivers.map(r=>evaluate(fixed,r)), updated=receivers.map(r=>evaluate(sun,r))
    fixed.dispose();sun.dispose()
    return { projected, original, updated, directions:count, samplesPerDirection:16 }
  })()`)
}
const drawBenchmark = () => browser.evaluate(`(async () => {
  const s=roofWallScene(), u=s.scene.userData, bind=u.bindSixRayGI, uniforms=u.getIndirectUniforms()
  const intervals=async enabled=>{
    u.bindSixRayGI=()=>{const release=bind(), previous=uniforms.hdGIUseVolume.value
      if(!enabled)uniforms.hdGIUseVolume.value=0
      return shown=>{uniforms.hdGIUseVolume.value=previous;release(shown)}
    }
    const delta=[]
    for(let i=0;i<24;i++){
      const start=performance.now()
      u.displayEffectRevision++
      s.invalidate()
      await new Promise(requestAnimationFrame)
      if(i>=4)delta.push(performance.now()-start)
    }
    return delta
  }
  try { return { enabled:await intervals(true), disabled:await intervals(false) } }
  finally { u.bindSixRayGI=bind;u.displayEffectRevision++;s.invalidate() }
})()`)
async function capture(name) {
  await pose()
  const metadata = await browser.evaluate(`(() => {
    const s=roofWallScene(), r=s.gl.domElement.getBoundingClientRect(), u=s.scene.userData.getIndirectUniforms()
    return { exposure:s.gl.toneMappingExposure,toneMapping:s.gl.toneMapping,fill:u.hdGIIndoorFill.value,
      programs:s.gl.info.programs.length,
      clip:{x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y),scale:1}}
  })()`)
  const png = await browser.call('Page.captureScreenshot', { format: 'png', clip: metadata.clip })
  await writeFile(new URL(name + '.png', output), Buffer.from(png.data, 'base64'))
  report.screenshots[name] = metadata
}
async function measure(mode, key = mode) {
  const state = await status()
  assert.equal(state.ray.active, mode)
  assert.equal(state.legacy.state, 'suspended')
  assert.equal(state.legacy.capturedFaces ?? 0, 0, 'fast startup may not run production GI captures')
  assert.equal(await browser.evaluate(`!!roofWallScene().scene.userData.getIndirectCaptureScene?.() || !!roofWallScene().scene.userData.experimentalHybridGI`), false)
  const values = await browser.evaluate(`(async () => {
    const s=roofWallScene(), { field }=s.scene.userData.getSixRayField()
    const points=${JSON.stringify(receivers)}
    const inspections=await Promise.all(points.map(({position,normal})=>s.scene.userData.inspectSixRayProbe(position,normal)))
    return { inspections, resolution:field.volume.n }
  })()`)
  report.modes[key] = { ...state.ray, ...await readReceivers(), ...values }
  await capture(key)
  console.log(key, JSON.stringify({ probes:state.ray.probes, visibleMs:state.ray.visibleMs,
    volumeMs:state.ray.volumeMs, solver:state.ray.stats?.solveMs }))
}
async function inspectOverlay() {
  const checkbox = text => `[...document.querySelectorAll('label')].find(label=>label.textContent.trim()===${JSON.stringify(text)})?.querySelector('input')`
  const toggle = async () => {
    await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await wait(`Boolean(${checkbox('Inspect GI point')})`)
    await browser.evaluate(`${checkbox('Inspect GI point')}.click();document.querySelector('[aria-label="3D view menu"]').click()`)
  }
  await toggle()
  await wait(`typeof roofWallScene().scene.userData.inspectIndirectPoint==='function'`)
  await browser.evaluate(`roofWallScene().scene.userData.inspectIndirectPoint([11.36,4.85,10.84],[0,-1,0])`)
  await wait(`Boolean(roofWallScene().scene.userData.sixRayOverlay) && document.body.innerText.includes('Volume irradiance at receiver')`)
  await capture('inspector')
  const vertices = await browser.evaluate(`roofWallScene().scene.userData.sixRayOverlay.children[0].geometry.attributes.position.count`)
  assert.ok(vertices >= 12)
  await browser.evaluate(`${checkbox('Show primary and secondary rays')}.click()`)
  await wait(`!roofWallScene().scene.userData.sixRayOverlay`)
  await toggle()
  return { segments: vertices / 2 }
}
const save = () => writeFile(new URL('measurements.json', output), JSON.stringify(report, null, 2) + '\n')
const url = origin + '/tests/browser/roofWallRegression.html?springfield-14&materials&lightingModel=existing'
async function production() {
  await browser.call('Page.navigate', { url })
  await wait(`(() => {const u=window.roofWallScene?.()?.scene.userData, g=u?.indirectLighting;
    return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&u.progressiveStartup?.phase==='full'})()`, 480000)
  await capture('production')
  await writeFile(new URL('production.json', output), JSON.stringify({ screenshots: report.screenshots, browserErrors: browser.errors }, null, 2))
}
async function compareFastModes() {
  await browser.call('Page.navigate', { url: url + '&giBackend=six-fixed' })
  await wait(ready('six-fixed'))
  await measure('six-fixed')
  await browser.evaluate(`roofWallScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=0`)
  await capture('gi-off')
  await browser.evaluate(`roofWallScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=1`)
  const original = await browser.evaluate('regressionSunPosition')
  for (const mode of ['six-fixed', 'six-rotated', 'six-adaptive']) {
    if (mode !== 'six-fixed') {
      await select('GI backend', mode)
      await wait(ready(mode))
      await measure(mode)
    }
    const before = (await status()).ray
    const at = await browser.evaluate(`(() => {
      const at=performance.now()
      updateRegressionSunPosition(${JSON.stringify({ ...original, azimuth: original.azimuth + .025 })})
      return at
    })()`)
    await wait(ready(mode, before.published))
    const after = (await status()).ray
    assert.equal(after.geometryBuilds, before.geometryBuilds)
    if (mode === 'six-fixed') assert.equal(after.stats.primaryRays + after.stats.secondaryRays, 0)
    report.sun[mode] = { ...after, ...await readReceivers(), inputToFirstFrameMs: after.presentedAt - at }
    await browser.evaluate(`updateRegressionSunPosition(${JSON.stringify(original)})`)
    await wait(ready(mode, after.published))
  }
  await save()
  for (const count of [12, 24]) {
    const old = (await status()).ray.published
    await select('Primary rays', count)
    await wait(ready('six-adaptive', old))
    await measure('six-adaptive', `six-adaptive-${count}`)
  }
  const afterBudget = (await status()).ray
  await select('Primary rays', 6)
  await wait(ready('six-adaptive', afterBudget.published))
  report.drawIntervals = await drawBenchmark()
  if (process.argv.includes('--reference')) report.reference = await independentReference()
  report.inspector = await inspectOverlay()
  await save()
  const steady = (await status()).ray
  await browser.evaluate(`selectRegressionModel(regressionFloors[0].models[0].id);roofWallScene().camera.position.x+=.015;roofWallScene().invalidate()`)
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal((await status()).ray.generation, steady.generation, 'camera and selection must not invalidate GI')
  await browser.evaluate(`(() => {
    selectRegressionModel(null)
    updateRegressionFloors(floors=>floors.map((floor,index)=>{
      const target= index===1 && floor.models.find(m=>m.wallAttachment && /window/i.test(m.modelId))
      if(!target)return floor
      return regressionTools.syncWallOpenings({...floor,models:floor.models.map(m=>m!==target?m:{...m,widthScale:(m.widthScale??1)*.88})},regressionTools.modelsById)
    }))
  })()`)
  await wait(ready('six-adaptive', steady.published))
  report.resized = { ...(await status()).ray, ...await readReceivers() }
  assert.ok(report.resized.geometryBuilds > steady.geometryBuilds)
  await save()
  await select('GI backend', 'production')
  await wait(`!roofWallScene().scene.userData.sixRayGI && !roofWallScene().scene.userData.indirectLighting.suspended`)
  report.productionResumed = true
  await save()
}
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false })
  if (!process.argv.includes('--production-only')) await compareFastModes()
  if (!process.argv.includes('--skip-production')) await production()
} catch (error) {
  report.error = String(error); report.final = await status().catch(() => undefined); throw error
} finally {
  report.browserErrors = browser.errors
  if (!process.argv.includes('--production-only')) await save()
  browser.close()
}
