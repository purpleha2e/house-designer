import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {roomViews} from './lumenRoomViews.mjs'

export async function runLumenWorldAudit({browser,evaluate,capture,select,report,save,folder,mode}){
  await evaluate(async()=>{
    const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(s)
    const {createLumenResolutionProbe}=await import('/tests/browser/lumenResolutionProbe.js')
    const {readWorldGrid,worldGridDefinitions}=await import('/tests/browser/lumenWorldGrid.js')
    window.gridDefinitions=worldGridDefinitions()
    window.readWorld=()=>readWorldGrid(s.gl,audit.lumenPass(),gridDefinitions)
    window.detail=createLumenResolutionProbe(s,audit)
    await audit.configure({giShader:false,probeGI:false})
  })
  const ground='roofWallScene().scene.userData.lumenGI'
  const ready=`${ground}.bounceReady && !${ground}.refining`
  const shader=()=>browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})')
  const meta=()=>browser.evaluate(`(({geometryBuilds,bvhBuilds,cacheHits,cacheMisses,relights,cacheProfile})=>({geometryBuilds,bvhBuilds,cacheHits,cacheMisses,relights,submissions:[...cacheProfile.submissions]}))(${ground})`)
  const settle=()=>browser.wait(ready,240000)
  await settle()
  if(mode==='world-image-reference'){
    await evaluate(()=>{
      const s=roofWallScene()
      window.worldReference=undefined;window.worldReferenceError=undefined
      setTimeout(()=>import('/tests/browser/springfieldReference.ts')
        .then(({traceLandingReference})=>traceLandingReference(s,144,.4))
        .then(result=>window.worldReference=result).catch(error=>window.worldReferenceError=String(error)),0)
    })
    await browser.wait('(()=>{if(window.worldReferenceError)throw Error(worldReferenceError);return !!window.worldReference})()',600000)
    const {image,stats}=await browser.evaluate('window.worldReference')
    report.reference=stats;await save()
    await writeFile(new URL('world-path-reference.png',folder),Buffer.from(image.split(',')[1],'base64'))
    return
  }
  if(mode==='world-patterns'){
    report.patterns=[];report.shaderBefore=await shader()
    for(const [pattern,name] of ['original','rotated','surface','decorrelated'].entries()){
      const world=await evaluate(async pattern=>{
        const s=roofWallScene(),pass=audit.lumenPass(),gl=s.gl,frame=s.frameloop,
          {readWorldGrid}=await import('/tests/browser/lumenWorldGrid.js')
        const u=pass.surfaceBounceMaterial.uniforms,p=Object.fromEntries(['surfaceBouncePattern','surfaceBounceOrder','previousFront','previousBack','filterFeedback']
          .map(key=>[key,u[key].value]))
        const targets=pass.surfaceBounceAtlases.map(t=>t.clone()),old=gl.getRenderTarget()
        try{
          s.setFrameloop('never');u.surfaceBouncePattern.value=pattern;u.filterFeedback.value=false
          for(const [order,target] of targets.entries()){
            target.scissorTest=false;u.surfaceBounceOrder.value=order
            u.previousFront.value=order?targets[0].texture:pass.surfaceBounceAtlases[0].texture
            u.previousBack.value=order?targets[0].textures[1]:pass.surfaceBounceAtlases[0].textures[1]
            pass.surfaceBouncePass.render(gl,audit.composer.inputBuffer,target)
          }
          return await readWorldGrid(gl,{...pass,surfaceBounceAtlases:targets},gridDefinitions)
        }finally{
          for(const [key,value] of Object.entries(p))u[key].value=value
          gl.setRenderTarget(old);targets.forEach(t=>t.dispose());s.setFrameloop(frame)
        }
      },pattern)
      // Stencils and patch identities are shared, only the radiance changes.
      report.patterns.push({name,grids:world.grids.map(g=>({name:g.name,points:g.points.map(p=>p.missing?null:
        [p.nearest.firstBounce[0],p.nearest.laterBounce[0],p.interpolated.outgoing[0],p.weighted.outgoing[0]])}))})
      await save()
    }
    report.shaderAfter=await shader();await save();assert.deepEqual(report.shaderBefore,report.shaderAfter)
    return
  }
  if(mode==='world-reference'){
    await evaluate(async()=>{
      const {traceWorldReference}=await import('/tests/browser/lumenWorldReference.ts')
      const s=roofWallScene()
      window.worldReference=undefined;window.worldReferenceError=undefined
      setTimeout(()=>traceWorldReference(s,gridDefinitions,count=>window.worldReferenceProgress=count)
        .then(result=>window.worldReference=result).catch(error=>window.worldReferenceError=String(error)),0)
    })
    await browser.wait('(()=>{if(window.worldReferenceError)throw Error(worldReferenceError);return !!window.worldReference})()',600000)
    report.reference=await browser.evaluate('window.worldReference');await save()
    return
  }
  report.shaderBefore=await shader();report.cache=await meta()
  const baseline=await browser.evaluate('readWorld()')
  if(mode!=='world-motion'){
    await capture(`${mode}-final`)
    report.world=baseline;await save()
    const savePNG=(label,url)=>writeFile(new URL(`${mode}-${label}.png`,folder),Buffer.from(url.split(',')[1],'base64'))
    const images=await browser.evaluate('detail.readNativeStages()')
    for(const [key,value] of Object.entries(images))await savePNG(key,value)
    for(const [diagnostic,name] of [[9,'sky'],[17,'sun'],[18,'ground'],[19,'first-trace'],[20,'later-trace'],[3,'screen-trace'],[4,'scene-trace'],[6,'hit-routes'],[22,'reconstructed']]){
      await select('Lumen GI view',diagnostic)
      await capture(`${mode}-${name}`)
    }
    await select('Lumen GI view',0)
  }
  await settle()
  report.motion=[]
  const pose=roomViews.room
  for(const [name,offset,opposite] of [['start',0,false],['doors',-2.7,false],['away',1.4,false],['opposite',1.1,true],['return',0,false]]){
    const afterMove=await evaluate(async({pose,offset,opposite})=>{
      const s=roofWallScene(),u=s.scene.userData
      s.camera.position.fromArray(pose.position);s.camera.position.z+=offset
      s.camera.quaternion.fromArray(pose.quaternion)
      if(opposite){s.camera.position.set(1.6,1.46,3.9);s.camera.lookAt(3.8,1.4,6.6)}
      s.camera.updateMatrixWorld(true)
      for(let i=0;i<5;i++){u.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}
      const p=audit.lumenPass();return {historyFrames:p.historyFrames,sequence:p.sequence}
    },{pose,offset,opposite})
    await settle()
    const screen=await evaluate(async()=>{
      const s=roofWallScene(),pass=audit.lumenPass(),camera=s.camera
      const points=[[-.9505,.85,1.9],[.52,.9,1],[.2181,2.38,2.506],[.88,.84,1],[-.9505,1.72,2.2],[.9,2.38,1.9]]
      const out=[]
      for(const position of points){
        const v=camera.position.clone().fromArray(position).project(camera)
        if(Math.abs(v.x)>.98||Math.abs(v.y)>.98||Math.abs(v.z)>1)continue
        const p=await s.scene.userData.inspectLumenPixel((v.x+1)*.5,(1-v.y)*.5)
        if(!p.compositedIndirect||Math.hypot(...position.map((x,i)=>x-p.receiverPositionMaterial[i]))>.09)continue
        out.push({position,raw:p.indirectRGB,resolved:p.resolvedDiffuseAndDepth,composited:p.compositedIndirect,routes:p.traceHitRatios})
      }
      return {screen:out,sequence:pass.sequence,history:pass.historyFrames}
    })
    let changed=0
    if(name!=='start'){
      const fresh=await browser.evaluate('readWorld()')
      for(const [i,grid] of fresh.grids.entries())for(const [j,p] of grid.points.entries()){
        if(JSON.stringify(p)!==JSON.stringify(baseline.grids[i].points[j]))changed++
      }
    }
    report.motion.push({name,afterMove,...screen,cache:await meta(),changed});await save()
  }
  await capture(`${mode}-return`)
  report.shaderAfter=await shader();await save()
  assert.deepEqual(report.shaderBefore,report.shaderAfter)
  assert.ok(report.motion.every(x=>x.changed===0),'Fixed-world lighting changed when the camera moved')
  if(mode==='world-motion')assert.ok(report.motion.filter(m=>m.screen.length).every(m=>m.screen.every(p=>p.routes?.length===4)))
  if(mode.endsWith('-after')){
    report.composition=await evaluate(async()=>{
      const {checkLumenComposition}=await import('/tests/browser/lumenComposition.ts')
      return checkLumenComposition()
    });await save()
    assert.ok(report.composition.every(row=>row.maxLinearError<=.0005&&row.maxDisplayError<=1))
  }
}
