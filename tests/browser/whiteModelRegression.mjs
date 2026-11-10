import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='tmp/white-model';mkdirSync(out,{recursive:true})
try{
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?lighting-startup&bed-gi`})
  await b.wait(`window.roofWallScene?.()?.scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.shaderWarmupPending`,300000)
  await b.evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(6.8,1.8,3.5);s.camera.lookAt(3.5,.9,1.7);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('button[aria-controls="three-settings-menu"]').click()})()`)
  await b.wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='White model')`)
  await b.evaluate(`window.whiteInput=()=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='White model').querySelector('input');document.querySelector('#three-settings-menu').style.visibility='hidden';window.materialsBefore=[];roofWallScene().scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])if(!materialsBefore.some(e=>e.m===m))materialsBefore.push({m,color:m.color?.getHex(),map:m.map,normalMap:m.normalMap,metalness:m.metalness,roughness:m.roughness})});true`)
  const state=()=>b.evaluate(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return {generation:g.generation,faces:g.capturedFaces,programs:s.gl.info.programs.map(p=>p.id),warmup:!!s.scene.userData.shaderWarmupPending}})()`)
  const capture=async name=>{await new Promise(r=>setTimeout(r,700));const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/'+name+'.png',Buffer.from(p.data,'base64'))}
  await capture('normal');const before=await state()
  await b.evaluate(`whiteInput().click()`);await capture('white')
  assert.deepEqual(await state(),before,'white mode preserves GI and shader programs')
  const check=await b.evaluate(`(()=>{const s=roofWallScene();const u=materialsBefore.map(({m})=>s.gl.properties.get(m).uniforms).filter(u=>u?.hdWhiteModel);return {bound:u.length,white:u.every(u=>u.hdWhiteModel.value===1),original:materialsBefore.every(e=>e.color===e.m.color?.getHex()&&e.map===e.m.map&&e.normalMap===e.m.normalMap&&e.metalness===e.m.metalness&&e.roughness===e.m.roughness),glError:s.gl.getContext().getError()}})()`)
  assert.ok(check.bound>4);assert.ok(check.white&&check.original);assert.equal(check.glError,0)
  await b.evaluate(`whiteInput().click()`);await capture('restored');assert.deepEqual(await state(),before)
  assert.deepEqual(b.errors,[]);writeFileSync(out+'/result.json',JSON.stringify({before,check},null,2));console.log('PASS',JSON.stringify(check))
}finally{b.close()}
