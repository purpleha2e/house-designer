import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'

export const detailCrops={
  'ceiling-junction':{x:590,y:70,width:240,height:150},
  'flat-ceiling':{x:690,y:8,width:280,height:96},
  'timber-floor':{x:875,y:760,width:255,height:160},
  'window-frame':{x:158,y:153,width:235,height:168},
  'patio-frame':{x:1215,y:600,width:260,height:160},
}

export async function runLumenDetailReference({browser,evaluate,report,save,folder}){
  for(const [name,crop] of Object.entries(detailCrops)){
    const samples=name.endsWith('frame')?192:384
    await evaluate(({crop,samples})=>{
      window.detailReference=window.detailReferenceError=null
      setTimeout(()=>import('/tests/browser/springfieldReference.ts')
        .then(({traceLandingReference})=>traceLandingReference(roofWallScene(),samples,1,crop))
        .then(result=>{window.detailReference=result})
        .catch(error=>{window.detailReferenceError=String(error)}),0)
    },{crop,samples})
    await browser.wait('(()=>{if(window.detailReferenceError)throw Error(detailReferenceError);return !!window.detailReference})()',360000)
    const {image,stats}=await browser.evaluate('window.detailReference')
    assert.equal(stats.renderScale,1)
    assert.deepEqual([stats.width,stats.height],[crop.width,crop.height])
    assert.ok(stats.samples>=samples)
    report.views[name]=stats
    await writeFile(new URL('detail-reference-'+name+'.png',folder),Buffer.from(image.split(',')[1],'base64'))
    await save()
    console.log(name,'native reference complete')
  }
}

export async function checkFloorReferenceConvergence({browser,evaluate,report,save,folder}){
  await browser.wait('roofWallScene().scene.userData.lumenGI.bounceReady&&!roofWallScene().scene.userData.lumenGI.refining',240000)
  await evaluate(crop=>{
    window.detailReference=window.detailReferenceError=null
    setTimeout(()=>import('/tests/browser/springfieldReference.ts')
      .then(({traceLandingReference})=>traceLandingReference(roofWallScene(),384,1,crop,128,true))
      .then(result=>{window.detailReference=result})
      .catch(error=>{window.detailReferenceError=String(error)}),0)
  },detailCrops['timber-floor'])
  await browser.wait('(()=>{if(window.detailReferenceError)throw Error(detailReferenceError);return !!window.detailReference})()',360000)
  const {image,checkpoint,stats,full}=await browser.evaluate('window.detailReference')
  const images=[checkpoint,image].map(url=>Buffer.from(url.split(',')[1],'base64'))
  const level=async png=>{
    const s=await sharp(png).removeAlpha().stats()
    return s.channels.slice(0,3).map(c=>c.mean)
  }
  report.samples=stats
  report.means=await Promise.all(images.map(level));await save()
  assert.ok(full.rayError<1e-10,'The matched full-view and cropped camera rays differ')
  const reduced=await sharp(Buffer.from(full.image.split(',')[1],'base64')).extract({left:stats.crop.x,top:stats.crop.y,width:stats.crop.width,height:stats.crop.height}).png().toBuffer()
  report.frozenFull={rayError:full.rayError,samples:full.samples,scale:full.scale,mean:await level(reduced)};await save()
  await writeFile(new URL('detail-floor-convergence-full-view.png',folder),reduced)
  await Promise.all(images.map((png,i)=>writeFile(new URL(`detail-floor-convergence-${[128,384][i]}.png`,folder),png)))
}

export async function runLumenResolutionAudit({browser,evaluate,capture,report,save,folder,mode}){
  await evaluate(async()=>{
    const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(s)
    const {createLumenResolutionProbe}=await import('/tests/browser/lumenResolutionProbe.js')
    window.detail=createLumenResolutionProbe(s,audit)
    await audit.configure({giShader:false,probeGI:false})
  })
  const status='roofWallScene().scene.userData.lumenGI'
  await browser.wait(`${status}.bounceReady && !${status}.refining`,240000)
  const native=()=>browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})')
  const buffers=()=>browser.evaluate('detail.buffers()')
  const frame=label=>capture(`${mode}-${label}`)
  const store=(label,url)=>writeFile(new URL(`${mode}-${label}.png`,folder),Buffer.from(url.split(',')[1],'base64'))
  report.before=await native()
  report.buffers=await buffers();await save()
  await frame('final')
  const stages=await browser.evaluate('detail.readNativeStages()')
  for(const [label,url] of Object.entries(stages))await store(label,url)
  if(report.buffers.floorDetail?.active)await store('floor-material',await browser.evaluate('detail.floorImage()'))
  const {drawingBuffer:[width,height]}=report.buffers
  await sharp(fileURLToPath(new URL(`${mode}-raw.png`,folder))).resize(width,height,{kernel:'nearest'}).png().toFile(
    fileURLToPath(new URL(`${mode}-raw-nearest.png`,folder)))
  for(const [label,options] of [['cached-sky',{cache:true}],['raw-reconstruction',{raw:true}],['reconstruction',{}]]){
    await evaluate(options=>{window.undoDetail=detail.overrideComposite(options)},options)
    try{await frame(label)}finally{await browser.evaluate('undoDetail()')}
  }
  await browser.evaluate('window.undoDetail=audit.lumenDirectOnly(true)')
  try{
    await browser.evaluate("audit.ao.setDisplayMode('AO')")
    await frame('ao-only')
    await browser.evaluate("audit.ao.setDisplayMode('Combined')")
    await frame('no-gi')
    await browser.evaluate('audit.configure({ao:false,giShader:false,probeGI:false})')
    await frame('direct')
    await evaluate(()=>{
      window.restoreShadow=[];roofWallScene().scene.traverse(object=>{
        if(object.shadow){restoreShadow.push([object.shadow,object.shadow.intensity]);object.shadow.intensity=0}
      })
    })
    await frame('direct-no-shadows')
    await evaluate(()=>{for(const [shadow,intensity] of restoreShadow)shadow.intensity=intensity})
  }finally{await browser.evaluate('undoDetail()')}
  await frame('no-ao')
  await browser.evaluate('audit.configure({giShader:false,probeGI:false})')
  report.after=await native();await save()
  assert.deepEqual(report.after,report.before)
  await store('albedo',await browser.evaluate('detail.albedo()'))
  report.composition=await evaluate(async()=>{
    const {checkLumenComposition}=await import('/tests/browser/lumenComposition.ts')
    return checkLumenComposition()
  })
  await save()
  assert.ok(report.composition.every(row=>row.maxLinearError<=.0005&&row.maxDisplayError<=1))
  console.log(mode,'buffer and stage captures complete')
}

