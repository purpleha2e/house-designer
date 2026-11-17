import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {projectFileInputFixtureSource} from '../tests/browser/projectFileInputFixture.mjs'
const out='tmp/light-switch-trace';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={};const save=()=>writeFileSync(out+'/report.json',JSON.stringify({...report,errors:b.errors},null,2))
async function wait(s){report.wait=s;save();await b.wait(s,600000)}
const shot=async n=>writeFileSync(out+'/'+n+'.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/tmp/springfield-motion/springfield_14.json')).text()],'springfield_14.json')}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const u=perfScene()?.scene.userData;return u?.indirectLighting?.probes>300&&u.indirectLighting.state==='ready'&&!u.shaderWarmupPending&&!u.indirectLighting.volumePending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`import('/tests/browser/rendererTestModules.ts').then(m=>window.lightFiber=m.getEditorFiber)`)
 await b.evaluate(`(()=>{const root=document.getElementById('root');window.propsFor=name=>{const fiber=root[Object.keys(root).find(k=>k.startsWith('__reactContainer$'))].stateNode.current;let found;const walk=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(fiber);if(!found)walk(lightFiber());return found};window.lampId='d3a6009d-8599-4dec-bd62-d5862ec511b7';window.lampState=()=>{const s=perfScene(),u=s.scene.userData,l=s.scene.getObjectByName('local-light:'+lampId);return {at:performance.now(),model:propsFor('FloorplanCanvas').floors.flatMap(f=>f.models).find(m=>m.id===lampId),power:l?.power,liveRevision:u.liveLightRevision,gi:u.indirectLighting,atlas:u.localShadowAtlas,preparation:u.viewportPreparation,warmup:u.shaderWarmupPending}};const s=perfScene();s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
 await b.evaluate(`window.lightWrites=[];perfScene().scene.traverse(o=>{if(!o.isPointLight)return;let value=o.intensity;Object.defineProperty(o,'intensity',{get:()=>value,set:v=>{if(o.name==='local-light:'+lampId&&v!==value)lightWrites.push({at:performance.now(),from:value,to:v,stack:new Error().stack});value=v},configurable:true})})`)
 report.baseline=await b.evaluate('lampState()');await shot('before');save()
 for(const enabled of [false,true,false]){
  const item={enabled,samples:[]};(report.switches??=[]).push(item)
  item.immediate=await b.evaluate(`(()=>{const at=performance.now();propsFor('FloorplanCanvas').onUpdateModel(lampId,{lightEnabled:${enabled}});return {at,...lampState()}})()`);save()
  for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,1000));item.samples.push(await b.evaluate('lampState()'));save()}
  await shot('switch-'+report.switches.length)
 }
 report.writes=await b.evaluate('lightWrites');report.pool=await b.evaluate(`propsFor('FixedLocalLightPool').visibleRenderedFloors.flatMap(f=>f.floor.models).find(m=>m.id===lampId)`);report.stage='done';save()
}catch(e){report.error=String(e);save();throw e}finally{b.close()}

