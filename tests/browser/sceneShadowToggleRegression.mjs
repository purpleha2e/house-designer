// Real saved Springfield scene: master/local switches must reuse prepared programs.
// node tests/browser/sceneShadowToggleRegression.mjs [vite-port]
import assert from 'node:assert/strict'
import {mkdirSync, writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='tmp/scene-shadow-toggle'
mkdirSync(out,{recursive:true})
const unexpected=()=>b.errors.filter(e=>!/^THREE\.BufferGeometryUtils: \.merge(Attributes|Geometries)\(\) failed/.test(e))
async function wait(e){const end=Date.now()+360000;while(!await b.evaluate(e)){assert.deepEqual(unexpected(),[]);if(Date.now()>end)throw Error(e);await new Promise(r=>setTimeout(r,150))}}
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(i,o)=>f(String(i?.url??i).includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')?'/src/models/assets/interior_door_closed.glb':i,o);window.confirm=()=>false;window.showOpenFilePicker=async()=>[{getFile:async()=>new File([await(await fetch('/springfield_14.json')).text()],'springfield_14.json')}];`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/editorRegression.html`})
  await wait('!!window.perfScene?.()')
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await wait(`perfScene().scene.userData.indirectLighting?.probes===308&&!document.querySelector('.viewport-preparing-overlay')&&!perfScene().scene.userData.shaderWarmupPending`)
  console.log('Springfield prepared')
  await b.evaluate(`(()=>{const s=perfScene();s.camera.position.set(10.1,3.8,8.3);s.camera.lookAt(10.5,4.4,11.78);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('button[aria-controls="three-settings-menu"]').click()})()`)
  await wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Shadows')`)
  await b.evaluate(`(()=>{const s=perfScene();window.shadowLights=[];s.scene.traverse(o=>{if(o.isLight&&o.castShadow)shadowLights.push(o)});window.shadowDraws=0;const draw=s.gl.renderBufferDirect.bind(s.gl);s.gl.renderBufferDirect=(camera,...args)=>{if(shadowLights.some(l=>l.shadow.camera===camera))shadowDraws++;return draw(camera,...args)};window.shadowInput=label=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===label).querySelector('input');})()`)
  const capture=async name=>{
    await b.evaluate(`document.querySelector('#three-settings-menu').style.visibility='hidden'`)
    const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(p.data,'base64'))
    await b.evaluate(`document.querySelector('#three-settings-menu').style.visibility=''`)
  }
  await new Promise(r=>setTimeout(r,1500));await capture('light-shadows-off')
  const results=[]
  for(const [label,enabled] of [['Light shadows',true],['Shadows',false],['Shadows',true],['Light shadows',false],['Shadows',false],['Shadows',true]]){
    const r=await b.evaluate(`(async()=>{const s=perfScene(),input=shadowInput(${JSON.stringify(label)}),before={programs:s.gl.info.programs.map(p=>p.id),warmups:s.scene.userData.shaderWarmupProfile.length,generation:s.scene.userData.indirectLighting.generation},maps=shadowLights.map(l=>l.shadow.map);const start=performance.now();if(input.checked!==${enabled})input.click();const appliedMs=performance.now()-start;const immediate=shadowLights.map(l=>({type:l.type,intensity:l.shadow.intensity}));window.shadowDraws=0;await new Promise(r=>setTimeout(r,1500));return {label:${JSON.stringify(label)},enabled:${enabled},appliedMs,immediate,before,after:{programs:s.gl.info.programs.map(p=>p.id),warmups:s.scene.userData.shaderWarmupProfile.length,generation:s.scene.userData.indirectLighting.generation},mapsRetained:shadowLights.every((l,i)=>!!l.shadow.map&&l.shadow.map===maps[i]),pending:s.scene.userData.shaderWarmupPending,draws:shadowDraws,localPreference:shadowInput('Light shadows').checked}})()`)
    results.push(r);console.log(JSON.stringify(r))
    assert.ok(r.appliedMs<100,'toggle applies promptly')
    assert.equal(r.pending,false)
    assert.deepEqual(r.after,r.before,'display switches preserve programs, warmup and GI generation')
    assert.ok(r.mapsRetained)
    if(label==='Shadows'&&!enabled){assert.ok(r.immediate.every(l=>l.intensity===0));assert.equal(r.draws,0)}
    if(label==='Light shadows'&&enabled)await capture('light-shadows-on')
  }
  writeFileSync(`${out}/result.json`,JSON.stringify(results,null,2))
  assert.deepEqual(unexpected(),[])
  console.log('PASS master and local shadow toggles')
}finally{b.close()}
