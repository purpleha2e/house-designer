import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lightingBrowser } from './lightingHarness.mjs'

const port = process.argv[2] ?? 5181
const out = 'docs/furniture-object-gi/app-preview'
mkdirSync(out, { recursive: true })
const b = await lightingBrowser()
const sofa = '96cca887-d5d4-4fef-a941-c3638911c06a'
const toggle = () => b.evaluate(`document.querySelector('[aria-label="Experimental furniture lighting"]').click()`)
const results = {}
try {
  const cache = readFileSync('docs/gi-next/baseline/field-cache.json', 'utf8')
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${cache}}}` })
  await b.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi` })
  await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`, 600000)
  console.log('READY')
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await b.wait(`!!document.querySelector('[aria-label="Experimental furniture lighting"]')`)
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Experimental furniture lighting"]').checked`), false)
  await b.evaluate(`(()=>{const root=roofWallScene().scene.getObjectByName('model-transform-${sofa}');window.originalFurnitureMaterials=new Map();root.traverse(o=>{if(o.isMesh)originalFurnitureMaterials.set(o,o.material)})})()`)
  const capture = async (name, cabinet = false) => {
    await b.wait('!roofWallScene().scene.userData.shaderWarmupPending', 120000)
    await b.evaluate(`import('/tests/browser/giSpatialHouse.ts').then(m=>{window.previewView=m.spatialHouseView(roofWallScene());previewView.setCamera(${cabinet ? '[4.3,1.7,10.8],[6.2,.7,12.2]' : '[1.1,1.4,16.4],[2.8,.65,16.6]'},65)})`)
    const hashes = {}
    for (const white of [false, true]) {
      const frame = await b.evaluate(`(async()=>{for(let i=0;i<8;i++){try{return await previewView.capture(${white})}catch(e){if(!String(e).includes('HDR readback unavailable')||i===7)throw e;await new Promise(r=>setTimeout(r,100))}}})()`)
      hashes[white ? 'white' : 'authored'] = createHash('sha256').update(frame.hdr).digest('hex')
      const png = await b.call('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${out}/${name}-${white ? 'white' : 'authored'}.png`, Buffer.from(png.data, 'base64'))
    }
    await b.evaluate('previewView.dispose()')
    return hashes
  }
  results.before = await capture('before')
  await toggle()
  await b.wait(`!!document.querySelector('[aria-label="Furniture lighting target"]')`)
  await b.evaluate(`(()=>{const select=document.querySelector('[aria-label="Furniture lighting target"]');select.value='${sofa}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await b.wait(`roofWallScene().scene.userData.furnitureLightingExperiment?.active === true && roofWallScene().scene.userData.furnitureLightingExperiment.modelId === '${sofa}'`)
  results.active = await b.evaluate('roofWallScene().scene.userData.furnitureLightingExperiment')
  assert.equal(results.active.modelId, sofa)
  await b.evaluate(`document.querySelector('[aria-label="Furniture lighting target"]').scrollIntoView({block:'center'})`)
  assert.equal(await b.evaluate(`(()=>{const menu=document.querySelector('#three-settings-menu');return menu.scrollWidth<=menu.clientWidth+1})()`), true, 'Furniture names must not widen the menu')
  results.after = await capture('enabled')
  assert.notEqual(results.before.white, results.after.white)
  assert.notEqual(results.before.authored, results.after.authored)
  await toggle()
  await b.wait('!roofWallScene().scene.userData.furnitureLightingExperiment')
  assert.equal(await b.evaluate('[...originalFurnitureMaterials].every(([mesh,material])=>mesh.material===material)'), true)
  results.restored = await capture('restored')
  assert.deepEqual(results.restored, results.before)
  console.log('A/B and restoration passed')
  // Identical imported cabinets share their original GLTF materials. Switching
  // one preview must not change the colour/texture/program of its neighbours.
  results.cabinetBefore = await capture('cabinet-before', true)
  await b.evaluate(`(()=>{window.neighbourMaterials=[];roofWallScene().scene.getObjectByName('model-transform-107850ce-4dd4-4b35-8ad3-5bc70488e20d').traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])neighbourMaterials.push({mesh:o,material:m,color:m.color?.getHex(),map:m.map,key:m.customProgramCacheKey()})})})()`)
  await toggle()
  await b.wait(`!!document.querySelector('[aria-label="Furniture lighting target"]')`)
  await b.evaluate(`(()=>{const select=document.querySelector('[aria-label="Furniture lighting target"]');select.value='0cd5964a-7f82-4218-9629-3fbc28a2ed4f';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await b.wait(`roofWallScene().scene.userData.furnitureLightingExperiment?.modelId === '0cd5964a-7f82-4218-9629-3fbc28a2ed4f' && roofWallScene().scene.userData.furnitureLightingExperiment.active`)
  results.cabinetAfter = await capture('cabinet-after', true)
  results.neighboursUnchanged = await b.evaluate(`neighbourMaterials.every(r=>(Array.isArray(r.mesh.material)?r.mesh.material:[r.mesh.material]).includes(r.material)&&r.material.color?.getHex()===r.color&&r.material.map===r.map&&r.material.customProgramCacheKey()===r.key)`)
  assert.equal(results.neighboursUnchanged, true)
  assert.notEqual(results.cabinetAfter.authored, results.cabinetBefore.authored)
  await toggle()
  await b.wait('!roofWallScene().scene.userData.furnitureLightingExperiment')
  assert.deepEqual(await capture('cabinet-restored', true), results.cabinetBefore)
  await toggle()
  await b.wait(`!!document.querySelector('[aria-label="Furniture lighting target"]')`)
  await b.evaluate(`(()=>{const select=document.querySelector('[aria-label="Furniture lighting target"]');select.value='${sofa}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await b.wait('roofWallScene().scene.userData.furnitureLightingExperiment?.active === true')
  await b.wait('!roofWallScene().scene.userData.shaderWarmupPending', 120000)
  const updates = await b.evaluate('roofWallScene().scene.userData.furnitureLightingExperiment.updates')
  await b.evaluate(`roofWallScene().camera.position.x+=.1;roofWallScene().invalidate()`)
  await new Promise(resolve => setTimeout(resolve, 800))
  assert.equal(await b.evaluate('roofWallScene().scene.userData.furnitureLightingExperiment.updates'), updates)
  await b.evaluate(`(() => {
    const s=roofWallScene(), render=s.gl.shadowMap.render;
    window.retainedShadowRefreshes=0;
    s.gl.shadowMap.render=function(lights,scene,camera) {
      const refresh=scene.userData.retainedViewport && this.needsUpdate;
      const calls=s.gl.info.render.calls;
      const result=render.call(this,lights,scene,camera);
      if(refresh && s.gl.info.render.calls>calls) window.retainedShadowRefreshes++;
      return result;
    };
  })()`)
  await b.evaluate(`window.updateRegressionFloors(floors=>floors.map(f=>({...f,models:f.models.map(m=>m.id==='${sofa}'?{...m,position:{...m.position,x:m.position.x-.2}}:m)})))`)
  await b.wait(`roofWallScene().scene.userData.furnitureLightingExperiment?.updates > ${updates}`, 30000)
  results.moved = await b.evaluate('roofWallScene().scene.userData.furnitureLightingExperiment')
  assert.equal(results.moved.active, true)
  // Allow the regular background scene scan to observe the private materials.
  await new Promise(resolve => setTimeout(resolve, 15000))
  results.originalHooksPreserved = await b.evaluate(`import('/src/indirectLightingShader.ts').then(m=>[...originalFurnitureMaterials.values()].flat().filter(v=>v.isMeshStandardMaterial).every(v=>!!m.getIndirectLightingUniforms(v)))`)
  assert.equal(results.originalHooksPreserved, true)
  results.retainedShadowRefreshes = await b.evaluate('window.retainedShadowRefreshes')
  assert.ok(results.retainedShadowRefreshes > 0, 'moved retained furniture refreshes the shadow map before the GI bake finishes')
  await toggle()
  await b.wait('!roofWallScene().scene.userData.furnitureLightingExperiment')
  assert.equal(await b.evaluate('[...originalFurnitureMaterials].every(([mesh,material])=>mesh.material===material)'), true)
  assert.deepEqual(b.errors, [])
  results.errors = b.errors
  writeFileSync(`${out}/verification.json`, JSON.stringify(results, null, 2))
  console.log('PASS: menu, white/authored A/B, exact restoration, camera stability, editor movement, no browser errors')
} catch (error) {
  writeFileSync(`${out}/failure.json`, JSON.stringify({ error: String(error), errors: b.errors, results }, null, 2))
  throw error
} finally { b.close() }
