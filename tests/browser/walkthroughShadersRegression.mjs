import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out=process.argv[2]??'tmp/walkthrough-shaders';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={}
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression){const end=Date.now()+600000;while(!await b.evaluate(expression)){status.current=await b.evaluate('window.perfScene?.()?.scene.userData.viewportPreparation');save();if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,1000))}}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/tmp/springfield-motion/springfield_14.json')).text()],'springfield_14.json')}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 if(process.argv[3]==='realistic'){
  status.stage='enabling-realistic';save()
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await b.evaluate(`document.querySelector('.viewport-advanced-settings').open=true;document.querySelector('[aria-label="Use custom lighting"]').click()`)
  await wait(`document.querySelector('[aria-label="Lighting view"]').value==='custom'`)
  await b.evaluate(`(()=>{const input=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,0);input.dispatchEvent(new Event('input',{bubbles:true}));for(const name of ['Shadows','Light shadows']){const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===name),check=label?.querySelector('input');if(check&&!check.checked)check.click()}})()`)
  await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Lighting refinement"]');e.value='balanced';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await wait(`(()=>{const s=perfScene().scene;return !s.userData.shaderWarmupPending&&s.userData.localShadowAtlas?.ready})()`)
  assert.equal(await b.evaluate('!!perfScene().scene.userData.localSunPreview'),false,'Realistic settings must not start refinement automatically')
 }
 status.stage='walking';save()
 const result=await b.evaluate(`(async()=>{
  const s=perfScene(),r=s.gl,g=r.getContext(),draws=[],links=[],frames=[],programs=new Set(r.info.programs),start=performance.now();let phase='start',draw=null,previousFrame=0
  const originalDraw=r.renderBufferDirect,originalCompile=r.compileAsync,originalLink=g.linkProgram
  let compiling=false
  r.compileAsync=function(...a){const old=compiling;compiling=true;try{return originalCompile.apply(this,a)}finally{compiling=old}}
  r.renderBufferDirect=function(...args){const at=performance.now(),o=args[4],m=args[3],before=r.info.programs.length;let parent=o,model='';while(parent){if(parent.name?.startsWith('model-transform-'))model=parent.name;parent=parent.parent}
   const prior=draw;draw={name:o.name,role:o.userData.houseDesignerRole,model,type:o.type,material:m.type,materialName:m.name,side:m.side,transparent:m.transparent,depthPacking:m.depthPacking,maps:Object.keys(m).filter(k=>m[k]?.isTexture),camera:args[0].type};
   try{return originalDraw.apply(this,args)}finally{const ms=performance.now()-at;const added=r.info.programs.filter(p=>!programs.has(p));for(const p of added)programs.add(p);if(ms>100||added.length)draws.push({phase,ms,...draw,added:added.map(p=>({id:p.id,key:p.cacheKey,name:p.name}))});draw=prior}
  }
  g.linkProgram=function(program){links.push({phase,compiling,draw,at:performance.now()-start,stack:new Error().stack});return originalLink.call(this,program)}
  const route=[
   {name:'landing',p:[10.3,4.15,11.15],t:[10.3,4.05,5.9]},
   {name:'bedroom-left',p:[6.4,4.15,5.1],t:[9.9,4,3.9]},
   {name:'bedroom-window',p:[8,4.15,4.5],t:[7.8,4.1,1.7]},
   {name:'bathroom',p:[11,4.15,4.7],t:[13,3.8,3]},
   {name:'rear-room',p:[8,4.15,9],t:[6,4.1,11]},
   {name:'stairs',p:[10.3,3.3,8.5],t:[10.3,1.5,10.5]},
   {name:'kitchen',p:[12,1.6,6],t:[14,1.5,2.5]},
   {name:'lounge',p:[7,1.6,9],t:[6,1.5,3]},
   {name:'roof',p:[10,6.8,7],t:[10,6.5,3]},
   {name:'outside',p:[20,7,18],t:[10,3,7]},
   {name:'landing-return',p:[10.3,4.15,11.15],t:[10.3,4.05,5.9]}
  ]
  const baseline={programs:r.info.programs.length,gi:{generation:s.scene.userData.indirectLighting.generation,faces:s.scene.userData.indirectLighting.capturedFaces},warmups:s.scene.userData.shaderWarmupProfile?.length,refinement:!!s.scene.userData.localSunPreview}
  try{
   for(const view of route){phase=view.name;const from=s.camera.position.clone(),target=from.clone().set(...view.p),began=performance.now()
    await new Promise(resolve=>{const tick=()=>{const now=performance.now();if(previousFrame)frames.push({phase,ms:now-previousFrame});previousFrame=now;const progress=Math.min(1,(now-began)/2000);s.camera.position.lerpVectors(from,target,progress);s.camera.lookAt(...view.t);s.camera.updateMatrixWorld();s.invalidate();if(now-began<3500)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)})
   }
   return{baseline,draws,links,frames,final:{programs:r.info.programs.length,gi:{generation:s.scene.userData.indirectLighting.generation,faces:s.scene.userData.indirectLighting.capturedFaces},warmups:s.scene.userData.shaderWarmupProfile?.length,refinement:!!s.scene.userData.localSunPreview},warmupProfile:s.scene.userData.shaderWarmupProfile}
  }finally{r.renderBufferDirect=originalDraw;r.compileAsync=originalCompile;g.linkProgram=originalLink}
 })()`)
 writeFileSync(`${out}/walk.json`,JSON.stringify(result,null,2));status.stage='measured';save()
 console.log(JSON.stringify({before:result.baseline,after:result.final,links:result.links.map(l=>({phase:l.phase,compiling:l.compiling,draw:l.draw})),slowDraws:result.draws.map(d=>({phase:d.phase,ms:d.ms,role:d.role,type:d.type,material:d.material,added:d.added.map(p=>p.id)})),maxFrame:Math.max(...result.frames.map(f=>f.ms))}))
 if(process.env.ASSERT_NO_WALK_SHADERS==='1'){assert.equal(result.links.length,0,'Walking must not compile new shaders');assert.deepEqual(result.final.gi,result.baseline.gi)}
 if(process.argv[3]==='realistic'){
  assert.equal(result.final.refinement,false)
  status.stage='manual-cancellation';save()
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await b.evaluate(`document.querySelector('.viewport-advanced-settings').open=true`)
  await wait(`!!document.querySelector('[aria-label="Refine this view"]')`)
  await b.evaluate(`document.querySelector('[aria-label="Refine this view"]').click()`)
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await wait(`(()=>{const p=perfScene().scene.userData.localSunPreview;return p?.triangles||p?.message?.startsWith('Preparing surface lighting')})()`)
  await b.evaluate(`(()=>{const s=perfScene();s.camera.position.x+=.15;s.camera.updateMatrixWorld();s.invalidate()})()`)
  await wait(`perfScene().scene.userData.localSunPreview?.message?.startsWith('Stopped by movement')`)
  await new Promise(resolve=>setTimeout(resolve,3000))
  status.cancelled=await b.evaluate('perfScene().scene.userData.localSunPreview')
  assert.equal(status.cancelled.active,false);assert.equal(status.cancelled.busy,false)
  assert.ok(status.cancelled.message.startsWith('Stopped by movement'),'Stopping must not automatically restart after a pause')
  status.health=await b.evaluate('perfScene().scene.userData.getRendererHealth()')
 }
 const errors=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(errors,[])
 status.stage='passed';save()
}catch(error){status.error=String(error);save();throw error}finally{b.close()}
