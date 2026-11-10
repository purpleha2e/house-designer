import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'

const port = process.argv[2] ?? 5180
const output = process.argv[3] ?? 'tmp/colin-wall-material'
const restore = process.argv.find(arg => arg.startsWith('--restore='))?.slice(10)
const browser = await lightingBrowser()
mkdirSync(output, { recursive: true })
try {
  if (restore) await browser.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.regressionSavedGI={project:{indirectLighting:${readFileSync(restore, 'utf8')}}}`,
  })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&lightingProfile&preview-lighting&${restore ? 'saved-gi' : 'saved-colin'}` })
  await browser.wait('!!window.roofWallScene?.()', 120000)
  await browser.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(3.9,4.25,8.1);s.camera.lookAt(1.88,3.9,5.8);s.invalidate()})()`)
  for (let elapsed = 0; ; elapsed++) {
    const phase = await browser.evaluate('roofWallScene().scene.userData.progressiveStartup?.phase')
    if (phase === 'full') break
    if (elapsed % 10 === 0) console.log('Preparing Colin bedroom:', phase ?? 'geometry')
    assert.ok(elapsed < 180, 'the complete textured view must finish preparation')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  await browser.evaluate(`(()=>{const s=roofWallScene();s.camera.position.x+=.0001;s.invalidate()})()`)
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const original = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/final-composite.png`, Buffer.from(original.data, 'base64'))
  const result = await browser.evaluate(`(async()=>{
    const {Raycaster}=await import('/node_modules/three/build/three.module.js'),s=roofWallScene();s.scene.updateMatrixWorld(true);
    const meshes=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)});
    const ray=new Raycaster();ray.setFromCamera({x:-.4,y:.3},s.camera);
    const hit=ray.intersectObjects(meshes,false)[0],m=hit.object.material[hit.face.materialIndex],rect=s.gl.domElement.getBoundingClientRect();
    return {materialKey:hit.object.userData.wallMaterialKeys[hit.face.materialIndex],color:m.color.getHexString(),map:!!m.map,
      cuts:s.gl.properties.get(m).uniforms.hdOpeningPreviewCount.value,
      sample:{left:Math.floor(rect.left+rect.width*.3),top:Math.floor(rect.top+rect.height*.35)},
      giGeneration:s.scene.userData.indirectLighting.generation};
  })()`)
  assert.equal(result.color, 'eee9dc')
  assert.equal(result.map, false)
  assert.equal(result.cuts, 0, 'an unchanged bedroom wall must not be discarded by an edit preview')
  const png = Buffer.from(original.data, 'base64')
  const pixel = await sharp(png).extract({ ...result.sample, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  result.displayRGB = [...pixel]
  assert.ok(Math.max(...pixel) - Math.min(...pixel) < 45 && pixel[0] > 100,
    `the rendered room face must show Timeless paint, received ${[...pixel]}`)
  assert.equal(await browser.evaluate('roofWallScene().scene.userData.indirectLighting.generation'), result.giGeneration,
    'checking a material must not restart lighting')
  assert.deepEqual(browser.errors, [])
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2))
  console.log('PASS Colin bedroom renders its saved Timeless finish', JSON.stringify(result))
} finally { browser.close() }
