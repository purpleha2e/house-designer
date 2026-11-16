import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {projectFileInputFixtureSource} from '../tests/browser/projectFileInputFixture.mjs'
const out='tmp/lamps-shadow-audit';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={}
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression){const end=Date.now()+900000;while(!await b.evaluate(expression)){status.current=await b.evaluate('window.perfScene?.()?.scene.userData.indirectLighting');save();if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,1000))}}
async function shot(name){await new Promise(r=>setTimeout(r,1000));writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'));status[name]=await b.evaluate(`({gi:perfScene().scene.userData.indirectLighting,atlas:perfScene().scene.userData.localShadowAtlas,fill:perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value,exposure:perfScene().gl.toneMappingExposure})`);save()}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('/springfield_14.json')).json();p.threeDView.exposureStops=0;p.threeDView.ambientLighting.ambientTerm=0;p.threeDView.ambientLighting.nightAmbientTerm=0;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('[aria-label="Lighting diagnostics"]').style.visibility='hidden'})()`)
 await shot('unshadowed')
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
 await b.evaluate(`[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input').click()`)
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
 await wait('perfScene().scene.userData.localShadowAtlas?.ready&&!perfScene().scene.userData.shaderWarmupPending')
 await shot('shadowed')
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));if(errors.length)throw Error(errors.join('\n'))
 status.stage='passed';save();console.log('SAVED '+out)
}catch(error){status.error=String(error);save();throw error}finally{b.close()}
