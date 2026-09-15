// Run on roofWallRegression.html?materials after assets and wall workers settle.
export function captureWallBatching() {
  const {scene,camera,gl}=window.roofWallScene()
  const triangles=[], groups=[]
  const texture=t=>t ? [t.image?.src??'',t.image?.width,t.image?.height,...t.matrix.elements] : null
  scene.traverse(o=>{
    if(!o.isMesh||o.userData.houseDesignerRole!=='wall-engine-render')return
    const g=o.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv
    groups.push({elevation:o.position.y,groups:g.groups.length,materials:o.material.length})
    for(const group of g.groups){
      const m=o.material[group.materialIndex]
      const finish=JSON.stringify([m.type,m.color.getHexString(),m.roughness,m.metalness,m.side,m.opacity,m.transparent,
        texture(m.map),texture(m.normalMap),texture(m.roughnessMap),texture(m.aoMap),m.normalScale?.toArray()])
      for(let i=group.start;i<group.start+group.count;i+=3){
        const vertices=[0,1,2].map(offset=>{
          const j=g.index?g.index.getX(i+offset):i+offset
          return [p.getX(j),p.getY(j)+o.position.y,p.getZ(j),n.getX(j),n.getY(j),n.getZ(j),uv.getX(j),uv.getY(j)]
        })
        triangles.push(JSON.stringify([finish,vertices]))
      }
    }
  })
  // Sorting ignores batch order while retaining each triangle's finish and UVs.
  let hash=2166136261
  for(const triangle of triangles.sort())for(let i=0;i<triangle.length;i++)hash=Math.imul(hash^triangle.charCodeAt(i),16777619)
  const original=gl.renderBufferDirect, calls={main:0,shadow:0,wallsMain:0,wallsShadow:0}
  gl.renderBufferDirect=function(c,s,g,m,o,group){
    const before=gl.info.render.calls,result=original.apply(this,arguments),delta=gl.info.render.calls-before
    const shadow=m.isMeshDepthMaterial||m.isMeshDistanceMaterial
    calls[shadow?'shadow':'main']+=delta
    if(o.userData.houseDesignerRole==='wall-engine-render')calls[shadow?'wallsShadow':'wallsMain']+=delta
    return result
  }
  try{gl.render(scene,camera)}finally{gl.renderBufferDirect=original}
  return {groups:groups.sort((a,b)=>a.elevation-b.elevation),triangles:triangles.length,
    appearanceHash:(hash>>>0).toString(16),calls,total:calls.main+calls.shadow}
}

export function checkWallBatching() {
  const before=JSON.parse(sessionStorage.getItem('wall-batching-baseline')??'null')
  if(!before)throw new Error('Capture a baseline before enabling batching')
  const after=captureWallBatching()
  if(before.appearanceHash!==after.appearanceHash||before.triangles!==after.triangles)throw new Error(`Wall geometry or finish changed: ${JSON.stringify({before,after})}`)
  if(after.calls.wallsMain>=before.calls.wallsMain/2)throw new Error(`Wall draw calls were not substantially reduced: ${JSON.stringify({before,after})}`)
  return {passed:true,before,after}
}
