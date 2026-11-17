import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out='tmp/editor-view-lighting';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={}
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression){const end=Date.now()+600000;while(!await b.evaluate(expression)){save();if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,1000))}}
const menu=()=>b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
const move=(p,t)=>b.evaluate(`(()=>{const s=perfScene();s.camera.position.set(${p});s.camera.lookAt(${t});s.camera.updateMatrixWorld();s.invalidate()})()`)
const select=(label,value)=>b.evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
const lighting=()=>b.evaluate(`(()=>{const s=perfScene(),u=s.scene.userData;return{exposure:s.gl.toneMappingExposure,fill:u.getIndirectUniforms().hdGIIndoorFill.value,generation:u.indirectLighting.generation,faces:u.indirectLighting.capturedFaces,refinement:!!u.localSunPreview,dpr:s.gl.getPixelRatio()}})()`)
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('house-designer.room-exposure.v1','true');localStorage.setItem('house-designer-lighting-refinement-v1','high');window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('/tmp/springfield-motion/springfield_14.json')).json();p.threeDView.exposureStops=2;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const u=perfScene()?.scene.userData,i=u?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!u.shaderWarmupPending&&u.localShadowAtlas?.ready&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`document.querySelector('.editor-grid').style.gridTemplateColumns='120px 8px minmax(360px,1fr)'`)
 await move([10.3,4.15,11.15],[10.3,4.05,5.9]);await new Promise(r=>setTimeout(r,1800))
 status.build=await lighting();assert.equal(status.build.fill,.16);assert.equal(status.build.exposure,Math.sqrt(2));assert.equal(status.build.refinement,false)
 await menu();await wait(`!!document.querySelector('[aria-label="Lighting view"]')`)
 assert.equal(await b.evaluate(`document.querySelector('[aria-label="Lighting view"]').value`),'build')
 assert.equal(await b.evaluate(`document.querySelector('.viewport-advanced-settings').open`),false)
 assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="View quality"]')`),false)
 assert.equal(status.build.dpr,1)
 await shot('build-menu');await menu();await shot('build-landing')
 await move([6.4,4.15,5.1],[9.9,4,3.9]);await new Promise(r=>setTimeout(r,1500));await shot('build-bedroom')
 await menu();await select('Lighting view','lighting');await menu();await new Promise(r=>setTimeout(r,5000));await shot('lighting-bedroom')
 status.lighting=await lighting();assert.equal(status.lighting.fill,0);assert.equal(status.lighting.exposure,2);assert.equal(status.lighting.generation,status.build.generation);assert.equal(status.lighting.faces,status.build.faces)
 await move([10.3,4.15,11.15],[10.3,4.05,5.9]);await new Promise(r=>setTimeout(r,5000));await shot('lighting-landing')
 assert.equal((await lighting()).dpr,1)
 await menu();await b.evaluate(`document.querySelector('.viewport-advanced-settings').open=true;document.querySelector('[aria-label="Use custom lighting"]').click()`)
 await wait(`document.querySelector('[aria-label="Lighting view"]').value==='custom'&&perfScene().gl.toneMappingExposure===4&&perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value===.32`)
 status.custom=await lighting();assert.equal(status.custom.exposure,4);assert.equal(status.custom.fill,.32)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset view defaults').click()`)
 await wait(`document.querySelector('[aria-label="Lighting view"]').value==='build'&&perfScene().gl.toneMappingExposure===Math.sqrt(2)&&perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value===.16`)
 status.reset=await lighting();assert.equal(status.reset.exposure,Math.sqrt(2));assert.equal(status.reset.fill,.16);assert.equal(status.reset.refinement,false)
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(errors,[])
 status.stage='passed';save();console.log(JSON.stringify(status))
}catch(error){status.error=String(error);save();throw error}finally{b.close()}
