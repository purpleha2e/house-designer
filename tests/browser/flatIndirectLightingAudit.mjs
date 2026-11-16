// Vite must be running on LIGHTING_TEST_URL (default :5188).
// node tests/browser/flatIndirectLightingAudit.mjs landing distance-local
// node tests/browser/flatIndirectLightingAudit.mjs room legacy
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'

const scene=process.argv[2]??'room',mode=process.argv[3]??'distance-local'
if(!['room','landing'].includes(scene)||!['legacy','distance-local'].includes(mode))throw Error('Expected room|landing legacy|distance-local')
const base=process.env.LIGHTING_TEST_URL??'http://127.0.0.1:5188',out=`tmp/flat-lighting/audit-${scene}-${mode}`
mkdirSync(out,{recursive:true})
const b=await lightingBrowser()
try{
 if(scene==='landing'){
  await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('/springfield_14.json')).json();p.indirectLighting.settings.lights=false;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
  await b.call('Page.navigate',{url:`${base}/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2&giSpatial=${mode}`})
  await b.wait('!!window.perfScene?.()',240000)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  const deadline=Date.now()+900000
  while(!await b.evaluate(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)){
   if(Date.now()>deadline)throw Error('Landing GI preparation timed out')
   await new Promise(r=>setTimeout(r,1000))
  }
  await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await new Promise(r=>setTimeout(r,2000))
 }else{
  await b.call('Page.navigate',{url:`${base}/tests/browser/probeDaylightReference.html?probe&lightingDiagnostics&giSpatial=${mode}`})
  await b.wait('!!window.probeDaylight&&!!window.houseDesignerLighting')
  await b.evaluate(`probeDaylight.run('direct',6,false)`)
 }
 const measurements=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.${scene==='landing'?'measureSpringfieldLanding':'measureFlatIndirectLighting'}()})()`)
 writeFileSync(`${out}/measurements.json`,JSON.stringify(measurements,null,2))
 console.log('MEASURED',measurements.points.map(p=>[p.name,p.inspection.bounces.firstBrightness,p.inspection.bounces.finalBrightness]))
 const interaction=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.measureLightingInteraction()})()`)
 writeFileSync(`${out}/interaction.json`,JSON.stringify(interaction,null,2))
 assert.deepEqual(interaction.after,interaction.before,'camera motion must not regenerate GI or compile programs')
 if(scene==='landing'){
  const materials={}
  for(const [name,display,strength]of [['combined','Final composite',1],['direct','Direct lighting only',1],['indirect','Probe indirect only',1],['gi-off','Final composite',0],['false-colour','Indirect irradiance false colour',1]]){
   materials[name]=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.captureLandingMaterial('${display}',${strength})})()`)
   await b.evaluate(`houseDesignerLighting.setMode('${display}');perfScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=${strength};perfScene().invalidate()`)
   await new Promise(r=>setTimeout(r,500))
   writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  writeFileSync(`${out}/materials.json`,JSON.stringify(materials,null,2))
  await b.evaluate(`houseDesignerLighting.setMode('Final composite');perfScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=1;perfScene().invalidate()`)
  if(process.argv.includes('--physical')){
   await b.evaluate(`document.querySelector('[aria-label="Lighting diagnostics"]').style.visibility='hidden'`)
   const physical=[]
   for(const stops of [0,1,2]){
    await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await b.evaluate(`(()=>{const input=document.querySelector('[aria-label="View exposure"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${stops});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await new Promise(r=>setTimeout(r,400))
    await b.evaluate(`perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value=0;perfScene().invalidate()`)
    await new Promise(r=>setTimeout(r,500))
    writeFileSync(`${out}/zero-fill-${stops}ev.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
    physical.push(await b.evaluate(`({exposure:perfScene().gl.toneMappingExposure,fill:perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value,generation:perfScene().scene.userData.indirectLighting.generation,faces:perfScene().scene.userData.indirectLighting.capturedFaces,programs:perfScene().gl.info.programs.length})`))
   }
   writeFileSync(`${out}/physical.json`,JSON.stringify(physical,null,2))
  }
  if(process.argv.includes('--export-fixture')){
   const fixture=await b.evaluate(`(async()=>{const cache=perfScene().scene.userData.getBakedIndirectLighting();if(!cache)return null;const p=await(await fetch('/springfield_14.json')).json();p.indirectLighting=cache;return p})()`)
   if(fixture)writeFileSync(`${out}/daylight-fixture.json`,JSON.stringify(fixture))
  }
  if(process.argv.includes('--reference')){
   const reference=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.referenceSpringfieldLanding()})()`)
   writeFileSync(`${out}/reference.json`,JSON.stringify(reference,null,2))
  }
 }
 writeFileSync(`${out}/status.json`,JSON.stringify(await b.evaluate(`(()=>{const s=window.perfScene?.()?.scene??probeDaylight.scene;return {status:s.userData.indirectLighting,performance:s.userData.getLightingPerformance(),spatial:s.userData.getLightingField().spatialInterpolation}})()`),null,2))
 // Existing unrelated merge fallback emits both messages in this saved house.
 writeFileSync(`${out}/console.json`,JSON.stringify(b.errors,null,2))
 const shaderErrors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e))
 if(shaderErrors.length)throw Error(shaderErrors.join('\n'))
 console.log('SAVED',out,'warnings',b.errors.length)
}finally{b.close()}
