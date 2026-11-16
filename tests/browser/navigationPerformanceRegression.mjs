import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'
import { installRenderLoopPreload, installRenderLoopAudit } from './renderLoopAuditProbe.mjs'

// Uses the diagnostic cached-lighting fixture produced by the motion audit.
// Never rewrite the user's saved house or its lighting identity.
const fixture=resolve(process.argv[2] ?? 'tmp/springfield-motion/springfield_14.json')
const b=await lightingBrowser(), output='tmp/navigation-performance'
mkdirSync(output,{recursive:true})
try {
  await b.call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})();window.confirm=()=>false;`})
  await b.call('Page.navigate',{url:'http://localhost:4173/?giSH=2'})
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`,30000)
  await b.call('Page.setInterceptFileChooserDialog',{enabled:true})
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`)
  const {root}=await b.call('DOM.getDocument')
  const {nodeId}=await b.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
  await b.call('DOM.setFileInputFiles',{nodeId,files:[fixture]})
  await b.evaluate(`document.querySelector('.editor-grid').style.gridTemplateColumns='180px 8px minmax(0,1fr)'`)
  for(let i=0;i<180;i++){
    const ready=await b.evaluate(`(()=>{const u=loopFind().state?.scene.userData;return {phase:u?.progressiveStartup?.phase,warm:u?.shaderWarmupPending,gi:u?.indirectLighting?.state,scan:u?.indirectScanPending,source:u?.indirectLighting?.source}})()`)
    if(i%15===0)console.log('Preparing',JSON.stringify(ready))
    if(ready.phase==='full'&&!ready.warm&&!ready.scan&&ready.gi==='ready')break
    if(i===179)throw Error('Model not ready')
    await new Promise(r=>setTimeout(r,1000))
  }
  await b.evaluate(`(${installRenderLoopAudit.toString()})()`)
  const results=await b.evaluate(`(async()=>{
    const s=loopFind().state;
    const sub=s.internal.subscribers.find(v=>v.ref.current.toString().includes('navigationResolution'));
    if(!sub)throw Error('Navigation resolution controller missing');
    let controller=sub.ref.current,enabled=false;
    Object.defineProperty(sub.ref,'current',{get:()=> (...args)=>{if(enabled)controller(...args)},set:fn=>{controller=fn},configurable:true});
    const full=await renderLoopAudit.sample(6000,true,false);
    enabled=true;
    const warm=await renderLoopAudit.sample(8000,true,false);
    const movingScale=s.gl.getPixelRatio(),movingSize=[s.gl.domElement.width,s.gl.domElement.height];
    const movingBuffer=[loopFind().composer.inputBuffer.width,loopFind().composer.inputBuffer.height];
    const adaptive=await renderLoopAudit.sample(6000,true,false);
    await new Promise(r=>setTimeout(r,700));
    Object.defineProperty(sub.ref,'current',{value:controller,writable:true,configurable:true});
    return {full,warm,adaptive,movingScale,movingSize,movingBuffer,restingScale:s.gl.getPixelRatio(),restingSize:[s.gl.domElement.width,s.gl.domElement.height],restingBuffer:[loopFind().composer.inputBuffer.width,loopFind().composer.inputBuffer.height],status:s.scene.userData.navigationResolution};
  })()`)
  writeFileSync(output+'/report.json',JSON.stringify(results,null,2))
  assert.equal(results.restingScale,1,'Stopping restores the full-resolution drawing buffer')
  assert.deepEqual(results.movingBuffer,results.movingSize,'Effects render at the reduced pixel count too')
  assert.deepEqual(results.restingBuffer,results.restingSize,'Effects return to full resolution when stopped')
  if(results.full.fps<25)assert.ok(results.movingScale<1,'Slow camera movement reduces pixel work')
  assert.deepEqual(b.errors,[])
  const shot=await b.call('Page.captureScreenshot',{format:'png'})
  writeFileSync(output+'/restored.png',Buffer.from(shot.data,'base64'))
  console.log('Navigation performance',JSON.stringify({fullFPS:results.full.fps,movingFPS:results.adaptive.fps,movingScale:results.movingScale,restingScale:results.restingScale}))
}finally{b.close()}
