import { localAssetLightingBrowser } from '../tests/browser/localAssetLightingBrowser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
const b=await localAssetLightingBrowser(),out='tmp/eaves-audit';mkdirSync(out,{recursive:true})
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&saved-colin&materials'})
 await b.wait(`(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending&&u.ambientFillBudget?.exteriorSkyReady})()`,300000)
 await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(4.1,3.8,-1);s.camera.lookAt(4.8,5.8,4.9);s.camera.updateMatrixWorld();s.invalidate();return true})()`)
 const capture=async name=>{await new Promise(r=>setTimeout(r,700));const s=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(s.data,'base64'))}
 await capture('before')
 await b.evaluate(`(()=>{const s=roofWallScene();window.hiddenCaps=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.solidGable){const a=o.geometry.attributes.normal,p=o.geometry.attributes.position;let caps=0;for(let i=0;i<a.count;i++)if(Math.abs(a.getY(i))>.01)caps++;if(caps){hiddenCaps.push(o);o.visible=false}}});s.scene.userData.displayEffectRevision++;s.invalidate();return true})()`)
 await capture('without-gable-caps')
 console.log(JSON.stringify({errors:b.errors,assets:b.assetErrors}))
}finally{b.close()}
