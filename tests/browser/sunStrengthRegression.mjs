import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
const project=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/project.json.gz')))
project.indirectLighting=JSON.parse(gunzipSync(fs.readFileSync('docs/bedroom-daylight/completed-baseline-cache.json.gz')))
fs.writeFileSync('tmp/bedroom-live-project.json',JSON.stringify(project))
const b=await lightingBrowser(),results=[]
const ready=`(()=>{const u=roofWallScene().scene.userData,g=u.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.saving&&!g.volumePending&&!u.shaderWarmupPending&&u.progressiveStartup?.phase==='full'})()`
try{
 await b.call('Page.navigate',{url:'http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&bedroom-live&lightingProfile=1'})
 await b.wait('!!window.roofWallScene?.()?.scene.userData.indirectLighting',600000);await b.wait(ready,600000)
 for(const strength of [0,.5,2,4,1]){
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
  await b.wait(`!!document.querySelector('[aria-label="Sun strength"]')`)
  const before=await b.evaluate(`(()=>{const s=roofWallScene();window.strengthStarted=performance.now();const e=document.querySelector('[aria-label="Sun strength"]');const before={generation:s.scene.userData.indirectLighting.generation,programs:s.gl.info.programs.length};e.value='${strength}';e.dispatchEvent(new Event('change',{bubbles:true}));return before})()`)
  await b.wait(`regressionSunPosition.strength===${strength}`)
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
  // A restored field has no retained surface-capture atlas. Its first edit
  // prepares that cache; subsequent edits exercise the warm scheduling path.
  const timeout=results.length?120000:600000
  await b.wait(`roofWallScene().scene.userData.indirectLighting.generation>${before.generation}`,timeout);await b.wait(ready,timeout)
  const result=await b.evaluate(`(()=>{const s=roofWallScene(),sun=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')sun.push(o)});return{strength:${strength},elapsedMs:performance.now()-strengthStarted,programs:s.gl.info.programs.length,before:${JSON.stringify(before)},sunIntensity:sun[0].intensity,passes:s.scene.userData.indirectLighting.fullPassPublications,geometryBuilds:s.scene.userData.indirectLighting.geometryBuilds}})()`)
  assert.ok(Math.abs(result.sunIntensity-1.3*strength)<1e-8);assert.equal(result.passes,6);results.push(result);console.log('strength',strength,'ready in',result.elapsedMs,'ms')
 }
 assert.deepEqual(b.errors,[])
 await b.call('Page.navigate',{url:'http://localhost:5181/docs/bedroom-daylight/index.html'})
 await b.wait('document.querySelectorAll("img").length===6')
 const checks=[]
 for(const view of ['window','sunlit-wall']){
  await b.evaluate(`(()=>{const s=document.querySelector('#view');s.value='${view}';s.dispatchEvent(new Event('change'));return true})()`)
  await b.wait('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)',30000)
  checks.push(await b.evaluate(`({view:'${view}',images:Array.from(document.images).map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,height:i.naturalHeight}))})`))
 }
 const shot=await b.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('docs/bedroom-daylight/gallery-review.png',Buffer.from(shot.data,'base64'))
 fs.writeFileSync('docs/bedroom-daylight/gallery-review.json',JSON.stringify({checks,errors:b.errors},null,2))
 assert.deepEqual(b.errors,[])
}finally{
 fs.writeFileSync('docs/bedroom-daylight/dropdown-regression.json',JSON.stringify({results,errors:b.errors,renderPauseInterventions:0},null,2));await b.close()
}
