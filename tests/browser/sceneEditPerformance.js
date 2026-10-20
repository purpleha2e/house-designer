(async () => {
  const { syncWallOpenings, modelsById } = window.regressionTools
  const s = window.roofWallScene(), pause = ms => new Promise(r => setTimeout(r, ms))
  window.chooseRegressionOpening(null)
  await pause(500)
  const floor = window.regressionFloors.find(f => f.models.filter(m => m.wallAttachment && modelsById.get(m.modelId)?.wallMount === 'window').length >= 3)
  const windows = floor.models.filter(m => m.wallAttachment && modelsById.get(m.modelId)?.wallMount === 'window').slice(0, 3)
  const wall = floor.walls.find(w => w.id === windows[0].wallAttachment.wallId)
  const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz)
  const x=(wall.start.x+wall.end.x)/2,z=(wall.start.y+wall.end.y)/2,y=floor.elevation+1.5
  s.camera.position.set(x-dz/length*3,y,z+dx/length*3);s.camera.lookAt(x,y,z);s.camera.updateMatrixWorld()
  const key = material => (Array.isArray(material)?material:[material]).map(m=>[
    m.type,m.color?.getHexString(),m.map?.source.uuid,m.normalMap?.source.uuid,m.roughness,m.metalness,m.customProgramCacheKey(),m.envMap?.source.uuid].join(':')).join('|')
  const walls = () => { const result=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.userData.floorId===floor.id)result.push(o)});return result }
  async function measure(label, update, observe=walls, signature=o=>key(o.material)) {
    s.scene.updateMatrixWorld(true)
    const before=new Map(observe().map(o=>[o.geometry,signature(o)])),started=performance.now()
    const result={label,startedAt:started,mountedMs:null,displayMs:null},wrapped=new Map(),render=s.gl.render.bind(s.gl)
    const tasks=[],gaps=[]
    const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration}))))
    observer.observe({type:'longtask'})
    let previous=performance.now()
    const heartbeat=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now},16)
    const profiles=s.scene.userData.shaderWarmupProfile?.length??0
    window.houseDesignerEngineLog?.clear()
    s.gl.render=(scene,camera)=>{
      const changed=observe().filter(o=>before.get(o.geometry)!==signature(o))
      if(changed.length&&result.mountedMs===null)result.mountedMs=performance.now()-started
      if(camera===s.camera)scene.traverseVisible(o=>{
        if(!o.isMesh||wrapped.has(o)||!changed.some(c=>c.geometry===o.geometry&&signature(c)===signature(o)))return
        const after=o.onAfterRender;wrapped.set(o,after)
        o.onAfterRender=function(...args){after.apply(this,args);const target=s.gl.getRenderTarget()
          if(o.geometry.drawRange.count>=0&&(!target||(target.width>1&&target.height>1))&&result.displayMs===null)result.displayMs=performance.now()-started}
      })
      return render(scene,camera)
    }
    try {
      update()
      while(performance.now()-started<90000&&(result.displayMs===null||s.scene.userData.shaderWarmupPending))await pause(200)
      return {...result,maxTaskMs:Math.max(0,...tasks.map(t=>t.ms)),maxUiGapMs:Math.max(0,...gaps),tasks,
        profiles:s.scene.userData.shaderWarmupProfile?.slice(profiles).map(p=>({stages:p.stages,cancelled:p.cancelled,batches:p.batches})),
        logs:window.houseDesignerEngineLog?.entries?.filter(e=>/preparation|clipping|warmup/.test(e.type))}
    } finally {observer.disconnect();clearInterval(heartbeat);s.gl.render=render;wrapped.forEach((after,o)=>{o.onAfterRender=after})}
  }
  const moved=await measure('move three windows',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>f.id!==floor.id?f:syncWallOpenings({...f,
    models:f.models.map(m=>windows.some(w=>w.id===m.id)?{...m,wallOpeningBottom:Math.max(0,(m.wallOpeningBottom??.9)-.1)}:m)},modelsById))))
  const finishes=window.regressionAssignments.filter(a=>a.target.wallId&&floor.walls.some(w=>w.id===a.target.wallId))
  const replacement=finishes.find(a=>a.materialId!==finishes[0]?.materialId)?.materialId
  const painted=await measure('change wall finish',()=>window.updateRegressionAssignments(window.regressionAssignments.map(a=>
    a.target.wallId&&floor.walls.some(w=>w.id===a.target.wallId)?{...a,materialId:replacement??a.materialId,customColor:'#d58066'}:a)))
  const results=[moved,painted]
  if(window.regressionFirstUseMaterial){
    const {surfaceMaterialsById,registerRuntimeSurfaceMaterials}=window.regressionTools
    const base=surfaceMaterialsById.get(replacement??finishes[0].materialId)
    const material={...base,id:'performance-first-use-wall-finish',pbr:{...base.pbr,imageBasedLighting:!base.pbr.imageBasedLighting}}
    registerRuntimeSurfaceMaterials([...surfaceMaterialsById.values(),material])
    results.push(await measure('first-use wall finish',()=>window.updateRegressionAssignments(window.regressionAssignments.map(a=>
      a.target.wallId&&floor.walls.some(w=>w.id===a.target.wallId)?{...a,materialId:material.id}:a))))
    results.push(await measure('restore wall finish',()=>window.updateRegressionAssignments(window.regressionAssignments.map(a=>
      a.target.wallId&&floor.walls.some(w=>w.id===a.target.wallId)?{...a,materialId:replacement??finishes[0].materialId}:a))))
  }
  if(window.regressionExtraOperations){
    const door=window.regressionFloors.flatMap(f=>f.models).find(m=>m.wallAttachment&&modelsById.get(m.modelId)?.wallMount==='exterior-door')
    const doorWall=floor.walls.filter(w=>w.kind==='external'&&!w.openings?.length)
      .sort((a,b)=>Math.hypot(b.end.x-b.start.x,b.end.y-b.start.y)-Math.hypot(a.end.x-a.start.x,a.end.y-a.start.y))[0]
    if(!door||!doorWall)throw Error('No existing door and empty exterior wall for the insertion regression')
    const length=Math.hypot(doorWall.end.x-doorWall.start.x,doorWall.end.y-doorWall.start.y),id='performance-added-door'
    results.push(await measure('add a door',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>f.id!==floor.id?f:syncWallOpenings({...f,
      models:[...f.models,{...door,id,position:{x:(doorWall.start.x+doorWall.end.x)/2,y:(doorWall.start.y+doorWall.end.y)/2},
        rotation:Math.atan2(doorWall.end.y-doorWall.start.y,doorWall.end.x-doorWall.start.x),
        wallAttachment:{...door.wallAttachment,wallId:doorWall.id,offset:length/2}}]},modelsById)))))
    if(!s.scene.getObjectByName('model-transform-'+id))throw Error('Added door did not mount')
    const furniture=window.regressionFloors.flatMap(f=>f.models.map(m=>({f,m}))).find(({m})=>{
      const d=modelsById.get(m.modelId);return d?.sourceUrl&&!d.wallMount&&!d.roofMount&&!d.isLight&&d.objectType!=='stairs'
    })
    if(!furniture)throw Error('No furniture for movement regression')
    window.selectRegressionModel(furniture.m.id);window.updateRegressionActiveFloor(furniture.f.id)
    await pause(1500)
    const root=s.scene.getObjectByName('model-transform-'+furniture.m.id)
    let sample;root.traverse(o=>{if(!sample&&o.isMesh&&o.geometry.attributes.position?.count)sample=o})
    if(!sample)throw Error('Selected furniture has no renderable mesh')
    const p=root.getWorldPosition(root.position.clone());s.camera.position.set(p.x+2,p.y+1.5,p.z+2);s.camera.lookAt(p);s.camera.updateMatrixWorld()
    results.push(await measure('move furniture',()=>window.updateRegressionFloors(window.regressionFloors.map(f=>f.id!==furniture.f.id?f:{...f,
      models:f.models.map(m=>m.id===furniture.m.id?{...m,position:{...m.position,x:m.position.x+.25}}:m)})),
      ()=>[sample],o=>o.matrixWorld.elements.join(':')))
  }
  return results
})()
