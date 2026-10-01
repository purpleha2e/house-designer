// Run in roofWallRegression.html?springfield-14&materials.
export async function checkDoorwayFloors() {
  const { Raycaster, Vector3 } = await import('three')
  const s=window.roofWallScene(), groups=[], floors=[]
  s.scene.updateMatrixWorld(true)
  s.scene.traverse(o=>{
    if(o.userData.houseDesignerRole==='doorway-floor')groups.push(o)
    if(o.isMesh&&['room-floor-finish','room-floor-base'].includes(o.userData.houseDesignerRole))floors.push(o)
  })
  if(groups.length<2)throw Error('Fixture requires interior doorways')
  let samples=0, pick
  for(const group of groups){
    const floor=window.regressionFloors.find(f=>f.id===group.userData.floorId)
    const finish=group.children.find(o=>o.userData.houseDesignerRole==='room-floor-finish')
    const mesh=finish??group.children.find(o=>o.userData.houseDesignerRole==='room-floor-base')
    const geometry=mesh.geometry, positions=geometry.attributes.position
    const count=geometry.index?.count??positions.count
    for(let i=0;i<count;i+=3){
      const vertices=[0,1,2].map(j=>mesh.localToWorld(new Vector3().fromBufferAttribute(positions,geometry.index?geometry.index.getX(i+j):i+j)))
      const point=vertices[0].add(vertices[1]).add(vertices[2]).multiplyScalar(1/3)
      const hits=new Raycaster(point.clone().add(new Vector3(0,0.05,0)),new Vector3(0,-1,0)).intersectObjects(floors,false)
        .filter(hit=>Math.abs(hit.point.y-point.y)<0.0001)
      if(new Set(hits.map(hit=>hit.object.uuid)).size!==1)throw Error('Overlapping doorway floor finishes')
      samples++
      if(!pick&&floor.elevation===0&&finish)pick={point,group,material:finish.material}
    }
  }
  if(!pick)throw Error('Fixture requires a ground-floor doorway finish')
  const saved={position:s.camera.position.clone(),quaternion:s.camera.quaternion.clone()}
  try{
    s.camera.position.copy(pick.point).add(new Vector3(0,0.6,0.001));s.camera.lookAt(pick.point);s.camera.updateMatrixWorld();s.invalidate()
    await new Promise(r=>setTimeout(r,600))
    const c=s.gl.domElement,r=c.getBoundingClientRect(),e={bubbles:true,button:0,pointerId:1,pointerType:'mouse',clientX:r.left+r.width/2,clientY:r.top+r.height/2}
    c.dispatchEvent(new PointerEvent('pointerdown',{...e,buttons:1}));c.dispatchEvent(new PointerEvent('pointerup',{...e,buttons:0}))
    await new Promise(r=>setTimeout(r,800))
    const selected=window.regressionSurface
    if(selected?.type!=='room-floor'||selected.roomSignature!==pick.group.userData.roomSignature||selected.floorId!==pick.group.userData.floorId)
      throw Error('Doorway did not select its adjoining room floor: '+JSON.stringify(selected))
    // The world-space UVs must continue through the opening, without a fresh
    // tile origin or scaling for this narrow patch.
    for(const group of groups)for(const mesh of group.children){
      if(mesh.userData.houseDesignerRole!=='room-floor-finish')continue
      const p=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv
      for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-uv.getX(i))>1e-6||Math.abs(p.getY(i)-uv.getY(i))>1e-6)
        throw Error('Doorway texture coordinates restart at the threshold')
    }
    return {passed:true,extensions:groups.length,samples,roomFloorPicking:true,continuousUvs:true,
      previewPoint:pick.point.toArray(),floorId:pick.group.userData.floorId}
  }finally{
    s.camera.position.copy(saved.position);s.camera.quaternion.copy(saved.quaternion);s.camera.updateMatrixWorld();s.invalidate()
  }
}
