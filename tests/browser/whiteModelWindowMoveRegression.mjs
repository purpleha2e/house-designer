import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser(), output = 'tmp/white-window-move'
mkdirSync(output, { recursive: true })
const report = {}
try {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?colin&saved-colin` })
  const ready = `(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending})()`
  await browser.wait(ready, 300000)
  console.log('House ready')
  await browser.evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
  await browser.wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='White model')`)
  await browser.evaluate(`window.whiteCheckbox=text=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===text)?.querySelector('input');if(!whiteCheckbox('White model').checked)whiteCheckbox('White model').click()`)
  await browser.evaluate(`window.inspectWhiteSurfaces=async()=>{
    const {ShaderLib,UniformsUtils}=await import('/node_modules/.vite/deps/three.js'),s=roofWallScene(),surfaces=[];
    s.scene.traverse(o=>{if(!o.isMesh||!['roof-infill','wall-engine-render'].includes(o.userData.houseDesignerRole))return;
      for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m?.isMeshStandardMaterial)continue;
      const shader={uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms),vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
      m.onBeforeCompile(shader,s.gl);
      surfaces.push({role:o.userData.houseDesignerRole,batch:!!o.userData.wallSurfaceBatch,material:m.uuid,white:shader.uniforms.hdWhiteModel?.value??null,gi:!!shader.uniforms.hdGIEnabled,room:!!shader.uniforms.hdRoomLightEnabled});
    }});return surfaces;
  }`)
  await browser.wait('(async()=>{const surfaces=await inspectWhiteSurfaces();return surfaces.length>5&&surfaces.every(s=>s.white===1&&s.gi&&s.room)})()')
  report.before = await browser.evaluate('inspectWhiteSurfaces()')
  console.log('Before', JSON.stringify(report.before))
  await browser.evaluate(`window.oldWindowFloors=regressionFloors;regressionMoveWindow(.05)`)
  await browser.wait('regressionFloors!==oldWindowFloors')
  await new Promise(resolve => setTimeout(resolve, 3000))
  await browser.wait(ready, 300000)
  report.after = await browser.evaluate('inspectWhiteSurfaces()')
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/after.png`, Buffer.from(screenshot.data, 'base64'))
  console.log('After', JSON.stringify(report.after))
  assert.ok(report.before.length > 5)
  assert.ok(report.before.every(surface => surface.white === 1 && surface.gi))
  assert.ok(report.after.every(surface => surface.white === 1 && surface.gi && surface.room), 'window edits preserve White mode, GI and room lighting on every architectural surface')
  assert.deepEqual(browser.errors, [])
  console.log('PASS White mode survives window move')
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors: browser.errors }, null, 2))
  browser.close()
}
