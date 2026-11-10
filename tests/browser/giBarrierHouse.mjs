import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
import {auditCameras} from './lightingCorrectnessDriver.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,out='docs/gi-barrier-filtering/house';mkdirSync(out,{recursive:true})
try{
 await b.call('Log.enable')
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 const cache=readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json','utf8')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 await b.evaluate(`(async()=>{const s=roofWallScene(),style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate();const v=await import('/tests/browser/giSpatialHouse.ts');window.barrierView=v.spatialHouseView(s);const m=await import('/tests/browser/giBarrierComparison.ts');window.barrierClient=m.barrierWorker(s);window.barrierStarted=performance.now();window.barrierBuildPromise=barrierClient.request(undefined,true).then(result=>{window.barrierBuild=result;window.barrierWallMs=performance.now()-barrierStarted;window.barrierControl=m.installBarrierComparison(s,result);return result.statistics})})()`)
 console.log('BUILD metadata and existing 301-probe baseline visibility warm-up')
 const build=await b.evaluate('barrierBuildPromise');writeFileSync(`${out}/preprocessing.json`,JSON.stringify({...build,wallMs:await b.evaluate('barrierWallMs')},null,2));console.log('PREPROCESSING',JSON.stringify(build))
 const status=await b.evaluate('barrierView.status()');assert.equal(status.positions.length,301);assert.equal(status.spatialInterpolation,'legacy');writeFileSync(`${out}/settings.json`,JSON.stringify(status,null,2))
 console.log('WARM corrected offscreen shader variants')
 await b.evaluate(`(async()=>{const s=roofWallScene(),t=await import('/tests/browser/giBarrierWarm.ts');for(const mode of ['A','B','legacy']){barrierControl.setMode(mode);await t.warmBarrierShaders(s)}})()`)
 for(const camera of auditCameras){
  const dir=`${out}/${camera.id}`;mkdirSync(dir,{recursive:true});await b.evaluate(`barrierView.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},${camera.fov})`)
  for(const mode of ['legacy','A','B']){
   await b.evaluate(`barrierControl.setMode('${mode}')`);const frame=await b.evaluate('barrierView.capture(false)'),rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')
   const error=await b.evaluate('roofWallScene().gl.getContext().getError()');if(error){writeFileSync(`${out}/invalid-gl-log.json`,JSON.stringify(b.logs,null,2));throw Error(`GL error ${error} in ${camera.id}/${mode}`)}
   writeFileSync(`${dir}/${mode}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')));const png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${dir}/${mode}.png`,Buffer.from(png.data,'base64'))
   console.log('CAPTURE',camera.id,mode)
  }
 }
 const points=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json','utf8')).results.map(p=>({name:p.name,camera:p.camera,position:p.position,normal:p.normal,geometricNormal:p.geometricNormal}))
 const receivers=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giBarrierReceivers.ts');return m.barrierReceivers(roofWallScene(),barrierBuild,${JSON.stringify(points)})})()`);writeFileSync(`${out}/receivers.json`,JSON.stringify(receivers,null,2))
 await b.evaluate(`barrierView.setCamera(${JSON.stringify(auditCameras[0].position)},${JSON.stringify(auditCameras[0].lookAt)},60);barrierControl.setMode('legacy')`)
 console.log('BENCHMARK bracketed normal production renderer')
 const restored=await b.evaluate('barrierView.performance()');writeFileSync(`${out}/restored-performance.json`,JSON.stringify(restored,null,2))
 const performance=await b.evaluate(`(async()=>{const s=roofWallScene(),m=await import('/tests/browser/kitchenFrameMeasurements.ts'),f=await import('/tests/browser/rendererTestModules.ts');let composer;const visit=x=>{if(!x)return;const v=x.ref?.current;if(v?.passes)composer=v;visit(x.child);visit(x.sibling)};visit(f.getEditorFiber());return m.measureKitchenFrames(s,composer,{cases:[['A exact triangle filter',()=>barrierControl.setMode('A')],['B certified connectivity',()=>barrierControl.setMode('B')]],restore:()=>barrierControl.setMode('legacy')})})()`)
 writeFileSync(`${out}/performance.json`,JSON.stringify(performance,null,2));assert.equal(performance.generationUnchanged,true)
 for(const record of Object.values(performance.cases))for(const phase of ['before','changed','after'])assert.equal(record[phase].glError,0,`${phase} GL error`)
 await b.evaluate('barrierControl.dispose();barrierClient.dispose();barrierView.dispose()');assert.deepEqual(b.errors,[]);console.log('PASS Colin fixed-field visual, receiver and normal-renderer comparison')
}finally{b.close()}
