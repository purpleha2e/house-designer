import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { localAssetLightingBrowser } from './localAssetLightingBrowser.mjs'

const out = 'tmp/exterior-sky-occlusion', report = {}
const b = await localAssetLightingBrowser(), assetErrors = b.assetErrors
mkdirSync(out, { recursive: true })
try {
  // Serve only this test browser's GET requests from local files. No asset
  // management service, write endpoint or additional listening port is needed.
  await b.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?colin&saved-colin&materials` })
  const ready = `(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&u.ambientFillBudget?.exteriorSkyReady})()`
  await b.wait(ready, 300000)
  console.log('House ready')
  await b.evaluate(`(async()=>{const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js'),s=roofWallScene(),box=new Box3();
    s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')box.union(new Box3().setFromObject(o))});
    const center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());window.skyView={center:center.toArray(),size:size.toArray()};
    s.camera.position.set(0,5.8,-6);s.camera.lookAt(4.8,2.8,6.7);s.camera.updateMatrixWorld();s.invalidate();
    document.querySelector('button[aria-controls="three-settings-menu"]').click();
    window.skyCheckbox=()=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Exterior sky occlusion (experimental)').querySelector('input');
    })()`)
  await b.wait(`!!document.querySelector('#three-settings-menu')`)
  await b.evaluate(`document.querySelector('#three-settings-menu').style.visibility='hidden'`)
  await b.evaluate(`window.setExteriorFill=value=>{const input=document.querySelector('input[aria-label="Exterior sky fill"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));};setExteriorFill(1)`)
  await b.wait('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyFill.value===1')
  const capture = async name => { await new Promise(r=>setTimeout(r,600)); const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(shot.data,'base64')) }
  const calls = () => b.evaluate(`(async()=>{const s=roofWallScene(),render=s.gl.render;return await new Promise(resolve=>{
    s.gl.render=function(scene,camera){const start=performance.now(),before=this.info.render.calls,result=render.apply(this,arguments);
      if(camera===s.camera){this.render=render;resolve({calls:this.info.render.calls-before,cpuMs:performance.now()-start,retained:!!scene.userData.retainedViewport})}return result};
    s.camera.position.x+=.000001;s.camera.updateMatrixWorld();s.invalidate();})})()`)
  await capture('before'); report.before = await calls()
  await b.evaluate('setExteriorFill(.75)')
  await b.wait('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyFill.value===.75')
  await capture('balanced-fill')
  await b.evaluate('skyCheckbox().click()')
  await b.wait(`roofWallScene().scene.userData.exteriorSkyOcclusion?.state==='ready'&&${ready}`, 300000)
  report.field = await b.evaluate('roofWallScene().scene.userData.exteriorSkyOcclusion')
  console.log('Field ready', JSON.stringify(report.field))
  assert.ok(report.field.eaveLayers > 0, 'roof heights are bound alongside sky visibility')
  report.receivers = await b.evaluate(`(async()=>{const {isExteriorSkyReceiver,isExteriorSkyOccluder}=await import('/src/exteriorSkyReceivers.ts');
    const {isLightingGlazing}=await import('/src/lightingVisibility.ts');const result={frames:0,shadedFrames:0,glazing:0,shadedGlazing:0},seen=new Set();
    roofWallScene().scene.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m||seen.has(m))continue;seen.add(m);
      const enabled=m.customProgramCacheKey().includes('-exterior-sky');if(isLightingGlazing(m)){result.glazing++;if(enabled)result.shadedGlazing++}
      else if(!isExteriorSkyOccluder(o)&&isExteriorSkyReceiver(o,m)){result.frames++;if(enabled)result.shadedFrames++}}});return result})()`)
  assert.ok(report.receivers.frames > 0)
  assert.equal(report.receivers.shadedFrames, report.receivers.frames, 'all solid opening finishes receive the field')
  assert.ok(report.receivers.glazing > 0)
  assert.equal(report.receivers.shadedGlazing, 0, 'glazing retains its reflections')
  await capture('after'); report.after = await calls()
  assert.equal(report.after.calls, report.before.calls, 'sky visibility adds no display draw calls')
  assert.ok(report.field.rays > 1000)
  assert.ok(await b.evaluate('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyStrength.value>0'))
  await b.evaluate('skyCheckbox().click()')
  await b.wait('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyStrength.value===0')
  await capture('off-again')
  await b.evaluate('skyCheckbox().click()')
  await b.wait('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyStrength.value>0')
  report.reenabled = await b.evaluate('roofWallScene().scene.userData.exteriorSkyOcclusion')
  assert.equal(report.reenabled.bakes, report.field.bakes, 'off/on reuses the field')
  assert.equal(report.reenabled.ms, report.field.ms)
  // Reproduce React preserving a pre-eave uniform object across a hot update.
  await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms();for(const key of Object.keys(u))if(key.startsWith('hdExteriorEave'))delete u[key];s.invalidate()})()`)
  await b.wait(`roofWallScene().scene.userData.getIndirectUniforms().hdExteriorEaveLayers?.value===${report.field.eaveLayers}&&${ready}`,300000)
  assert.equal(await b.evaluate('roofWallScene().scene.userData.exteriorSkyOcclusion.bakes'), report.field.bakes)
  await b.wait(`document.querySelector('#three-settings-menu').textContent.includes('Sky and eave shading ready')`)
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(4.1,3.8,-1);s.camera.lookAt(4.8,5.8,4.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await capture('eaves-on')
  await b.evaluate(`(()=>{const s=roofWallScene();s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=0;s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
  // The normal update restores uniforms only when a new field is bound.
  await capture('eaves-coarse-only')
  await b.evaluate(`(()=>{const s=roofWallScene();s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=${report.field.eaveLayers};s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(0,4.3,-2);s.camera.lookAt(4.8,4.6,4.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await capture('eave-junctions-on')
  await b.evaluate(`(()=>{const s=roofWallScene();s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=0;s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
  await capture('eave-junctions-coarse-only')
  await b.evaluate(`(()=>{const s=roofWallScene();s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=${report.field.eaveLayers};s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
  await b.evaluate('regressionMoveWindow(.05)')
  await b.wait(`roofWallScene().scene.userData.exteriorSkyOcclusion?.bakes>${report.field.bakes}&&roofWallScene().scene.userData.exteriorSkyOcclusion?.state==='ready'&&${ready}`,300000)
  report.edited = await b.evaluate('roofWallScene().scene.userData.exteriorSkyOcclusion')
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(1.8,1.7,1.2);s.camera.lookAt(3.8,1.2,4.9);s.camera.updateMatrixWorld();s.invalidate();return true})()`)
  await capture('patio-on')
  await b.evaluate('skyCheckbox().click()')
  await b.wait('roofWallScene().scene.userData.getIndirectUniforms().hdExteriorSkyStrength.value===0')
  await capture('patio-off')
  report.glError = await b.evaluate('roofWallScene().gl.getContext().getError()')
  assert.equal(report.glError,0); assert.deepEqual(b.errors,[]); assert.deepEqual(assetErrors,[])
  console.log('PASS exterior shading comparison, cached toggles and geometry invalidation', JSON.stringify(report))
} finally {writeFileSync(`${out}/report.json`,JSON.stringify({...report,errors:b.errors},null,2));b.close()}
