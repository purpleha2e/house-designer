import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gzipSync,gunzipSync} from 'node:zlib'
import {DataUtils} from 'three'
import {evaluate,call,select,menu,closeMenu,wait,ready} from './skyIntensityClient.mjs'
const out='docs/sky-intensity'
await wait(ready)
// Select a value different from the persisted fixture, so the cancellation
// check cannot pass simply by restoring an already completed saved field.
const finalSky=await evaluate("new URLSearchParams(location.search).get('skyStrength')==='1.5'?2:1.5")
const before=await evaluate('(()=>{const s=roofWallScene();return {generation:s.scene.userData.indirectLighting.generation,builds:s.scene.userData.indirectLighting.geometryBuilds,sun:regressionSunPosition}})()')
await select('Sky intensity',0);await closeMenu();await wait('roofWallScene().scene.userData.indirectLighting.generation>'+before.generation);await wait('roofWallScene().scene.userData.indirectLighting.completed>0&&!roofWallScene().scene.userData.indirectLighting.saved');
const interrupted=await evaluate('(()=>{const g=roofWallScene().scene.userData.indirectLighting;return{generation:g.generation,completed:g.completed,builds:g.geometryBuilds}})()')
await menu()
const changes=await evaluate(`(async()=>{const events=[];for(const value of [3,.5,2,0,3,1,.5,${finalSky}]){const e=document.querySelector('[aria-label="Sky intensity"]');e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));events.push({value,at:performance.now()});await new Promise(r=>setTimeout(r,140))}return events})()`)
await closeMenu();await wait('roofWallScene().scene.userData.getBakedIndirectLighting()?.settings.skyStrength==='+finalSky);await wait(ready)
await new Promise(r=>setTimeout(r,3000));await wait(ready)
const final=await evaluate('(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return {generation:g.generation,builds:g.geometryBuilds,passes:g.fullPassPublications,sky:s.scene.userData.getBakedIndirectLighting().settings.skyStrength,sun:regressionSunPosition,coefficients:s.scene.userData.getLightingField().coefficients.map(a=>Array.from(a))}})()')
assert.equal(final.sky,finalSky);assert.equal(final.passes,6);assert.deepEqual(final.sun,before.sun)
const reference=JSON.parse(fs.readFileSync(out+'/white-sky-'+finalSky+'.json'));let max=0,peak=0,sum=0,count=0
for(let c=0;c<3;c++)for(let i=0;i<final.coefficients[c].length;i++){const a=DataUtils.fromHalfFloat(final.coefficients[c][i]),b=DataUtils.fromHalfFloat(reference.coefficients[c][i]);max=Math.max(max,Math.abs(a-b));peak=Math.max(peak,Math.abs(b));sum+=Math.abs(a-b);count++}
assert.ok(max<.005+peak*.02,'latest rapid-change field agrees with the isolated selected-intensity field')
assert.ok(final.generation>before.generation);assert.equal(final.builds,interrupted.builds,"rapid sky changes retain the prepared BVH");const rapid={before,interrupted,changes,final:{...final,coefficients:undefined},difference:{max,peak,mean:sum/count}}
fs.writeFileSync(out+'/rapid-changes.json',JSON.stringify(rapid,null,2));console.log('PASS latest rapid change wins',rapid.difference)
const cache=await evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()');fs.writeFileSync(out+'/restored-cache.json.gz',gzipSync(JSON.stringify(cache)))
const project=JSON.parse(gunzipSync(fs.readFileSync(out+'/white-project.json.gz')));project.indirectLighting=cache;project.threeDView.ambientLighting={...project.threeDView.ambientLighting,skyStrength:finalSky};fs.writeFileSync('tmp/sky-intensity-project.json',JSON.stringify(project))
await call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin&bedroom-daylight&skyStrength='+finalSky+'&sky-intensity&lightingProfile=1'})
await wait('!!window.roofWallScene?.()?.scene.userData.getLightingField');await wait(ready)
const restored=await evaluate('(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return{source:g.source,sky:s.scene.userData.getBakedIndirectLighting()?.settings.skyStrength,builds:g.geometryBuilds,captured:g.capturedFaces,coefficients:s.scene.userData.getLightingField().coefficients.map(a=>Array.from(a))}})()')
assert.equal(restored.sky,finalSky);assert.equal(restored.source,'saved');assert.deepEqual(restored.coefficients,final.coefficients)
fs.writeFileSync(out+'/saved-restoration.json',JSON.stringify({...restored,coefficients:undefined,exactCoefficients:true},null,2));console.log('PASS saved GI restored exactly')
