import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { lightingBrowser } from './lightingHarness.mjs'
import { installNativeAudit } from './rendererAuditNative.js'

const output = new URL('../../docs/lumen-gi/',import.meta.url)
const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const production = process.argv.includes('--production')
const reference = process.argv.includes('--reference')
const apertureOnly = process.argv.includes('--aperture')
const motionOnly = process.argv.includes('--motion')
const profileOnly = process.argv.includes('--profile')
const report = { captures:{} }
const pose = JSON.parse(await readFile(new URL('baseline.json',output))).camera
const consoleStacks=[]
const browser = await lightingBrowser({onEvent:event=>{
  if(event.method==='Runtime.consoleAPICalled' && event.params.type==='error') consoleStacks.push(event.params.stackTrace?.callFrames)
}})
const save = () => writeFile(new URL(profileOnly?'profile.json':motionOnly?'motion.json':apertureOnly?'aperture.json':reference?'reference.json':production?'production.json':'lumen.json',output),JSON.stringify(report,null,2)+'\n')
const ready = "window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'"
async function capture(label,offset=0) {
  const metadata = await browser.evaluate(`(async () => {
    const s=roofWallScene(), u=s.scene.userData, p=${JSON.stringify(pose)}
    s.camera.position.fromArray(p.position); s.camera.quaternion.fromArray(p.quaternion); s.camera.fov=p.fov
    s.camera.position.x+=${offset};s.camera.rotateY(${offset}*.25)
    s.camera.updateProjectionMatrix(); s.camera.updateMatrixWorld(true)
    for(let i=0;i<4;i++){ u.displayEffectRevision=(u.displayEffectRevision??0)+1;s.invalidate();await new Promise(requestAnimationFrame) }
    const r=s.gl.domElement.getBoundingClientRect()
    const {readDiffuseSceneLighting}=await import('/src/diffuseSceneSnapshot.ts')
    return {sun:readDiffuseSceneLighting(s.scene,1), camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),
      exposure:s.gl.toneMappingExposure,toneMapping:'ACESFilmic composer',indoorFill:u.getIndirectUniforms().hdGIIndoorFill.value,
      diffuseComposited:u.getIndirectUniforms().hdGIScreenDiffuse.value,backend:u.lumenGI,production:u.indirectLighting?.state,
      clip:{x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y),scale:1}}
  })()`)
  await browser.evaluate(`(()=>{const style=document.createElement('style');style.id='capture-viewport';
    style.textContent='body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.append(style)})()`)
  let png
  try { png=await browser.call('Page.captureScreenshot',{format:'png',clip:metadata.clip}) }
  finally { await browser.evaluate("document.getElementById('capture-viewport')?.remove()") }
  const pixels=Buffer.from(png.data,'base64')
  if(!label)return {pixels,metadata}
  await writeFile(new URL(label+'.png',output),pixels)
  report.captures[label]=metadata
  await save()
}
async function select(label,value) {
  const selector='[aria-label="'+label+'"]'
  await browser.evaluate(`if(!document.querySelector(${JSON.stringify(selector)}))document.querySelector('[aria-label="3D view menu"]').click()`)
  await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`)
  await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};
    e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[aria-label="3D view menu"]').click() })()`)
}
async function checkAperture(){
  report.apertureControl=await browser.evaluate(`(async()=>{
    const {checkLumenAperture}=await import('/tests/browser/lumenApertureVisibility.ts');
    return await checkLumenAperture()})()`)
  await save()
  // Midpoint integration of this one-square-metre opening gives about .025.
  assert.ok(report.apertureControl[0][0]>.012 && report.apertureControl[0][0]<.05)
  assert.deepEqual(report.apertureControl[0].slice(1),[0,0,0])
  assert.deepEqual(report.apertureControl[1],[0,0,0,0])
}
async function captureMotion(){
  const frames=[], cameras=[]
  const offsets=[0,.04,.08,.12,.16,.20,.24,.28,.32,.28,.24,.20,.16,.12,.08,.04,0]
  let info
  for(const offset of offsets){
    const {pixels,metadata}=await capture(undefined,offset)
    const image=await sharp(pixels).resize({width:768}).removeAlpha().raw().toBuffer({resolveWithObject:true})
    frames.push(image.data);info=image.info;cameras.push(metadata.camera)
  }
  await sharp(Buffer.concat(frames),{raw:{width:info.width,height:info.height*frames.length,pageHeight:info.height,channels:info.channels}})
    .webp({loop:0,delay:100,quality:90}).toFile(fileURLToPath(new URL('landing-motion.webp',output)))
  let worst=0,different=0
  const last=frames.at(-1)
  for(let i=0;i<last.length;i++){
    const difference=Math.abs(last[i]-frames[0][i]);worst=Math.max(worst,difference);if(difference)different++
  }
  report.motion={offsets,cameras,width:info.width,height:info.height,differentChannelsOnReturn:different,
    maximumCodeDifferenceOnReturn:worst,channels:last.length}
  await save()
}
async function captureLanding(){
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:'('+installNativeAudit.toString()+')()'})
  const url=origin+'/tests/browser/roofWallRegression.html?springfield-14&materials&lightingModel=existing&lightingView=custom&daylight-only&giShaderAudit'
  await browser.call('Page.navigate',{url:url+'&preview-lighting'})
  await browser.wait(ready,360000)
  console.log('Full renderer ready')
  if(reference) {
    await browser.evaluate(`(async()=>{const s=roofWallScene(),p=${JSON.stringify(pose)}; s.camera.position.fromArray(p.position);s.camera.quaternion.fromArray(p.quaternion);
      s.camera.fov=p.fov;s.camera.updateProjectionMatrix();s.camera.updateMatrixWorld(true);
      const {traceLandingReference}=await import('/tests/browser/springfieldReference.ts');
      traceLandingReference(s).then(result=>window.landingReference=result).catch(error=>window.referenceFailure=String(error))})()`)
    await browser.wait(`(() => {if(window.referenceFailure)throw Error(window.referenceFailure);return !!window.landingReference})()`,600000)
    const {image,stats}=await browser.evaluate('window.landingReference')
    report.reference=stats
    await writeFile(new URL('landing-reference.png',output),Buffer.from(image.split(',')[1],'base64'))
    await save()
  } else if(production) {
    await browser.evaluate("regressionSetLightingMode('automatic')")
    await browser.wait(`(() => {const g=roofWallScene().scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending})()`,600000)
    await capture('landing-production')
  } else {
    await browser.evaluate(`(async()=>{const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js');
      window.audit=await installRendererAudit(s);await audit.configure({giShader:false,probeGI:false});s.scene.userData.getIndirectUniforms().hdGIScreenDiffuse.value=1})()`)
    if(!motionOnly && !profileOnly){
      await capture('landing-off')
      report.directTiming=await browser.evaluate(`(async()=>{const p=await audit.sample(4000,false);
        return {frame:p.frameMs,gpu:p.gpuFrameMs,cpu:p.cpuFrameMs}})()`)
    }
    if(motionOnly || profileOnly)await capture(undefined)
    await select('GI backend','lumen')
    console.log('Selected Lumen backend')
    await browser.wait(`(() => {const s=roofWallScene().scene.userData.lumenGI;if(s?.state==='error')throw Error(s.detail);return s?.state==='ready'&&s.daylightReady})()`,240000)
    if(motionOnly){await captureMotion();return}
    if(profileOnly){
      report.controls=[]
      for(const [label,enabled,passes] of [['off',false,false],['on',true,false],['off again',false,false],['passes on',true,true],['passes off',false,true]]){
        const sample=await browser.evaluate(`(async()=>{const s=await audit.sampleLumenControl(${enabled},${passes});return {
          frame:s.frameMs,gpu:s.gpuFrameMs,cpu:s.cpuFrameMs,passes:s.passes.map(p=>({name:p.name,
          gpu:p.gpuMs.median,perFrame:p.executionsPerFrame,draws:p.drawCallsPerFrame,triangles:p.trianglesPerFrame}))}})()`)
        report.controls.push({label,...sample});await save()
      }
      return
    }
    await capture('landing-lumen')
    await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
    await browser.wait(`!!document.querySelector('[aria-label="Lumen GI view"]')`)
    const names=await browser.evaluate(`Array.from(document.querySelector('[aria-label="Lumen GI view"]').options,o=>o.text)`)
    for(let view=1;view<names.length;view++) {
      await select('Lumen GI view',view)
      await capture('landing-'+names[view].toLowerCase().replaceAll(' ','-'))
    }
    await select('Lumen GI view',0)
    await capture('landing-lumen-camera-motion',.3)
    await capture('landing-lumen')
    report.timing={}
    for(const [name,moving] of [['stationary',false],['camera',true]]) {
      console.log('Timing',name)
      report.timing[name]=await browser.evaluate(`(async()=>{const p=await audit.sample(4000,${moving});return {frame:p.frameMs,gpu:p.gpuFrameMs,cpu:p.cpuFrameMs}})()`)
    }
    report.passes=await browser.evaluate(`(async()=>{const p=await audit.sample(3000,false,true);return p.passes.filter(v=>v.name.includes('Lumen')).map(v=>({name:v.name,gpu:v.gpuMs,perFrame:v.executionsPerFrame}))})()`)
    const pad=await browser.evaluate(`(() => {const el=document.querySelector('[aria-label="Move light source"]'),r=el.getBoundingClientRect();
      window.sunInputs=[];el.addEventListener('pointerdown',e=>sunInputs.push(performance.now()));
      el.addEventListener('pointermove',e=>{if(e.buttons)sunInputs.push(performance.now())});
      window.sunFrames=[];window.sunCompletions=[];const s=roofWallScene(),u=s.scene.userData,initial=u.lumenGI.sunFrames;
      const gl=s.gl.getContext(),pending=[];
      let last=initial,until=performance.now()+5000;
      const tick=()=>{
        if(u.lumenGI.sunFrames!==last){
          last=u.lumenGI.sunFrames;const submitted=u.lumenGI.lastSunFrameAt;sunFrames.push(submitted);
          const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(fence){pending.push({fence,submitted});gl.flush()}
        }
        while(pending.length){
          const p=pending[0], result=gl.clientWaitSync(p.fence,0,0);
          if(result===gl.TIMEOUT_EXPIRED)break;
          if(result!==gl.WAIT_FAILED)sunCompletions.push({submitted:p.submitted,observed:performance.now()});
          gl.deleteSync(p.fence);pending.shift()
        }
        if(performance.now()<until || pending.length)requestAnimationFrame(tick)};requestAnimationFrame(tick);
      window.sunMotionSample=audit.sample(4000,false).then(p=>({frame:p.frameMs,cpu:p.cpuFrameMs,gpu:p.gpuFrameMs}));
      return {x:r.x+r.width*.5,y:r.y+r.height*.5,r:r.width*.3}})()`)
    const mouse=(type,angle)=>browser.call('Input.dispatchMouseEvent',{type,x:pad.x+pad.r*Math.cos(angle),y:pad.y+pad.r*Math.sin(angle),
      button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:1})
    await mouse('mousePressed',1.36)
    for(let i=1;i<=12;i++){await mouse('mouseMoved',1.36+i*.015);await new Promise(r=>setTimeout(r,60))}
    await mouse('mouseReleased',1.54)
    report.sunMotion=await browser.evaluate(`(async()=>({sample:await sunMotionSample,inputs:sunInputs,frames:sunFrames,completions:sunCompletions,
      geometryBuilds:roofWallScene().scene.userData.lumenGI.geometryBuilds}))()`)
    report.sun=await browser.evaluate(`(async()=>{const u=roofWallScene().scene.userData, before=u.lumenGI.relights, start=performance.now();
      updateRegressionSunPosition(s=>({...s,azimuth:s.azimuth+.15}));while(u.lumenGI.relights===before&&performance.now()-start<20000)await new Promise(requestAnimationFrame);
      return {elapsed:performance.now()-start,before,after:u.lumenGI.relights,status:{...u.lumenGI},production:u.indirectLighting?.state}})()`)
    report.edits={}
    for(const [name,edit] of [
      ['selection',"selectRegressionModel(regressionFloors[1].models.find(m=>m.modelId.includes('door')).id)"],
      ['finish',`const floor=regressionFloors[1], room=floor.rooms.find(r=>r.name==='Room 5');
        const finish=regressionAssignments.findLast(a=>a.target.floorId===floor.id && a.target.roomSignature===room.signature && a.target.type==='room-floor');
        updateRegressionAssignments(list=>list.map(a=>a.id===finish.id?{...a,materialId:'farrow-ball-hague-blue'}:a))`],
      ['window','regressionMoveWindow(.12)']
    ]){
      const before=await browser.evaluate('({...roofWallScene().scene.userData.lumenGI})')
      await browser.evaluate(edit)
      if(name==='selection')await browser.evaluate('new Promise(resolve=>setTimeout(resolve,1000))')
      else await browser.wait(`(()=>{const r=roofWallScene().scene.userData.lumenGI;if(r.state==='error')throw Error(r.detail);return r.relights>${before.relights}&&r.state==='ready'})()`,180000)
      const after=await browser.evaluate('({...roofWallScene().scene.userData.lumenGI})')
      report.edits[name]={builds:after.geometryBuilds-before.geometryBuilds,relights:after.relights-before.relights,state:after.state}
      await save()
    }
    report.shaderAudit=await browser.evaluate('roofWallScene().scene.userData.viewportShaderAudit')
    await save()
    assert.equal(report.sun.production,'suspended')
    assert.ok(report.sun.after>report.sun.before)
    assert.equal(report.edits.selection.builds,0)
    assert.equal(report.edits.selection.relights,0)
    assert.equal(report.edits.finish.builds,0)
    assert.ok(report.edits.window.builds>0)
    assert.deepEqual(report.shaderAudit.events,[])
    await checkAperture()
  }
}
try {
  if(apertureOnly){
    await browser.call('Page.navigate',{url:origin+'/package.json'})
    await browser.wait(`location.pathname==='/package.json'`)
    await checkAperture()
  } else {
    await captureLanding()
  }
  assert.deepEqual(browser.errors,[])
} catch(error) {
  report.failure=String(error)
  report.errors=browser.errors
  report.consoleStacks=consoleStacks
  report.state=await browser.evaluate('window.roofWallScene?.()?.scene.userData.lumenGI').catch(()=>undefined)
  await save()
  throw error
} finally {browser.close()}
