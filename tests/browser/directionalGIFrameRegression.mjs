import assert from 'node:assert/strict'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),out=process.argv[3]??'docs/gi-directional-diagnostics/production-frames'
mkdirSync(out,{recursive:true})
try{
 await browser.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
 for(const order of process.argv.includes('--l1-only')?[1]:[1,2]){
  const cache=readFileSync(order===1?'tmp/gi-directional-l1-cache.json':'tmp/gi-directional-l2-matched-cache.json','utf8')
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&stairwell-diagnostics&lightingProfile&giSH=${order}&saved-gi&preview-lighting`})
  await browser.wait('!!window.roofWallScene?.()',120000)
  await browser.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1200px!important;min-width:0!important;height:850px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:850px!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`)
  await browser.wait(`!!window.roofWallScene?.()&&roofWallScene().scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting.state==='ready'`,600000)
  const metadata=await browser.evaluate(`(()=>{const s=roofWallScene(),f=s.scene.userData.getLightingField();return {shOrder:f.shOrder,probes:f.probes.length,reflections:s.scene.userData.indirectLighting.reflections,diagnostics:false,storage:{coefficients:f.coefficients.reduce((n,a)=>n+a.byteLength,0),volume:f.volume.data.byteLength,floor:f.floorLayer.data.byteLength,positions:f.positionData.byteLength}}})()`)
  assert.equal(metadata.shOrder,order);assert.equal(metadata.probes,244);assert.equal(metadata.reflections,13)
  await browser.evaluate(`roofWallScene().setFrameloop('never')`)
  const waitFor=process.argv.find(a=>a.startsWith('--wait-for='))?.slice(11)
  if(waitFor&&!existsSync(waitFor))console.log('WAITING for other diagnostic work to finish before frame timing')
  while(waitFor&&!existsSync(waitFor))await new Promise(r=>setTimeout(r,500))
  await browser.evaluate(`(async()=>{const m=await import('/tests/browser/rendererTestModules.ts');const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)window.directionalComposer=v;visit(f.child);visit(f.sibling)};visit(m.getEditorFiber())})()`)
  for(const view of ['stairwell','kitchen']){
   const camera=await browser.evaluate(`(()=>{const s=roofWallScene();${view==='stairwell'?'s.camera.position.set(4.00001,4.25,15.8);s.camera.lookAt(6.22001,3.25,15.31785);s.camera.fov=55':'s.camera.position.set(4.65001,1.6,9.95);s.camera.lookAt(2.1,1.25,4.95);s.camera.fov=45'};s.camera.updateProjectionMatrix();s.invalidate();return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:s.camera.fov}})()`)
   await browser.evaluate(`(async()=>{const s=roofWallScene();s.setFrameloop('always');s.invalidate();await new Promise(r=>setTimeout(r,300));s.setFrameloop('never')})()`)
   const frames=await browser.evaluate(`(async()=>{const m=await import('/tests/browser/kitchenFrameMeasurements.ts');return m.measureKitchenFrames(roofWallScene(),directionalComposer,{cases:[['unchanged production renderer',()=>{}]],restore:()=>{}})})()`)
   const result={...metadata,camera,...frames};writeFileSync(`${out}/l${order}-${view}.json`,JSON.stringify(result,null,2))
   await browser.evaluate(`(()=>{const s=roofWallScene();s.camera.updateMatrixWorld(true);directionalComposer.render(0)})()`)
   const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/l${order}-${view}.png`,Buffer.from(png.data,'base64'))
   assert.equal(result.generationUnchanged,true);console.log('FRAMES',order,view,JSON.stringify(frames.cases))
  }
  if(process.argv.includes('--edit')){
   await browser.evaluate(`roofWallScene().setFrameloop('always');regressionSetLightingMode('automatic')`);await new Promise(r=>setTimeout(r,500))
   for(const repeat of [0,1]){
    await browser.evaluate(`(()=>{delete window.giEditResult;delete window.giEditError;void (async()=>{const m=await import('/tests/browser/kitchenWindowEdit.ts');return m.measureKitchenWindowEdit(roofWallScene(),()=>regressionMoveWindow(.25))})().then(r=>window.giEditResult=r).catch(e=>window.giEditError=String(e))})()`)
    let result,last=0,started=Date.now()
    while(Date.now()-started<900000){
     await new Promise(r=>setTimeout(r,500));const p=await browser.evaluate('({result:window.giEditResult,error:window.giEditError,status:roofWallScene().scene.userData.indirectLighting})')
     if(p.error)throw Error(p.error);if(p.result){result=p.result;break}
     if(Date.now()-last>15000){console.log('EDIT PROGRESS',order,repeat,JSON.stringify({state:p.status.state,completed:p.status.completed,total:p.status.total,stage:p.status.prepareStage,warming:p.status.warming}));last=Date.now()}
    }
    assert.ok(result,'background edit must complete');writeFileSync(`${out}/l${order}-edit-${repeat}.json`,JSON.stringify(result,null,2));console.log('EDIT DONE',order,repeat,JSON.stringify({geometry:result.geometryVisibleMs,firstLighting:result.firstPublishedMs,total:result.totalMs}))
   }
  }
 }
 assert.deepEqual(browser.errors,[]);console.log('PASS production renderer, diagnostics disabled, identical 244 probes and 13 reflection maps')
}finally{browser.close()}