export async function runLumenResolutionMatrix({browser,evaluate,capture,report,save,status,originScene,mode}){
  await evaluate(async originScene=>{
    const s=window[originScene](),{createLumenResolutionProbe}=await import('/tests/browser/lumenResolutionProbe.js')
    window.detail=createLumenResolutionProbe(s,audit)
  },originScene)
  const ready=`${status}.bounceReady && !${status}.refining`
  const native=()=>browser.evaluate(`${originScene}().scene.userData.viewportShaderAudit.totals`)
  report.before=await native();report.matrix=[]
  const trials=[['A',4,2],['A',2,2],['A',1,2],['B',4,16],['B',2,4],['B',1,1]]
  for(const [experiment,divisor,rays] of trials){
    const label=`${mode}-${experiment}-${divisor}`
    const size=await evaluate((d,r)=>detail.traceResolution(d,r),divisor,rays)
    await capture(label+'-settled')
    Object.assign(size,await browser.evaluate('detail.traceWork()'))
    const settled=await evaluate(async()=>{
      const p=await audit.sample(1500,false)
      return {fps:p.presentedFPS,frame:p.frameMs,gpu:p.gpuFrameMs}
    })
    const moving=await evaluate(async()=>{
      const p=await audit.sample(2400,true)
      return {fps:p.presentedFPS,frame:p.frameMs,gpu:p.gpuFrameMs,cpu:p.cpuFrameMs}
    })
    const passes=await evaluate(async()=>{
      const p=await audit.sample(1600,true,true)
      return p.passes.filter(x=>x.name.includes('Lumen')||x.name.includes('scene-materials'))
        .map(x=>({name:x.name,ms:x.gpuMs,count:x.executionsPerFrame}))
    })
    await browser.wait(ready,240000)
    await capture(label+'-returned')
    report.matrix.push({experiment,divisor,...size,settled,moving,passes});await save()
    console.log(label,size.width,size.height,'moving FPS',moving.fps)
  }
  await evaluate(()=>detail.traceResolution(4,2))
  report.after=await native();await save()
  assert.deepEqual(report.after,report.before)
}

export async function runLumenSamplingAudit({browser,evaluate,capture,select,report,save,folder}){
  await evaluate(async()=>{
    const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(s)
    const {createLumenResolutionProbe}=await import('/tests/browser/lumenResolutionProbe.js')
    window.detail=createLumenResolutionProbe(s,audit)
  })
  const state='roofWallScene().scene.userData.lumenGI'
  await browser.wait(`${state}.bounceReady&&!${state}.refining`,240000)
  for(const [index,name] of ['regular','per-pixel','per-tile'].entries()){
    await evaluate(index=>detail.samplePattern(index),index)
    await capture('detail-sampling-'+name)
    const {raw}=await browser.evaluate('detail.readNativeStages()')
    await writeFile(new URL('detail-sampling-'+name+'-raw.png',folder),Buffer.from(raw.split(',')[1],'base64'))
  }
  await select('Lumen GI view',18)
  await capture('detail-sampling-exterior-ground')
  await select('Lumen GI view',20)
  await capture('detail-sampling-later-bounce')
  await select('Lumen GI view',0)
  report.shader=await browser.evaluate('roofWallScene().scene.userData.viewportShaderAudit');await save()
}

