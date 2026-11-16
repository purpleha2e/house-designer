import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser=await lightingBrowser(), {call,evaluate,wait}=browser
const base=`http://127.0.0.1:${process.argv[2]??5187}/tests/browser/`
const report={};mkdirSync('tmp/local-shadow-atlas',{recursive:true})
try {
  await call('Page.navigate',{url:base+'localShadowAtlas.html'})
  await wait('!!window.atlasGPUResult')
  report.gpu=await evaluate('atlasGPUResult')
  console.log('GPU depth comparisons',report.gpu)
  assert.ok(report.gpu.blocked.every(v=>v<.1),'all six cube directions cast shadows')
  assert.ok(report.gpu.clear.every(v=>v>.9),'receivers before each occluder are lit')
  assert.ok(report.gpu.diagonal>.9)
  assert.ok(report.gpu.spotlight[0]<.1&&report.gpu.spotlight[1]>.9&&report.gpu.spotlight[2]>.9)
  assert.equal(report.gpu.error,0)
  await call('Page.navigate',{url:base+'roofWallRegression.html?lighting-startup&live-gi&many-lights'})
  console.log('Preparing 26-light house...')
  await wait(`!!window.roofWallScene?.()?.scene.userData.indirectLighting && roofWallScene().scene.userData.indirectLighting.state==='ready' && !roofWallScene().scene.userData.shaderWarmupPending && roofWallScene().scene.userData.progressiveStartup?.phase==='full'`,360000)
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await wait(`!!document.querySelector('[aria-label="Limit lights by camera"]')`)
  await evaluate(`(()=>{
    window.lampSnapshot=()=>{const lights=[];roofWallScene().scene.traverse(o=>{if(o.name.startsWith('local-light:')&&o.power>0)lights.push({id:o.name,power:o.power,cast:o.castShadow})});return lights;};
    window.moveToRoom=x=>{const s=roofWallScene();s.camera.position.set(x,1.6,2);s.camera.lookAt(x,1.6,0);s.controls?.target?.set(x,1.6,0);s.invalidate();};
    window.shadowToggle=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');
    if(!shadowToggle.checked)shadowToggle.click();moveToRoom(1.5);
  })()`)
  await wait('roofWallScene().scene.userData.localShadowAtlas?.ready===true',180000)
  report.before=await evaluate('({lights:lampSnapshot(),atlas:{...roofWallScene().scene.userData.localShadowAtlas}})')
  assert.equal(report.before.lights.length,26)
  assert.equal(report.before.atlas.lights,26)
  assert.equal(report.before.atlas.faces,126)
  assert.ok(report.before.lights.every(l=>!l.cast),'local shadows use the atlas, not individual native samplers')
  report.motion=await evaluate(`new Promise(resolve=>{
    const s=roofWallScene(),frames=[],programs=s.gl.info.programs.map(p=>p.id),generation=s.scene.userData.indirectLighting.generation;
    let draws=0;const render=s.gl.render.bind(s.gl);s.gl.render=(scene,camera)=>{if(s.gl.getRenderTarget()?.texture.name==='local-shadow-atlas')draws++;return render(scene,camera)};
    const start=performance.now();const sample=()=>{
      moveToRoom(Math.floor((performance.now()-start)/500)%2?1.5:6.5);
      frames.push({lights:lampSnapshot(),atlas:{...s.scene.userData.localShadowAtlas}});
      if(performance.now()-start<2500)requestAnimationFrame(sample);
      else resolve({frames,draws,programs,afterPrograms:s.gl.info.programs.map(p=>p.id),generation,afterGeneration:s.scene.userData.indirectLighting.generation});
    };requestAnimationFrame(sample);
  })`)
  for(const frame of report.motion.frames){
    assert.deepEqual(frame.lights,report.before.lights,'walking never reorders or dims any lamp')
    assert.equal(frame.atlas.texture,report.before.atlas.texture)
    assert.equal(frame.atlas.builds,report.before.atlas.builds)
  }
  assert.equal(report.motion.draws,0,'camera movement submits zero local shadow-map draws')
  assert.deepEqual(report.motion.afterPrograms,report.motion.programs)
  assert.equal(report.motion.afterGeneration,report.motion.generation)
  await evaluate('shadowToggle.click()')
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))')
  await evaluate('shadowToggle.click()')
  await evaluate('new Promise(resolve=>setTimeout(resolve,300))')
  assert.equal(await evaluate('roofWallScene().scene.userData.localShadowAtlas.texture'),report.before.atlas.texture,'toggle reuses cached depth')
  console.log('Checking rebuild after moving a light...')
  await evaluate(`updateRegressionFloors(floors=>floors.map((floor,index)=>index?floor:{...floor,models:floor.models.map((model,i)=>i?model:{...model,position:{...model.position,x:model.position.x+.3}})}))`)
  await wait(`roofWallScene().scene.userData.localShadowAtlas?.ready===true && roofWallScene().scene.userData.localShadowAtlas.texture!==${JSON.stringify(report.before.atlas.texture)} && !roofWallScene().scene.userData.shaderWarmupPending`,240000)
  report.afterEdit=await evaluate('({...roofWallScene().scene.userData.localShadowAtlas})')
  assert.equal(report.afterEdit.faces,126)
  assert.equal(report.afterEdit.completed,126)
  assert.ok(report.afterEdit.builds>report.before.atlas.builds)
  assert.equal(await evaluate('roofWallScene().gl.getContext().getError()'),0)
  assert.deepEqual(browser.errors,[])
  console.log('PASS persistent shadows for all 26 lamps; zero shadow redraws during navigation')
}catch(error){report.error=String(error);report.browserErrors=browser.errors;throw error}
finally{writeFileSync('tmp/local-shadow-atlas/report.json',JSON.stringify(report,null,2));browser.close()}
