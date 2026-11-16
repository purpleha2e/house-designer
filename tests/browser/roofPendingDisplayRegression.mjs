import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', {url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofPendingDisplayRegression.html`})
  await b.wait('!!window.roofDisplay')
  await new Promise(resolve => setTimeout(resolve, 1000))
  await b.evaluate(`(() => {
    const gl=roofDisplay.state.gl, render=gl.render.bind(gl);
    window.displayedRoof=[];
    gl.render=(scene,camera)=>{const materials=[];scene.traverse(o=>{if(o.isMesh && o.geometry.parameters?.height===.15)materials.push({color:o.material.color.getHexString(),opacity:o.material.opacity})});window.displayedRoof=materials;return render(scene,camera)};
    roofDisplay.create();
  })()`)
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(await b.evaluate('!!roofDisplay.state.scene.userData.geometryEditPreview'), false, 'wait for completed geometry')
  const started = Date.now()
  await b.evaluate('roofDisplay.geometryReady()')
  await b.wait('roofDisplay.state.scene.userData.geometryEditPreview?.displayed===true', 15000)
  assert.deepEqual(await b.evaluate('displayedRoof'), [{color:'4b5563',opacity:1}], 'draw the solid roof while lighting is still blocked')
  console.log(`Solid roof displayed while shaders remain blocked: ${Date.now()-started} ms`)
  await b.evaluate('roofDisplay.finish()')
  await b.wait('!roofDisplay.state.scene.userData.geometryEditPreview')
  assert.deepEqual(await b.evaluate('displayedRoof'), [{color:'4b5563',opacity:1}])
  assert.deepEqual(b.errors, [])
} finally { b.close() }
