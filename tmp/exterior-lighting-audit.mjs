import { localAssetLightingBrowser } from '../tests/browser/localAssetLightingBrowser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
const b = await localAssetLightingBrowser(), out = 'tmp/exterior-lighting-audit'
mkdirSync(out,{recursive:true})
try {
 await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&saved-colin&materials'})
 await b.wait(`(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&u.ambientFillBudget?.exteriorSkyReady})()`,300000)
 await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(9,6,-4);s.camera.lookAt(4,3.4,5.7);s.camera.updateMatrixWorld();s.invalidate();return true})()`)
 await new Promise(r=>setTimeout(r,2500))
 const capture=async name=>{await new Promise(r=>setTimeout(r,700));const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(shot.data,'base64'))}
 await capture('baseline')
 const report=await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms(),materials=[],lights=[];s.scene.traverse(o=>{if(o.isLight)lights.push({type:o.type,role:o.userData.houseDesignerRole,intensity:o.intensity,color:o.color.toArray()});if(o.isMesh&&o.userData.houseDesignerRole==='wall-engine-render')for(const m of Array.isArray(o.material)?o.material:[o.material])materials.push({name:m.name,color:m.color?.toArray(),map:m.map?.colorSpace,env:!!m.envMap,roughness:m.roughness,metalness:m.metalness})});return{lights,materials,sky:u.hdSkyDisplayRadianceBase.value.toArray(),sun:u.hdSkyDisplaySunIrradiance.value.toArray(),ambient:s.scene.userData.ambientFillBudget}})()`)
 await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms();window.savedSky=u.hdSkyDisplayRadianceBase.value.clone();window.savedSun=u.hdSkyDisplaySunIrradiance.value.clone();u.hdSkyDisplayRadianceBase.value.setScalar(0);u.hdSkyDisplaySunIrradiance.value.setScalar(0);s.scene.userData.displayEffectRevision++;s.invalidate();return true})()`)
 await capture('no-sky')
 await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms();u.hdSkyDisplayRadianceBase.value.copy(savedSky);u.hdSkyDisplaySunIrradiance.value.copy(savedSun);window.savedAmbient=[];s.scene.traverse(o=>{if(o.isAmbientLight||o.isHemisphereLight){savedAmbient.push(o);o.visible=false}});s.scene.userData.displayEffectRevision++;s.invalidate();return true})()`)
 await capture('no-ambient')
 await b.evaluate(`(()=>{const s=roofWallScene();savedAmbient.forEach(o=>o.visible=true);s.scene.traverse(o=>{if(o.isDirectionalLight)o.visible=false});s.scene.userData.displayEffectRevision++;s.invalidate();return true})()`)
 await capture('no-sun')
 writeFileSync(out+'/report.json',JSON.stringify({report,errors:b.errors,assets:b.assetErrors},null,2));console.log(JSON.stringify({report,errors:b.errors,assets:b.assetErrors}))
}finally{b.close()}
