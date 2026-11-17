import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out='tmp/light-switch-regression';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={};const save=()=>writeFileSync(out+'/report.json',JSON.stringify({...report,errors:b.errors},null,2))
async function wait(s){report.wait=s;save();await b.wait(s,600000)}
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/tmp/springfield-motion/springfield_14.json')).text()],'springfield_14.json')}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const u=perfScene()?.scene.userData;return u?.indirectLighting?.probes>300&&u.indirectLighting.state==='ready'&&!u.shaderWarmupPending&&!u.indirectLighting.volumePending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`import('/tests/browser/rendererTestModules.ts').then(m=>window.lightFiber=m.getEditorFiber)`)
 await b.evaluate(`(()=>{const root=document.getElementById('root');window.propsFor=name=>{const fiber=root[Object.keys(root).find(k=>k.startsWith('__reactContainer$'))].stateNode.current;let found;const walk=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(fiber);if(!found)walk(lightFiber());return found};window.lampId='d3a6009d-8599-4dec-bd62-d5862ec511b7';window.otherId='1206fd33-6da3-4c05-ad26-700029d4ccda';window.lampState=()=>{const s=perfScene(),u=s.scene.userData;return{at:performance.now(),power:s.scene.getObjectByName('local-light:'+lampId)?.power,otherPower:s.scene.getObjectByName('local-light:'+otherId)?.power,enabled:document.querySelector('[aria-label="Light enabled"]')?.checked,model:propsFor('FloorplanCanvas').floors.flatMap(f=>f.models).find(m=>m.id===lampId)?.lightEnabled,gi:u.indirectLighting?.state,generation:u.indirectLighting?.generation}};const s=perfScene();s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate();propsFor('FloorplanCanvas').onSelectModel(lampId)})()`)
 await wait(`!!document.querySelector('[aria-label="Light enabled"]')`)
 report.baseline=await b.evaluate('lampState()');assert.equal(report.baseline.power,24);assert.equal(report.baseline.enabled,true);save()
 for(const [enabled,duration] of [[false,800],[true,800],[false,16000],[true,16000]]){
  const result=await b.evaluate(`(async()=>{const start=performance.now(),samples=[];document.querySelector('[aria-label="Light enabled"]').click();const immediate=lampState();await new Promise(resolve=>{const frame=()=>{samples.push(lampState());if(performance.now()-start<${duration})requestAnimationFrame(frame);else resolve()};requestAnimationFrame(frame)});return{enabled:${enabled},immediate,samples}})()`)
  ;(report.switches??=[]).push(result);save()
  assert.equal(result.immediate.enabled,enabled,'Checkbox must acknowledge the click immediately')
  assert.equal(result.immediate.power,enabled?24:0,'Direct light must respond in the click handler')
  assert.ok(result.samples.length>0)
  for(const sample of result.samples){assert.equal(sample.power,enabled?24:0,'Deferred scene must not revert the light');assert.equal(sample.otherPower,report.baseline.otherPower,'Neighbouring lamp must not change');assert.equal(sample.enabled,enabled)}
 }
 await wait(`lampState().model===true`)
 report.final=await b.evaluate('lampState()')
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(errors,[])
 report.stage='passed';save();console.log(JSON.stringify({stage:report.stage,frames:report.switches.map(s=>s.samples.length),baseline:report.baseline,final:report.final}))
}catch(error){report.error=String(error);save();throw error}finally{b.close()}
