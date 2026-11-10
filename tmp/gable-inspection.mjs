import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { lightingBrowser } from '../tests/browser/lightingHarness.mjs'

const out = 'tmp/gable-inspection', report = {}, assetRoot = resolve('manufacturer-assets'), assetErrors = []
let b
b = await lightingBrowser({ onEvent: event => {
  if (event.method !== 'Fetch.requestPaused') return
  void (async () => {
    const { requestId, request } = event.params
    const path = resolve(assetRoot, decodeURIComponent(new URL(request.url).pathname.slice('/manufacturer-assets/'.length)))
    try {
      if (request.method !== 'GET' || !path.startsWith(assetRoot + sep)) throw Error('Only read-only project assets are permitted')
      const body = await readFile(path)
      const type = ({ '.glb':'model/gltf-binary', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.json':'application/json' })[extname(path)] ?? 'application/octet-stream'
      await b.call('Fetch.fulfillRequest', { requestId, responseCode:200, responseHeaders:[{name:'Content-Type',value:type}], body:body.toString('base64') })
    } catch (error) { assetErrors.push(String(error)); await b.call('Fetch.failRequest', {requestId,errorReason:'Failed'}) }
  })()
} })
mkdirSync(out,{recursive:true})
try {
 await b.call('Fetch.enable',{patterns:[{urlPattern:'*/manufacturer-assets/*',requestStage:'Request'}]})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin&saved-colin'})
 await b.wait(`(()=>{const u=window.roofWallScene?.()?.scene.userData;return u?.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.indirectScanPending})()`,300000)
 await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(1.26,4.5,22);s.camera.lookAt(1.26,5.3,17.9);s.camera.updateMatrixWorld();s.invalidate();return true})()`)
 await new Promise(r=>setTimeout(r,1500))
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/after.png',Buffer.from(shot.data,'base64'))
 console.log(await b.evaluate(`(async()=>{const{Raycaster,Vector3}=await import('/node_modules/.vite/deps/three.js');const s=roofWallScene(),meshes=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole?.startsWith('roof-'))meshes.push(o)});return [0,.4,.8,1.26,1.7,2.1,2.5].map(x=>({x,hits:new Raycaster(new Vector3(x,5.5,19),new Vector3(0,.3,-1).normalize()).intersectObjects(meshes).slice(0,4).map(h=>({p:h.point.toArray(),role:h.object.userData.houseDesignerRole,roof:h.object.userData.roofId}))}))})()`))
 console.log(b.errors)
} finally { b.close() }