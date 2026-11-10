import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/soft-gi',results={}
try{
 const cache=JSON.parse(fs.readFileSync('docs/door-confidence/original-field.json','utf8'))
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-gi'})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 console.log('scene ready')
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
 await b.wait(`!!document.querySelector('[aria-label="Soft floor GI radius"]')`)
 results.default=await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Soft floor GI radius"]');window.softSource=roofWallScene().scene.userData.getLightingField().floorLayer.data.slice();window.softGeneration=roofWallScene().scene.userData.indirectLighting.generation;return{value:e.value,options:Array.from(e.options,o=>o.text)}})()`)
 assert.equal(results.default.value,'0');assert.deepEqual(results.default.options,['Off','5 cm','10 cm','20 cm'])
 const set=async cm=>b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Soft floor GI radius"]');e.value='${cm}';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
 await set(20);await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='preparing'`)
 await set(0);await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='off'`);results.cancelDuringPreparation=true
 await b.evaluate('window.softRequestedAt=performance.now();true')
 await set(10);console.log('preparing 10 cm')
 await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='ready'`,240000)
 results.first=await b.evaluate(`roofWallScene().scene.userData.softFloorGI`);console.log('10 cm ready',results.first.statistics.wallMs)
 results.integrity=await b.evaluate(`(async()=>{
 const s=roofWallScene(),f=s.scene.userData.getLightingField(),u=s.scene.userData.getIndirectUniforms(),original=u.hdGIFloorLayer.value;
 const restore=s.scene.userData.bindSoftFloorGI(),filtered=u.hdGIFloorLayer.value,changed=filtered.image.data.reduce((n,v,i)=>n+(v!==softSource[i]),0);restore?.();
 const response=await fetch('/docs/soft-gi/original/10cm.rgba16f.gz'),buffer=response.headers.get('content-encoding')==='gzip'?await response.arrayBuffer():await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),expected=new Uint16Array(buffer);
 const mismatch=filtered.image.data.reduce((n,v,i)=>n+(v!==expected[i]),0);
 const before=s.scene.onBeforeRender;s.scene.onBeforeRender=function(...args){window.softDrawSeen=u.hdGIFloorLayer.value===filtered;return before.apply(this,args)};s.scene.userData.displayEffectRevision++;s.invalidate();
 return{changed,mismatch,restored:u.hdGIFloorLayer.value===original,sourceUnchanged:f.floorLayer.data.every((v,i)=>v===softSource[i]),generationUnchanged:s.scene.userData.indirectLighting.generation===softGeneration}
 })()`)
 assert(results.integrity.changed>0);assert.equal(results.integrity.mismatch,0);assert(results.integrity.restored&&results.integrity.sourceUnchanged&&results.integrity.generationUnchanged)
 await b.wait('window.softDrawSeen===true');results.actualDisplayBound=true
 results.visibleMs=await b.evaluate(`new Promise(resolve=>{const gl=roofWallScene().gl.getContext(),f=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();const poll=()=>{const r=gl.clientWaitSync(f,0,0);if(r===gl.TIMEOUT_EXPIRED)setTimeout(poll,4);else{gl.deleteSync(f);resolve(performance.now()-softRequestedAt)}};poll()})`)
 const screenshot=await b.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${out}/app-dropdown.png`,Buffer.from(screenshot.data,'base64'))
 await set(20);await b.wait(`roofWallScene().scene.userData.softFloorGI?.cm===20`)
 await set(5);await b.wait(`roofWallScene().scene.userData.softFloorGI?.cm===5`)
 await set(10)
 await b.wait(`(()=>{const f=roofWallScene().scene.userData.softFloorGI;return f?.state==='ready'&&f.cm===10})()`)
 results.latest=await b.evaluate('roofWallScene().scene.userData.softFloorGI')
 assert.equal(results.latest.statistics.reusedPlan,true)
 await set(0)
 await b.wait(`roofWallScene().scene.userData.softFloorGI?.state==='off'`)
 results.off=await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms();return{noBinding:s.scene.userData.bindSoftFloorGI()===undefined,originalTexture:u.hdGIFloorLayer.value===s.scene.userData.getLightingField().floorLayer.texture,sourceUnchanged:s.scene.userData.getLightingField().floorLayer.data.every((v,i)=>v===softSource[i])}})()`)
 assert(results.off.noBinding&&results.off.originalTexture&&results.off.sourceUnchanged)
 // Reloading the app must never restore an experimental setting.
 await b.call('Page.reload',{})
 // Runtime.evaluate may race destruction of the old page's execution context.
 // Retry only protocol navigation errors, never app exceptions or assertions.
 for(let attempt=0;;attempt++){
  try{await b.wait(`window.softGeneration===undefined&&document.readyState==='complete'&&!!document.querySelector('[aria-label="3D view menu"]')`);break}
  catch(error){if(attempt>=5||!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(String(error)))throw error;await new Promise(resolve=>setTimeout(resolve,100))}
 }
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click();true`)
 await b.wait(`!!document.querySelector('[aria-label="Soft floor GI radius"]')`)
 results.reloadDefault=await b.evaluate(`document.querySelector('[aria-label="Soft floor GI radius"]').value`);assert.equal(results.reloadDefault,'0')
 results.errors=b.errors;assert.deepEqual(b.errors,[])
 fs.writeFileSync(`${out}/app-dropdown.json`,JSON.stringify(results,null,2));console.log('PASS dropdown, exact filtering, display binding, source preservation, rapid changes, Off and reload')
}catch(error){fs.writeFileSync(`${out}/app-dropdown-failure.json`,JSON.stringify({error:String(error),results,errors:b.errors},null,2));throw error}finally{b.close()}
