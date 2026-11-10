import { localAssetLightingBrowser } from '../tests/browser/localAssetLightingBrowser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
const b = await localAssetLightingBrowser(), out = 'tmp/eave-junction-audit'
mkdirSync(out, {recursive:true})
try {
  await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&saved-colin&materials'})
  const ready = `(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&u.ambientFillBudget?.exteriorSkyReady})()`
  await b.wait(ready,300000)
  console.log('House ready')
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(9,4,-2);s.camera.lookAt(5.5,5,4.9);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('button[aria-controls="three-settings-menu"]').click()})()`)
  await b.evaluate(`(()=>{document.querySelector('#three-settings-menu').style.visibility='hidden';[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Exterior sky occlusion (experimental)').querySelector('input').click()})()`)
  await b.wait(`roofWallScene().scene.userData.exteriorSkyOcclusion?.state==='ready'&&${ready}`,300000)
  const capture = async name => {await new Promise(r=>setTimeout(r,700));const s=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(s.data,'base64'))}
  await capture('on')
  console.log('Field ready',await b.evaluate('roofWallScene().scene.userData.exteriorSkyOcclusion'))
  await b.evaluate(`(()=>{const s=roofWallScene();window.eaveLayers=s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value;s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=0;s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
  await capture('coarse-only')
  await b.evaluate(String.raw`(async()=>{const s=roofWallScene(),{requestShaderWarmup}=await import('/src/shaderWarmupState.ts');s.scene.userData.getIndirectUniforms().hdExteriorEaveLayers.value=window.eaveLayers;window.eaveAudit={value:0};const seen=new Set();s.scene.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(seen.has(m)||!m.customProgramCacheKey().includes('-exterior-sky'))continue;seen.add(m);const old=m.onBeforeCompile,key=m.customProgramCacheKey();m.onBeforeCompile=function(shader,...args){old.call(this,shader,...args);shader.uniforms.eaveAudit=window.eaveAudit;shader.fragmentShader='uniform float eaveAudit; float auditGI=-2.0;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('bool hdGIHasReceiver = hdGIId >= 0.0;','auditGI=hdGIId; bool hdGIHasReceiver = hdGIId >= 0.0;').replace('#include <opaque_fragment>',
  'if(eaveAudit>0.5){vec3 auditNormal=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));if(eaveAudit<1.5)outgoingLight=vec3(hdExteriorEaveVisibility(hdGIWorldPosition,auditNormal));else outgoingLight=auditGI>=0.0?vec3(1,0,0):vec3(0,1,0);}\n#include <opaque_fragment>');};m.customProgramCacheKey=()=>key+'-eave-audit';m.needsUpdate=true;}});requestShaderWarmup(s.scene);s.invalidate()})()`)
  await b.wait(ready,300000)
  for(const [mode,name] of [[1,'eave-visibility'],[2,'receiver-classification']]){
    await b.evaluate(`(()=>{eaveAudit.value=${mode};const s=roofWallScene();s.scene.userData.displayEffectRevision++;s.invalidate()})()`)
    await capture(name)
  }
  console.log(JSON.stringify({errors:b.errors,assets:b.assetErrors}))
} finally {b.close()}
