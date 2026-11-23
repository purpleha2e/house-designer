import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {roomViews} from './lumenRoomViews.mjs'
import {runLumenPipelineAudit} from './lumenPipelineAudit.mjs'
import {runLumenMatchedViews} from './lumenMatchedViews.mjs'
import {runLumenWorldAudit} from './lumenWorldAudit.mjs'
import {runLumenVisibilityAudit} from './lumenVisibilityAudit.mjs'
import {runLumenBounceAudit} from './lumenBounceAudit.mjs'
import {checkFloorReferenceConvergence,runLumenDetailReference,runLumenResolutionAudit,runLumenResolutionMatrix,runLumenSamplingAudit,runLumenShadowAudit,runLumenSeamAudit} from './lumenResolutionAudit.mjs'
const mode=process.argv[2]??'after', landing=process.argv.includes('--landing')
const energy=mode.startsWith('energy-')
const phase3=mode==='phase3-after'
const pipeline=mode.startsWith('pipeline-')
const detail=mode.startsWith('detail-')
const world=mode.startsWith('world-')
const visibility=mode==='visibility'
const bounce=mode.startsWith('bounce-')
const revised=mode==='after'||mode==='energy-after'||phase3||pipeline||detail||world||visibility||bounce
const houseViews=landing&&process.argv.includes('--house-views')
const pipelineView=process.argv.find(arg=>arg.startsWith('--view='))?.split('=')[1]
if(pipelineView && !/^[a-z][a-z-]*$/.test(pipelineView))throw Error('Invalid reference view name')
const origin=process.env.LUMEN_ORIGIN??'http://127.0.0.1:5188',folder=new URL('../../docs/lumen-gi/room-review/',import.meta.url)
await mkdir(folder,{recursive:true})
const names=houseViews?['stairwell','sunlitFloor']:landing?['landing']:energy||pipeline?['room']:['room','window','doors','doorway']
const report={mode,stage:[],views:{}}, browser=await lightingBrowser(
  visibility||bounce||['energy-reference','detail-reference-convergence','world-image-reference'].includes(mode)?{requestTimeout:360000}:{})