export async function runLumenShadowAudit({browser,evaluate,capture,report,save}){
  await evaluate(async()=>{
    const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(roofWallScene())
    const s=roofWallScene();window.auditSun=null
    s.scene.traverse(object=>{if(object.isDirectionalLight&&object.userData.houseDesignerRole==='sun-light')window.auditSun=object})
    if(!auditSun)throw Error('Sun unavailable')
    window.originalBias=auditSun.shadow.normalBias
    await audit.configure({ao:false,giShader:false,probeGI:false})
    window.undoDetail=audit.lumenDirectOnly(true)
  })
  try{
    for(const bias of [0,.004,.008,.015,.025]){
      await evaluate(bias=>{auditSun.shadow.normalBias=bias;auditSun.shadow.needsUpdate=true},bias)
      await capture('detail-shadow-'+bias)
    }
  }finally{await browser.evaluate('auditSun.shadow.normalBias=originalBias;undoDetail()')}
  report.shader=await browser.evaluate('roofWallScene().scene.userData.viewportShaderAudit');await save()
}

export async function runLumenSeamAudit({browser,evaluate,capture,report,save,folder}){
  await evaluate(async()=>{
    const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(roofWallScene())
    await audit.configure({ao:false,giShader:false,probeGI:false})
    window.undoDetail=audit.lumenDirectOnly(true)
  })
  await capture('detail-seam-direct')
  const file=fileURLToPath(new URL('detail-seam-direct.png',folder))
  const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true}), points=[]
  for(let first=45;first<1525;first+=170){
    let best=0, sample=null
    for(let x=first;x<first+50;x++){
      const y0=x<724?13+.208*x:163-.107*(x-724)
      for(let y=Math.floor(y0)-8;y<=y0+8;y++){
        const v=data[(y*info.width+x)*info.channels]
        if(v>best){best=v;sample={x,y,red:v}}
      }
    }
    if(sample)points.push(sample)
  }
  report.rays=await evaluate(async({width,height,points})=>{
    const {Box3,Raycaster,Vector2}=await import('/tests/browser/rendererTestModules.ts'),s=roofWallScene(),ray=new Raycaster(),sun=s.scene.getObjectByProperty('type','DirectionalLight')
    const meshes=[],blockers=[]
    s.scene.traverseVisible(o=>{if(o.isMesh&&!o.userData.selectionDecoration&&(Array.isArray(o.material)||o.material.colorWrite))meshes.push(o)})
    s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole==='room-ceiling-shadow-blocker')blockers.push(o)})
    window.ceilingBlockers=blockers
    const direction=sun.position.clone().sub(sun.target.position).normalize()
    const material=hit=>Array.isArray(hit.object.material)?hit.object.material[hit.face?.materialIndex??0]:hit.object.material
    const describe=hit=>({role:hit.object.userData.houseDesignerRole,name:hit.object.name,point:hit.point.toArray(),distance:hit.distance,
      castsShadow:hit.object.castShadow,material:material(hit)?.type,side:material(hit)?.side,normal:hit.face?.normal.toArray()})
    const cast=(x,y)=>{
      ray.setFromCamera(new Vector2((x+.5)/width*2-1,1-(y+.5)/height*2),s.camera)
      const hits=ray.intersectObjects(meshes,false).filter(hit=>{
        const m=material(hit);return m?.visible&&m.colorWrite&&m.opacity>0
      }),first=hits[0]
      if(!first)return {hits:[]}
      ray.set(first.point.clone().addScaledVector(direction,.0001),direction)
      const occlusion=ray.intersectObjects([...blockers,...meshes.filter(o=>o.castShadow)],false)
      return {hits:hits.slice(0,2).map(describe),occlusion:occlusion.slice(0,3).map(describe)}
    }
    return {direction:direction.toArray(),points:points.map(p=>({...p,...cast(p.x,p.y),below:cast(p.x,p.y+2)})),
      blockers:blockers.map(o=>{const b=new Box3().setFromObject(o);return [b.min.toArray(),b.max.toArray()]})}
  },{width:info.width,height:info.height,points})
  await save()
  await evaluate(()=>{
    // A 2 cm extension into the wall only on the shadow mesh, for attribution.
    window.previousBlockers=ceilingBlockers.map(o=>{
      const old=o.geometry,geom=old.clone();geom.computeBoundingBox();const box=geom.boundingBox
      const x=(box.max.x+box.min.x)/2,y=(box.max.y+box.min.y)/2
      geom.translate(-x,-y,0);geom.scale(1+.04/(box.max.x-box.min.x),1+.04/(box.max.y-box.min.y),1);geom.translate(x,y,0)
      o.geometry=geom;return {o,old,geom}
    })
  })
  try{await capture('detail-seam-overlap')}
  finally{await evaluate(()=>{for(const {o,old,geom} of previousBlockers){o.geometry=old;geom.dispose()}undoDetail()})}
  await browser.evaluate('window.undoDetail=audit.lumenDirectOnly(true)')
  try{
    for(const offset of [.02,.04]){
      await evaluate(offset=>{for(const o of ceilingBlockers)o.position.y+=offset},offset)
      try{await capture('detail-seam-raised-'+offset)}
      finally{await evaluate(offset=>{for(const o of ceilingBlockers)o.position.y-=offset},offset)}
    }
  }finally{await browser.evaluate('undoDetail()')}
  await save()
}
