import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
const browser=await lightingBrowser()
try {
 await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5191}/tests/browser/sunCascadesRegression.html`})
 await browser.wait('window.sunCascadesResult')
 const result=await browser.evaluate('window.sunCascadesResult')
 console.log(JSON.stringify(result,null,2));assert.deepEqual(browser.errors,[])
 assert.ok(result.changed>100,'finer shadows change visible edge pixels')
 assert.equal(result.idleChanged,0,'stationary maps are stable')
 assert.ok(result.litSamples>10000&&result.litError<1,'sunlight intensity is preserved')
 assert.ok(result.shadowSamples>100,'opaque blocker still casts a shadow')
 assert.ok(result.widths[0]<10&&result.widths[1]>result.widths[0],'near cascade tightly covers camera')
 assert.ok(result.movement>1,'cascades follow camera movement')
 assert.equal(result.coveredLit,0,'upstream roof outside camera view blocks sunlight')
 assert.ok(result.previewShadowPixels>100,'the prepared lit preview retains real sunlight shadows')
 assert.equal(result.captureChanged,0,'GI capture keeps its original whole-building sunlight map')
 const images=await browser.evaluate('window.sunCascadesImages');mkdirSync('tmp/sun-cascades',{recursive:true})
 for(const [name,data]of Object.entries(images))writeFileSync(`tmp/sun-cascades/${name}.png`,Buffer.from(data.split(',')[1],'base64'))
 await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5191}/tests/browser/springfieldWallRegression.html`})
 await browser.wait('!!window.springfieldWallScene?.()?.scene.children.find(o=>o.userData.houseDesignerRole==="sun-light")',60000)
 await browser.wait('window.springfieldWallScene().scene.userData.progressiveStartup?.lightingReadyMs && !document.querySelector(".viewport-preparing-overlay")',60000)
 console.log('First usable shadowed view',JSON.stringify(await browser.evaluate('window.springfieldWallScene().scene.userData.progressiveStartup')))
 await browser.evaluate(`(async()=>{
  const {markViewportInteraction}=await import('/src/viewportScheduling.ts');
  const s=springfieldWallScene(),original=s.gl.render,after=s.scene.onAfterRender;
  window.sunCascadeStartup={presented:false,finished:false,fallbackDraws:0};
  s.gl.render=function(scene,camera){const state=window.sunCascadeStartup;if(state.presented&&camera===s.camera&&scene!==s.scene&&!scene.userData.retainedViewport&&!s.gl.shadowMap.enabled)state.fallbackDraws++;return original.apply(this,arguments)};
  s.scene.onAfterRender=function(renderer,scene,camera){after.apply(this,arguments);const state=window.sunCascadeStartup;
   if(!state.presented&&camera===s.camera&&!s.scene.userData.shaderWarmupPending&&s.gl.getRenderTarget()?.width>16){
    state.presented=true;markViewportInteraction(performance.now()+600);s.scene.userData.shaderWarmupPending=true;
    setTimeout(()=>{s.scene.userData.shaderWarmupPending=false;state.finished=true;s.invalidate()},1000);
   }
  };return true;
 })()`)
 const integration=await browser.evaluate(`(async()=>{
  const s=window.springfieldWallScene();await s.gl.compileAsync(s.scene,s.camera);
  const original=s.gl.renderBufferDirect, cameras=new Map();
  s.gl.renderBufferDirect=function(camera,...args){if(camera.isOrthographicCamera)cameras.set(camera.uuid,{width:camera.right-camera.left,draws:(cameras.get(camera.uuid)?.draws??0)+1});return original.call(this,camera,...args)};
  try{s.camera.position.x+=.5;s.camera.updateMatrixWorld(true);s.gl.shadowMap.autoUpdate=true;s.gl.shadowMap.needsUpdate=true;s.gl.render(s.scene,s.camera)}finally{s.gl.renderBufferDirect=original}
  return {cameras:[...cameras.values()],error:s.gl.getContext().getError()};
 })()`)
 console.log('Application integration',JSON.stringify(integration));assert.equal(integration.error,0)
 assert.ok(integration.cameras.filter(c=>c.draws>0).length>=3,'real application renders three sun shadow cameras')
 await browser.wait('window.sunCascadeStartup.finished',60000)
 const startup=await browser.evaluate('window.sunCascadeStartup')
 console.log('Shadowed startup transition',JSON.stringify(startup))
 assert.equal(startup.fallbackDraws,0,'a completed shadowed view never drops back to the unshadowed startup scene')
 // Exercise the scheduled, postprocessed display instead of manually calling
 // gl.render: fullscreen effects disable capture uniforms between scene draws.
 await browser.wait('window.springfieldWallScene().scene.userData.progressiveStartup?.phase==="full"',60000)
 await browser.evaluate(`(()=>{
  const s=springfieldWallScene(),r=s.gl,g=r.getContext(),originalRender=r.render;
  let display=false;window.sunCascadeDisplaySamples=[];
  r.render=function(scene,camera){const previous=display;display=camera===s.camera&&r.shadowMap.enabled&&(scene===s.scene||scene.userData.retainedViewport===true);try{return originalRender.apply(this,arguments)}finally{display=previous}};
  for(const method of ['drawElements','drawElementsInstanced','drawArrays']){
   const original=g[method];g[method]=function(){
    if(display){const program=g.getParameter(g.CURRENT_PROGRAM),location=g.getUniformLocation(program,'hdSunCascadesEnabled');if(location)window.sunCascadeDisplaySamples.push(g.getUniform(program,location))}
    return original.apply(this,arguments)
   }
  }
  s.camera.position.x+=.05;s.invalidate();return true;
 })()`)
 await browser.wait('window.sunCascadeDisplaySamples.length>30',30000)
 const displaySamples=await browser.evaluate('window.sunCascadeDisplaySamples')
 console.log('Postprocessed display uniforms',JSON.stringify({draws:displaySamples.length,disabled:displaySamples.filter(x=>x!==1).length}))
 assert.ok(displaySamples.every(x=>x===1),'all postprocessed display draws restore the cascade uniforms')
 const retainedSamples=await browser.evaluate(`(async()=>{
  const {retainViewportScene}=await import('/src/retainedViewportScene.ts');
  const {Scene,OrthographicCamera}=await import('/node_modules/.vite/deps/three.js');
  const s=springfieldWallScene(),r=s.gl,retained=retainViewportScene(s.scene),auto=r.shadowMap.autoUpdate,needs=r.shadowMap.needsUpdate;
  try{
   await r.compileAsync(retained.scene,s.camera);
   s.camera.position.x+=.2;s.camera.updateMatrixWorld(true);
   r.shadowMap.autoUpdate=false;r.shadowMap.needsUpdate=true;
   window.sunCascadeDisplaySamples=[];r.render(retained.scene,s.camera);
   // A fullscreen pass disables the uniforms; a frozen transparency pass
   // must restore the retained display's cascades without regenerating maps.
   r.render(new Scene(),new OrthographicCamera());
   r.shadowMap.needsUpdate=false;r.render(retained.scene,s.camera);
   return window.sunCascadeDisplaySamples;
  }finally{r.shadowMap.autoUpdate=auto;r.shadowMap.needsUpdate=needs;retained.dispose()}
 })()`)
 console.log('Retained display uniforms',JSON.stringify({draws:retainedSamples.length,disabled:retainedSamples.filter(x=>x!==1).length}))
 assert.ok(retainedSamples.length>30&&retainedSamples.every(x=>x===1),'retained views and frozen shadow reuse keep cascades enabled')
 assert.deepEqual(browser.errors,[])
}finally{browser.close()}