const save=()=>writeFile(new URL(mode+(houseViews?'-house-views':landing?'-landing':pipelineView?'-'+pipelineView:'')+'.json',folder),JSON.stringify(report,null,2))
const evaluate=async(fn,...args)=>browser.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
async function select(label,value){
  await evaluate(label=>{if(!document.querySelector('[aria-label="'+label+'"]'))document.querySelector('[aria-label="3D view menu"]').click()},label)
  await browser.wait('!!document.querySelector(\'[aria-label="'+label+'"]\')')
  await evaluate((label,value)=>{const e=document.querySelector('[aria-label="'+label+'"]');e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="3D view menu"]').click()},label,value)
}
async function setCamera(pose){
  await evaluate(async p=>{const s=roofWallScene();s.camera.position.fromArray(p.position);s.camera.quaternion.fromArray(p.quaternion);s.camera.fov=p.fov;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);
    for(let i=0;i<5;i++){s.scene.userData.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}},pose)
}
async function capture(name){
 const meta=await evaluate(async()=>{const s=roofWallScene(),u=s.scene.userData;for(let i=0;i<3 || (i<90 && u.lumenGI?.refining);i++){u.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}
 const r=s.gl.domElement.getBoundingClientRect(),{readDiffuseSceneLighting}=await import('/src/diffuseSceneSnapshot.ts');
 return {camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),lights:readDiffuseSceneLighting(s.scene,1),exposure:s.gl.toneMappingExposure,fill:u.getIndirectUniforms().hdGIIndoorFill.value,tone:'ACESFilmic',width:s.gl.domElement.width,height:s.gl.domElement.height,clip:{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}}})
 await browser.evaluate("document.documentElement.classList.add('room-capture')")
 try{const r=await browser.call('Page.captureScreenshot',{format:'png',clip:meta.clip});await writeFile(new URL(name+'.png',folder),Buffer.from(r.data,'base64'))}
 finally{await browser.evaluate("document.documentElement.classList.remove('room-capture')")}
 report.views[name]=meta;await save()
}
const ready="roofWallScene().scene.userData.lumenGI?.state==='ready'&&roofWallScene().scene.userData.lumenGI?.daylightReady"
try{
 const reviewLink=mode==='link' || revised || energy || mode==='phase3-reference'
 await browser.call('Emulation.setDeviceMetricsOverride',{width:landing?1280:1586,height:landing?900:934,deviceScaleFactor:1,mobile:false})
 await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:'('+installNativeAudit.toString()+')()'})
 const cameraOptions=reviewLink?'&review-view='+names[0]+(mode==='phase3-reference'?'':'&giBackend=lumen'):''
 await browser.call('Page.navigate',{url:origin+'/tests/browser/roofWallRegression.html?'+(landing?'springfield-14':'lighting-room')+'&materials&lightingModel=existing&lightingView=custom&daylight-only&preview-lighting&giShaderAudit'+cameraOptions})
 await browser.wait('!!window.roofWallScene?.()?.camera',180000)
 if(!reviewLink)await setCamera(roomViews[names[0]])
 await browser.evaluate("(()=>{let s=document.createElement('style');s.textContent='.room-capture body *{visibility:hidden!important}.room-capture body canvas{visibility:visible!important}';document.head.append(s)})()")
 await browser.wait("roofWallScene().scene.userData.progressiveStartup?.phase==='full'",360000)
 console.log(mode,'viewport ready')
 if(reviewLink){
  if(['detail-shadow','detail-seam'].includes(mode))await setCamera(roomViews[names[0]])
  else if(mode!=='phase3-reference')await browser.wait(ready,240000)
  report.camera=await browser.evaluate('({p:roofWallScene().camera.position.toArray(),f:roofWallScene().camera.fov})')
  assert.deepEqual(report.camera.p,roomViews[names[0]].position);assert.equal(report.camera.f,roomViews[names[0]].fov)
 }
 if(mode==='link'){
  if(process.argv.includes('--check-receivers')){
    const saved=JSON.parse(await readFile(new URL('after'+(landing?'-landing':'')+'.json',folder),'utf8'))
    report.pixelReference=await evaluate(async pixels=>{const {checkLumenPixels}=await import('/tests/browser/lumenPixelReference.ts');return checkLumenPixels(roofWallScene(),pixels)},saved.pixels)
  }
  report.status=await browser.evaluate('roofWallScene().scene.userData.lumenGI');await save()
 }else if(bounce){
  await runLumenBounceAudit({browser,evaluate,capture,select,report,save,folder,mode})
 }else if(visibility){
  await runLumenVisibilityAudit({browser,evaluate,capture,report,save,folder})
 }else if(world){
  await runLumenWorldAudit({browser,evaluate,capture,select,report,save,folder,mode})
 }else if(mode==='detail-reference'){
  await runLumenDetailReference({browser,evaluate,report,save,folder})
 }else if(mode==='detail-reference-convergence'){
  await checkFloorReferenceConvergence({browser,evaluate,report,save,folder})
 }else if(mode==='detail-shadow'){
  await runLumenShadowAudit({browser,evaluate,capture,report,save})
 }else if(mode==='detail-sampling'){
  await runLumenSamplingAudit({browser,evaluate,capture,select,report,save,folder})
 }else if(mode==='detail-seam'){
  await runLumenSeamAudit({browser,evaluate,capture,report,save,folder})
 }else if(mode==='detail-matrix'){
  await evaluate(async()=>{
    const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(roofWallScene())
  })
  await browser.wait('roofWallScene().scene.userData.lumenGI.bounceReady&&!roofWallScene().scene.userData.lumenGI.refining',240000)
  await runLumenResolutionMatrix({browser,evaluate,capture,report,save,status:'roofWallScene().scene.userData.lumenGI',originScene:'roofWallScene',mode})
 }else if(detail){
  await runLumenResolutionAudit({browser,evaluate,capture,report,save,folder,mode})
 }else if(mode==='pipeline-views'){
  await runLumenMatchedViews({browser,evaluate,capture,select,report,save,folder,landing,pipelineView})
 }else if(pipeline){
  await runLumenPipelineAudit({browser,evaluate,capture,select,report,save,folder,mode,landing})
 }else if(mode==='energy-ground'){
  const uv=[.92,.75]
  await browser.wait('roofWallScene().scene.userData.lumenGI?.bounceReady',240000)
  await capture('room-energy-ground-with-glazing')
  report.withGlazing=await evaluate(uv=>roofWallScene().scene.userData.inspectLumenPixel(...uv),uv)
  report.glazingMaterials=await evaluate(async()=>{
    const {isLightingGlazing}=await import('/src/lightingVisibility.ts')
    const materials=new Set()
    roofWallScene().scene.traverse(object=>{
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(material?.visible && isLightingGlazing(material))materials.add(material)
      }
    })
    for(const material of materials)material.visible=false
    return [...materials].map(m=>({name:m.name,opacity:m.opacity,transmission:m.transmission,ior:m.ior}))
  })
  assert.ok(report.glazingMaterials.length>0)
  await capture('room-energy-ground-without-glazing')
  report.withoutGlazing=await evaluate(uv=>roofWallScene().scene.userData.inspectLumenPixel(...uv),uv)
  await save()
  assert.ok(report.withGlazing.composedSceneLinear[0]<report.withoutGlazing.composedSceneLinear[0],
    'The editor should blend ground lighting through the authored panes')
 }else if(mode==='reference'||mode==='energy-reference'||mode==='phase3-reference'){
  if(houseViews)await browser.wait('!roofWallScene().scene.userData.shaderWarmupPending',180000)
  if(energy){
    await browser.wait('roofWallScene().scene.userData.lumenGI?.bounceReady',240000)
    const floor=await evaluate(()=>roofWallScene().scene.userData.inspectLumenPixel(.53,.84))
    assert.ok(floor.receiverAlbedo[0]>2*floor.receiverAlbedo[2],'Authored timber has not reached the renderer')
    report.referenceFloorAlbedo=floor.receiverAlbedo
  }
  for(const name of names){
   await setCamera(roomViews[name])
   await evaluate(async({high,houseViews})=>{
     const {traceLandingReference}=await import('/tests/browser/springfieldReference.ts')
     const samples=houseViews?48:high?192:96, scale=houseViews ? .28 : high ? .40 : .36
     window.roomReference=null;window.roomReferenceError=null
     setTimeout(()=>traceLandingReference(roofWallScene(),samples,scale)
       .then(r=>window.roomReference=r).catch(e=>window.roomReferenceError=String(e)),0)
   },{high:energy,houseViews})
   await browser.wait("(()=>{if(window.roomReferenceError)throw Error(roomReferenceError);return !!window.roomReference})()",900000)
   const {image,stats}=await browser.evaluate('window.roomReference');report.views[name]=stats
   await writeFile(new URL(name+'-'+mode+'.png',folder),Buffer.from(image.split(',')[1],'base64'));await save();console.log(name,'reference complete')
  }
 }else if(mode==='production'){
  await browser.evaluate("regressionSetLightingMode('automatic')")
  await browser.wait("(()=>{const g=roofWallScene().scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending})()",600000)
  for(const name of names){await setCamera(roomViews[name]);await capture(name+'-production')}
 }else{
  await evaluate(async()=>{const s=roofWallScene();const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js');window.audit=await installRendererAudit(s);await audit.configure({giShader:false,probeGI:false});s.scene.userData.getIndirectUniforms().hdGIScreenDiffuse.value=1})
  if(mode==='before')for(const name of names){await setCamera(roomViews[name]);await capture(name+'-off')}
  await setCamera(roomViews[names[0]]);await select('GI backend','lumen');await browser.wait(ready,240000)
  if(mode==='energy-after'||phase3)await browser.wait('roofWallScene().scene.userData.lumenGI?.bounceReady',240000)
  for(const name of names){
    await setCamera(roomViews[name]);await browser.wait(ready,240000)
    if(phase3)await browser.wait('roofWallScene().scene.userData.lumenGI?.bounceReady',240000)
    await capture(name+'-'+mode)
    if(name===names[0]&&!houseViews){
      await evaluate(()=>document.querySelector('[aria-label="3D view menu"]').click())
      await browser.wait(`!!document.querySelector('[aria-label="Lumen GI view"]')`)
      const views=await evaluate(()=>{const a=Array.from(document.querySelector('[aria-label="Lumen GI view"]').options,o=>o.text);document.querySelector('[aria-label="3D view menu"]').click();return a})
      for(let i=1;i<views.length;i++){
        if((energy||phase3) && ![8,9,10,14].includes(i) && i<17)continue
        await select('Lumen GI view',i);await capture(name+'-'+mode+'-'+views[i].toLowerCase().replaceAll(' ','-'))
      }
      await select('Lumen GI view',0)
      if(views.includes('Bright contribution source')){
        await evaluate(async()=>{const s=roofWallScene();for(let i=0;i<20;i++){s.scene.userData.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}})
        const samples={ceiling:[.46,.085],wall:[.38,.53],floor:[.53,.84],sill:[260/1585,520/934],doorFrame:[.84,.32],corner:[.48,.663]}
        if(energy&&!landing)Object.assign(samples,{upperWindowWall:[.19,.10],ceilingNearDoors:[.83,.09],wallWindowSide:[.30,.33],wallDoorSide:[.62,.44],wallBelowWindow:[.22,.65],floorAtDoors:[.83,.86],floorAtCorner:[.55,.72]})
        report.receiverUV=samples
        report.pixels={}
        for(const [label,uv] of Object.entries(samples))report.pixels[label]=await evaluate(async uv=>roofWallScene().scene.userData.inspectLumenPixel(...uv),uv)
        await save()
        if(revised||energy){
          report.pixelReference=await evaluate(async pixels=>{const {checkLumenPixels}=await import('/tests/browser/lumenPixelReference.ts');return checkLumenPixels(roofWallScene(),pixels)},report.pixels)
          if(!landing){
            report.apertureControl=await evaluate(async()=>{const {checkLumenAperture}=await import('/tests/browser/lumenApertureVisibility.ts');return checkLumenAperture()})
            assert.ok(report.apertureControl[0][0]>.012 && report.apertureControl[0][0]<.05);assert.deepEqual(report.apertureControl[1],[0,0,0,0])
            if(mode==='energy-after'){
              const apertures=report.pixelReference.floor.apertures
              assert.ok(apertures.some(a=>Math.abs(a.width-1.2)<.01 && a.clear>0),'No open floor ray through the small window')
              assert.ok(apertures.some(a=>Math.abs(a.width-1.62)<.01 && a.clear>0),'No open floor ray through the glazed doors')
            }
          }
          await save()
        }
      }
    }
  }
  await setCamera(roomViews[names[0]]);await browser.wait(ready,240000)
  report.status=await browser.evaluate('roofWallScene().scene.userData.lumenGI')
  if(mode==='energy-after'&&!landing){
    const pose=roomViews.room
    await setCamera({...pose,position:[pose.position[0]+.18,pose.position[1],pose.position[2]]})
    await capture('room-energy-walk')
    await setCamera(pose);await capture('room-energy-return')
    const before=await browser.evaluate('({...roofWallScene().scene.userData.lumenGI})')
    await evaluate(()=>updateRegressionAssignments(rows=>rows.map(row=>{
      if(row.target.type==='room-floor')return {...row,materialId:'farrow-ball-hague-blue'}
      if(row.target.type==='wall-face'||row.target.type==='wall-surface-fragment')return {...row,materialId:'farrow-ball-hague-blue'}
      return row
    })))
    await browser.wait(`(()=>{const gi=roofWallScene().scene.userData.lumenGI;return gi?.bounceReady&&gi.relights>${before.relights}})()`,240000)
    await capture('room-energy-material-edit')
    report.materialEdit=await evaluate(async()=>{
      const u=roofWallScene().scene.userData
      return {wall:(await u.inspectLumenPixel(.38,.53)).receiverAlbedo,floor:(await u.inspectLumenPixel(.53,.84)).receiverAlbedo}
    })
    assert.notDeepEqual(report.materialEdit.wall,report.pixels.wall.receiverAlbedo)
    assert.notDeepEqual(report.materialEdit.floor,report.pixels.floor.receiverAlbedo)
  }
  if((revised||energy) && landing && !houseViews){
    const pose=roomViews.landing
    await setCamera({...pose,position:[pose.position[0]+.18,pose.position[1],pose.position[2]]})
    await capture(phase3?'landing-phase3-walk':energy?'landing-energy-walk':'landing-walk')
    await setCamera(pose);await capture(phase3?'landing-phase3-return':energy?'landing-energy-return':'landing-return')
    const measureSun=async strengthOnly=>{
      const s=roofWallScene(),g=s.scene.userData.lumenGI,at=performance.now(),builds=g.geometryBuilds,frame=g.sunFrames,draws=g.cacheProfile?.sunAtlasDraws??0
      updateRegressionSunPosition(p=>strengthOnly?({...p,strength:.65}):({...p,azimuth:p.azimuth+.12}))
      while(g.sunFrames===frame && performance.now()-at<5000)await new Promise(requestAnimationFrame)
      const submitted=g.lastSunFrameAt-at,gl=s.gl.getContext(),sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0)
      gl.flush()
      if(sync){try{while(gl.clientWaitSync(sync,0,0)===gl.TIMEOUT_EXPIRED && performance.now()-at<7000)await new Promise(requestAnimationFrame)}finally{gl.deleteSync(sync)}}
      return {updated:g.sunFrames>frame,submissionMs:submitted,gpuFenceObservedMs:performance.now()-at,cacheBuilds:g.geometryBuilds-builds,sunAtlasDraws:(g.cacheProfile?.sunAtlasDraws??0)-draws}
    }
    report.sun=await evaluate(measureSun,false)
    if(phase3)report.sunIntensity=await evaluate(measureSun,true)
    await save();assert.equal(report.sun.updated,true);assert.equal(report.sun.cacheBuilds,0)
  }
  report.shader=await browser.evaluate('roofWallScene().scene.userData.viewportShaderAudit')
  await save();assert.deepEqual(report.shader.events,[])
 }
 assert.deepEqual(browser.errors,[])
} catch(e){report.error=String(e);report.browserErrors=browser.errors;await save();throw e}finally{browser.close()}
