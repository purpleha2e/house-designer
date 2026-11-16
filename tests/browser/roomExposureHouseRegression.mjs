import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out='tmp/room-exposure-house';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={}
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression){const end=Date.now()+600000;while(!await b.evaluate(expression)){save();if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,1000))}}
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
const menu=()=>b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
const move=(position,target)=>b.evaluate(`(()=>{const s=perfScene();s.camera.position.set(${position});s.camera.lookAt(${target});s.camera.updateMatrixWorld();s.invalidate()})()`)
const counters=()=>b.evaluate(`({generation:perfScene().scene.userData.indirectLighting.generation,faces:perfScene().scene.userData.indirectLighting.capturedFaces})`)
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('/tmp/flat-lighting/audit-landing-legacy/daylight-fixture.json')).json();p.threeDView.exposureStops=0;p.threeDView.ambientLighting.ambientTerm=0;p.threeDView.ambientLighting.nightAmbientTerm=0;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';document.querySelector('[aria-label="Lighting diagnostics"]').style.visibility='hidden'`)
 await move([6.4,4.15,5.1],[9.9,4,3.9]);await new Promise(r=>setTimeout(r,2000));await shot('bedroom-manual')
 status.before=await counters();status.stage='adaptation';save()
 await menu();assert.equal(await b.evaluate(`document.querySelector('[aria-label="Adapt exposure to room"]').checked`),false)
 await b.evaluate(`document.querySelector('[aria-label="Adapt exposure to room"]').click()`)
 assert.equal(await b.evaluate(`Number(document.querySelector('[aria-label="View exposure"]').value)`),0)
 await menu();await new Promise(r=>setTimeout(r,8000));await shot('bedroom-adapted')
 await move([10.3,4.15,11.15],[10.3,4.05,5.9]);await new Promise(r=>setTimeout(r,8000));await shot('landing-adapted')
 await menu();await b.evaluate(`document.querySelector('[aria-label="Adapt exposure to room"]').click()`);await menu()
 await new Promise(r=>setTimeout(r,2000));await shot('landing-manual')
 status.after=await counters();assert.deepEqual(status.after,status.before)
 assert.equal(await b.evaluate(`perfScene().gl.toneMappingExposure`),1)
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(errors,[])
 status.stage='passed';save();console.log(JSON.stringify(status))
}catch(error){status.error=String(error);save();throw error}finally{b.close()}
