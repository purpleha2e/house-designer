(async () => {
  const { Mesh, modelsById } = window.regressionTools
  const s = window.roofWallScene(), floor = window.regressionFloors[0]
  const definition = [...modelsById.values()].find(d => d.wallMount === 'window' && d.sourceUrl)
  const wall = floor.walls.filter(w => Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y) > definition.width + .4)
    .sort((a,b) => Math.hypot(b.end.x-b.start.x,b.end.y-b.start.y)-Math.hypot(a.end.x-a.start.x,a.end.y-a.start.y))[0]
  const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz)
  const x=(wall.start.x+wall.end.x)/2,z=(wall.start.y+wall.end.y)/2,y=floor.elevation+1.5
  s.camera.position.set(x-dz/length*2,y,z+dx/length*2);s.camera.lookAt(x,y,z);s.camera.updateMatrixWorld()
  s.setDpr(.6)
  await new Promise(r => setTimeout(r,500))
  const started=performance.now(), metrics={mountedMs:null,displayMs:null,pointerMs:[],raycastMs:0,raycasts:0}
  const originalRaycast=Mesh.prototype.raycast
  Mesh.prototype.raycast=function(...args){const start=performance.now();try{return originalRaycast.apply(this,args)}finally{metrics.raycastMs+=performance.now()-start;metrics.raycasts++}}
  const render=s.gl.render.bind(s.gl),wrapped=new Set()
  s.gl.render=(scene,camera)=>{
    let root;s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='opening-placement-preview')root=o})
    if(root&&metrics.mountedMs===null)metrics.mountedMs=performance.now()-started
    if(root&&camera===s.camera){
      const geometries=new Set();root.traverse(o=>{if(o.isMesh)geometries.add(o.geometry)})
      scene.traverseVisible(o=>{
        if(!o.isMesh||wrapped.has(o)||!geometries.has(o.geometry))return
        wrapped.add(o);const after=o.onAfterRender
        o.onAfterRender=function(...args){after.apply(this,args);const target=s.gl.getRenderTarget();
          if(o.geometry.drawRange.count>=0&&(!target||(target.width>1&&target.height>1))&&metrics.displayMs===null)metrics.displayMs=performance.now()-started}
      })
    }
    return render(scene,camera)
  }
  window.houseDesignerEngineLog?.clear()
  window.chooseRegressionOpening(definition.id)
  await new Promise(r=>setTimeout(r,100))
  const bounds=s.gl.domElement.getBoundingClientRect()
  for(let i=0;i<4;i++){
    const start=performance.now()
    s.gl.domElement.dispatchEvent(new PointerEvent('pointermove',{clientX:bounds.x+bounds.width/2+i,clientY:bounds.y+bounds.height/2,bubbles:true}))
    metrics.pointerMs.push(performance.now()-start)
    await new Promise(r=>setTimeout(r,200))
  }
  while(performance.now()-started<45000&&(metrics.displayMs===null||performance.now()-started<metrics.displayMs+8000))await new Promise(r=>setTimeout(r,200))
  Mesh.prototype.raycast=originalRaycast;s.gl.render=render
  return {...metrics,warmup:s.scene.userData.shaderWarmupProfile?.slice(-3),
    logs:window.houseDesignerEngineLog?.entries?.filter(e=>/preparation|clipping|warmup|model-load/.test(e.type))}
})()
