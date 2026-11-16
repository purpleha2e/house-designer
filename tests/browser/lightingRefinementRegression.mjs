import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out='tmp/lighting-refinement';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={};
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression,timeout=900000){const end=Date.now()+timeout;while(!await b.evaluate(expression)){status.current=await b.evaluate('window.perfScene?.()?.scene.userData.localSunPreview??window.perfScene?.()?.scene.userData.indirectLighting');save();if(Date.now()>end)throw Error('Timed out: '+expression);await new Promise(r=>setTimeout(r,1000))}}
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
const menu=()=>b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
const choose=async quality=>{await menu();await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Lighting refinement"]');e.value=${JSON.stringify(quality)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await menu()}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/tmp/flat-lighting/audit-landing-legacy/daylight-fixture.json')).text()],'springfield_14.json')}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('[aria-label="Lighting diagnostics"]').style.visibility='hidden'})()`)
 await new Promise(r=>setTimeout(r,1500));await shot('before')
 await menu()
 // Retain the historical daylight-only comparison using explicit Custom
 // settings; the public menu now starts in Build.
 await b.evaluate(`document.querySelector('.viewport-advanced-settings').open=true;document.querySelector('[aria-label="Use custom lighting"]').click()`)
 await wait(`document.querySelector('[aria-label="Lighting view"]').value==='custom'`)
 await b.evaluate(`(()=>{const input=document.querySelector('[aria-label="View exposure"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,2);input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await b.evaluate(`(()=>{const input=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,0);input.dispatchEvent(new Event('input',{bubbles:true}));for(const name of ['Shadows','Light shadows']){const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===name),check=label?.querySelector('input');if(check&&!check.checked)check.click()}})()`)
 assert.equal(await b.evaluate(`Number(document.querySelector('[aria-label="View exposure"]').value)`),2)
 await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Lighting refinement"]');e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
 await b.evaluate(`document.querySelector('[aria-label="Refine this view"]').click()`)
 await menu()
 status.stage='high';save()
 await wait(`(()=>{const p=perfScene().scene.userData.localSunPreview;return p?.complete&&p.active||p?.message?.startsWith('Preview unavailable')})()`)
 status.high=await b.evaluate('perfScene().scene.userData.localSunPreview');assert.equal(status.high.active,true,JSON.stringify(status.high));assert.equal(status.high.rays,64)
 await shot('high');status.memoryHigh=await b.evaluate('perfScene().gl.info.memory');save()
 const counters=()=>b.evaluate(`({generation:perfScene().scene.userData.indirectLighting.generation,faces:perfScene().scene.userData.indirectLighting.capturedFaces})`)
 status.beforeMotion=await counters()
 status.staleHidden=await b.evaluate(`(()=>{const s=perfScene();s.camera.position.x+=.1;s.camera.updateMatrixWorld();s.invalidate();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(s.scene.userData.getIndirectUniforms().hdLocalSunReady.value===0))))})()`);assert.equal(status.staleHidden,true)
 await choose('balanced');await menu();await b.evaluate(`document.querySelector('[aria-label="Refine this view"]').click()`);await menu();await wait(`perfScene().scene.userData.localSunPreview?.complete&&perfScene().scene.userData.localSunPreview?.active`)
 status.balanced=await b.evaluate('perfScene().scene.userData.localSunPreview');assert.equal(status.balanced.rays,32)
 await shot('balanced')
 await choose('fast');await wait('!perfScene().scene.userData.localSunPreview')
 await new Promise(r=>setTimeout(r,1500))
 status.disabled=await b.evaluate('perfScene().scene.userData.getIndirectUniforms().hdLocalSunFeature.value===0&&perfScene().scene.userData.getIndirectUniforms().hdLocalSunReady.value===0');assert.equal(status.disabled,true)
 status.afterMotion=await counters();assert.deepEqual(status.afterMotion,status.beforeMotion)
 status.memoryFast=await b.evaluate('perfScene().gl.info.memory');assert.ok(status.memoryFast.textures<status.memoryHigh.textures)
 await b.evaluate(`(()=>{const s=perfScene();s.camera.position.x-=.1;s.camera.updateMatrixWorld();s.invalidate()})()`);await new Promise(r=>setTimeout(r,400));await shot('fast-zero-fill')
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(errors,[])
 status.stage='passed';save();console.log(JSON.stringify(status))
}catch(error){status.stage='failed';status.error=String(error);save();throw error}finally{b.close()}
