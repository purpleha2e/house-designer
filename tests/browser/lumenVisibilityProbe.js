import {BufferAttribute,BufferGeometry,DataTexture,DoubleSide,FloatType,Ray,RGBAFormat,ShaderMaterial,Triangle,Vector3,WebGLRenderTarget} from 'three'
import {MeshBVH,MeshBVHUniformStruct,SAH} from 'three-mesh-bvh'
import {ShaderPass} from 'postprocessing'
import {snapshotReferenceScene} from '../../src/diffuseSceneSnapshot.ts'
import {sampleReferenceSurface} from '../../src/diffuseSceneMaterials.ts'
import {surfaceMaterialsById} from '../../src/materials/materialCatalog.ts'
import {createSceneLightingReference} from '../sceneLightingReference.ts'
import {createReferenceGlazing} from './lumenReferenceGlazing.ts'
import {readWorldGrid,worldGridDefinitions} from './lumenWorldGrid.js'
import {exactVisibilityFragment,pairedVisibilityFragment,pairedRadianceFragment} from './lumenVisibilityShaders.js'
import {summarizeVisibility} from './lumenVisibilityStats.js'

const f32=values=>Array.from(Float32Array.from(values))
const fract=x=>x-Math.floor(x)
const minDistance=.0020001,limit=7
const box=new Triangle(),point=new Vector3(),bary=new Vector3()
const rgb=(data,i)=>Array.from(data.slice(i*4,i*4+3))
const add=(a,b)=>a.map((x,i)=>x+b[i])
const sub=(a,b)=>a.map((x,i)=>x-b[i])
const mul=(a,b)=>a.map((x,i)=>x*b[i])
const scale=(a,k)=>a.map(x=>x*k)
const luma=x=>.2126*x[0]+.7152*x[1]+.0722*x[2]

function floorCategory(mesh){
  const role=mesh.userData.houseDesignerRole
  if(role==='ground-plane')return 3
  if(role!=='room-floor-finish')return 0
  const key=mesh.userData.floorSurfaceBatchKey
  if(typeof key!=='string')return 1
  const id=JSON.parse(key)[2],material=surfaceMaterialsById.get(id)
  return /carpet/i.test([id,material?.productName,material?.category].join(' '))?2:1
}

function floatTexture(array,width,height){
  const texture=new DataTexture(array,width,height,RGBAFormat,FloatType)
  texture.needsUpdate=true
  return texture
}

function fixedRays(world,camera,pass){
  const rays=[],tangent=new Vector3(),normal=new Vector3(),bitangent=new Vector3(),direction=new Vector3(),origin=new Vector3()
  const up=new Vector3(0,1,0),right=new Vector3(1,0,0),projected=new Vector3()
  const u=pass.surfaceBounceMaterial.uniforms,feedbackSamples=u.surfaceBounceSamples.value
  if(u.surfaceBouncePattern.value!==0||pass.traceMaterial.uniforms.samplePattern.value!==0)throw Error('Update the paired directions for the active sample pattern')
  function append(receiver,grid,index,j,offset,v,phi,kind,divisor){
    direction.copy(tangent).multiplyScalar(Math.sqrt(v)*Math.cos(phi))
      .addScaledVector(bitangent,Math.sqrt(v)*Math.sin(phi)).addScaledVector(normal,Math.sqrt(1-v))
    origin.fromArray(kind==='feedback'?receiver.patch:receiver.position).addScaledVector(normal,offset)
    rays.push({grid,index,j,kind,normalOffset:offset,receiver:receiver.id,requestedPoint:receiver.position,
      launchNormal:normal.toArray(),start:f32(origin.toArray()),direction:f32(direction.toArray()),limit,minDistance,
      rho:receiver.albedo,divisor})
  }
  for(const grid of world.grids){
    for(const [index,receiver] of grid.points.entries()){
      if(receiver.missing)continue
      normal.fromArray(receiver.normal)
      if(normal.dot(point.fromArray(grid.normal))<0)normal.negate()
      tangent.crossVectors(Math.abs(normal.y)<.85?up:right,normal).normalize()
      bitangent.crossVectors(normal,tangent)
      for(let j=0;j<feedbackSamples;j++)append(receiver,grid.name,index,j,.006,(j+.5)/feedbackSamples,Math.PI*2*fract((j+.5)*.61803399+.31),'feedback',feedbackSamples)
      // Match the runtime strata at these projected positions and a fixed
      // temporal sequence. This sweep measures the scene fallback only.
      projected.fromArray(receiver.position).project(camera)
      if(projected.toArray().some(v=>Math.abs(v)>=1))continue
      const x=Math.floor((projected.x+1)*.5*pass.bounce.width)
      const y=Math.floor((projected.y+1)*.5*pass.bounce.height)
      const count=pass.traceMaterial.uniforms.bounceRays.value,sequence=6
      for(let j=0;j<count;j++){
        const k=9*j+x%3+3*(y%3)
        append(receiver,grid.name,index,j,.004,fract((k+.5)/(count*9)+sequence*.754877666),
          Math.PI*2*fract(.381966*k+.19+sequence*.569840296),'viewport',count)
      }
    }
  }
  return rays
}

function roomGrids(s,bvh){
  const grids=worldGridDefinitions()
  const junction={name:'ceiling-junction',width:42,height:4,step:.05,normal:[0,-1,0],points:[]}
  for(let i=0;i<junction.width*junction.height;i++)junction.points.push([
    -.90+Math.floor(i/junction.width)*.05,2.38,1.10+(i%junction.width)*.10,
  ])
  grids.push(junction)
  const reveal={name:'patio-jamb',width:1,height:39,step:.05,normal:[1,0,0],points:[]}
  const {camera}=s,ray=new Ray(),direction=new Vector3()
  for(let row=0;row<reveal.height;row++){
    const y=230+row*12,x=1127-row*.24
    direction.set(x/1585*2-1,1-y/934*2,.5).unproject(camera).sub(camera.position).normalize()
    const hit=bvh.raycastFirst(ray.set(camera.position,direction),DoubleSide)
    reveal.points.push(hit&&Math.abs(hit.face.normal.x)>.85?hit.point.toArray():[1e4,0,0])
  }
  return [...grids,reveal]
}

function cachedSurface(u,data,id,position,t){
  const p=u.surfacePoint.value.image.data,n=u.surfaceNormal.value.image.data,a=u.surfaceAlbedo.value.image.data
  const source=u.supportLo.value.image.data[id*4+3]+256*u.supportHi.value.image.data[id*4+3]
  return {id,distance:t,position,source,mesh:data.sourceNames[source],material:p[id*4+3],normal:rgb(n,id),
    shadingNormal:rgb(n,id),albedo:rgb(a,id),category:n[id*4+3]}
}

function triangleSurface(data,id,position,t){
  box.a.fromArray(data.positions,id*9)
  box.b.fromArray(data.positions,id*9+3)
  box.c.fromArray(data.positions,id*9+6)
  box.getBarycoord(point.fromArray(position),bary)
  const uv=data.uvs,i=id*6
  const u=uv[i]*bary.x+uv[i+2]*bary.y+uv[i+4]*bary.z,v=uv[i+1]*bary.x+uv[i+3]*bary.y+uv[i+5]*bary.z
  const source=data.sourceIds[id],normal=box.getNormal(point).toArray()
  return {id,distance:t,position,source,mesh:data.sourceNames[source],material:data.materialIndices[id],
    normal,shadingNormal:normal,albedo:sampleReferenceSurface(data,id,u,v,bary).rho,category:data.sourceCategories[id]}
}

function readTerms(u,ray,albedo,arrays,id){
  const [initial,first,later]=arrays
  const daylight=mul(albedo,add(scale(u.skyBase.value.toArray(),initial[id*4+3]),scale(u.groundRadiance.value.toArray(),first[id*4+3])))
  const exteriorGround=scale(mul(albedo,mul(u.skyBase.value.toArray(),u.groundDiffuse.value.toArray())),later[id*4+3])
  const primary=rgb(initial,id),firstBounce=rgb(first,id),laterBounce=rgb(later,id),weight=scale(ray.rho,1/ray.divisor)
  return {directSky:daylight,exteriorGround,directSun:sub(sub(primary,daylight),exteriorGround),firstBounce,laterBounce,
    sourceInitial:primary,sourceSettled:add(add(primary,firstBounce),laterBounce),
    contributionInitial:mul(primary,weight),contributionSettled:mul(add(add(primary,firstBounce),laterBounce),weight)}
}

function independentSources(s,data,rows){
  const glass=createReferenceGlazing(s.scene,s.camera),ref=createSceneLightingReference(data,glass.transmit)
  try{
    const cases=rows.filter(r=>r.exact && r.exact.cache<0)
      .sort((a,b)=>luma(b.patch?.radiance.contributionInitial??[0,0,0])-luma(a.patch?.radiance.contributionInitial??[0,0,0]))
    const byMesh=new Map(),chosen=[]
    for(const row of cases){
      const key=row.exact.source,used=byMesh.get(key)??0
      if(used>=2)continue
      byMesh.set(key,used+1)
      chosen.push(row)
      if(chosen.length>=20)break
    }
    return chosen.map(row=>{
      const {exact}=row,name=exact.mesh??String(exact.source)
      const n=exact.normal.reduce((sum,x,i)=>sum+x*row.direction[i],0)>0?scale(exact.normal,-1):exact.normal
      const sample=ref.evaluate({name,position:exact.position,normal:n,geometricNormal:n},256,4,18331,5,false,true)
      const radiance=mul(scale(exact.albedo,1/Math.PI),add(add(sample.direct,sample.sky),sample.reflected))
      return {row:row.row,id:exact.id,name,position:exact.position,n,radiance,
        weightedContribution:mul(radiance,scale(row.rho,1/row.divisor)),
        samples:sample.samples,contributionsByOrder:sample.byOrder,skyStandardError:sample.skyStandardError,reflectedStandardError:sample.reflectedStandardError}
    })
  }finally{glass.dispose();ref.dispose()}
}

export async function prepareVisibilityProbe(s,audit){
  const renderer=s.gl,gl=renderer.getContext(),pass=audit.lumenPass(),u=pass.traceMaterial.uniforms
  const snapshot=await snapshotReferenceScene(s,floorCategory,{imageReader:pass.imageReader,diffusePbr:true,textureLimit:64,
    interactive:{textureCache:new WeakMap(),visitMesh(){}}})
  const {data}=snapshot,geometry=new BufferGeometry(),start=performance.now()
  geometry.setAttribute('position',new BufferAttribute(data.positions,3))
  const bvh=new MeshBVH(geometry,{indirect:true,strategy:SAH,targetLeafSize:4})
  const bvhUniform=new MeshBVHUniformStruct()
  bvhUniform.updateFrom(bvh)
  // The BVH consumes only XYZ. Reuse two vertex alpha channels per
  // non-index-shared triangle for material identity on WebGL's 16 units.
  const positionPixels=bvhUniform.position.image.data
  for(let i=0;i<snapshot.triangles;i++){
    positionPixels[i*12+3]=data.sourceIds[i]
    positionPixels[i*12+7]=data.materialIndices[i]
  }
  const uniforms={auditBVH:{value:bvhUniform},auditMeasureRoutes:{value:false}}
  const bvhTextureBytes=[bvhUniform.index,bvhUniform.position,bvhUniform.bvhBounds,bvhUniform.bvhContents]
    .reduce((sum,t)=>sum+t.image.data.byteLength,0)
  const metadata={triangles:snapshot.triangles,sourceCount:data.sourceNames.length,materials:snapshot.materials,
    snapshotMs:snapshot.snapshotMs,bvhAndPackingMs:performance.now()-start,bvhTextureBytes,glazing:'Excluded from opaque hits in both variants. The independent source check uses pane transmission.',
    visibility:'Double-sided original triangles, t > 2 mm from the common offset origin; 7 m finite segment. Production patch support and grazing tests remain unchanged.',
    mapping:'Same source and material, <=16 mm plane difference, normal dot magnitude >=.95, <=8 mm support padding, seven neighboring cells.'}
  const diagnosticMaterial=(base,name,fragment,extra={})=>new ShaderMaterial({
    name,glslVersion:base.glslVersion,depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:base.vertexShader,fragmentShader:fragment,uniforms:{...base.uniforms,...uniforms,...extra}})
  const view=diagnosticMaterial(pass.traceMaterial,'AuditExactView',exactVisibilityFragment(pass.traceMaterial.fragmentShader,true))
  const feedback=diagnosticMaterial(pass.surfaceBounceMaterial,'AuditExactSurface',exactVisibilityFragment(pass.surfaceBounceMaterial.fragmentShader,false),{
    previousFront:{value:null},previousBack:{value:null},surfaceBounceOrder:{value:0}})
  const targets=[]
  const original={front:u.surfaceBounceFront.value,back:u.surfaceBounceBack.value}
  const frame=async()=>{
    s.scene.userData.displayEffectRevision++
    s.invalidate()
    await new Promise(requestAnimationFrame)
  }
  const read=async(target,attachment,dimensions=[target.width,target.height])=>{
    const array=new Float32Array(dimensions[0]*dimensions[1]*4)
    await renderer.readRenderTargetPixelsAsync(target,0,0,...dimensions,array,undefined,attachment)
    return array
  }
  const checkGL=stage=>{const error=gl.getError();if(error)throw Error(`${stage} WebGL error ${error}`)}

  async function runPairs(){
    const world=await readWorldGrid(renderer,pass,roomGrids(s,bvh)),rays=fixedRays(world,s.camera,pass)
    const width=512,height=Math.ceil(rays.length/width)
    const origins=new Float32Array(width*height*4),directions=new Float32Array(origins.length)
    for(const [i,ray] of rays.entries()){
      origins.set([...ray.start,ray.limit],i*4)
      directions.set([...ray.direction,Number(ray.kind==='viewport')],i*4)
    }
    const ot=floatTexture(origins,width,height),dt=floatTexture(directions,width,height)
    const shared={auditRaysOrigin:{value:ot},auditRaysDirection:{value:dt}}
    const shaders=pass.traceMaterial.fragmentShader,old=renderer.getRenderTarget(),mode=s.frameloop
    async function draw(name,shader,samplers,count){
      const material=diagnosticMaterial(pass.traceMaterial,name,shader,{...shared,...samplers})
      const target=new WebGLRenderTarget(width,height,{count,type:FloatType,depthBuffer:false}),quad=new ShaderPass(material)
      try{
        renderer.setRenderTarget(target)
        await renderer.compileAsync(quad.scene,quad.camera)
        quad.render(renderer,audit.composer.inputBuffer,target)
        checkGL(name+' draw')
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error(name+' framebuffer incomplete')
        const arrays=await Promise.all(target.textures.map((_,i)=>read(target,i)))
        checkGL(name+' read')
        return arrays
      }finally{renderer.setRenderTarget(old);target.dispose();quad.dispose()}
    }
    let a,b,radiance,ht
    try{
      s.setFrameloop('never')
      const intersections=await draw('AuditVisibilityPairs',pairedVisibilityFragment(shaders),{},2)
      a=intersections[0]
      b=intersections[1]
      const hits=new Float32Array(a.length)
      for(let i=0;i<hits.length;i+=4){hits[i]=a[i+1];hits[i+1]=b[i+3];hits[i+2]=b[i]}
      ht=floatTexture(hits,width,height)
      radiance=await draw('AuditRadiancePairs',pairedRadianceFragment(shaders),{
        auditHits:{value:ht},auditFirstFront:{value:pass.surfaceBounceAtlases[0].texture},auditFirstBack:{value:pass.surfaceBounceAtlases[0].textures[1]},
      },6)
    }finally{
      ot.dispose()
      dt.dispose()
      ht?.dispose()
      s.setFrameloop(mode)
    }
    const [initialA,initialB,firstA,firstB,laterA,laterB]=radiance
    const cpuRay=new Ray(),cpuStart=new Vector3(),cpuDirection=new Vector3()
    for(const grid of world.grids){
      for(const sample of grid.points){
        if(sample.missing)continue
        cpuDirection.fromArray(sample.position).sub(s.camera.position)
        const distance=cpuDirection.length()
        const earlier=bvh.raycastFirst(cpuRay.set(s.camera.position,cpuDirection.normalize()),DoubleSide,0,distance-.02)
        sample.visible=!earlier
      }
    }
    const validation={count:0,missMismatch:0,maxDistanceError:0}
    const rows=rays.map((ray,i)=>{
      const k=i*4,patchId=a[k+1],triangle=b[k+1],mapped=b[k+3]
      const position=t=>ray.start.map((v,j)=>v+t*ray.direction[j])
      const patch=patchId<0?null:cachedSurface(u,data,patchId,position(a[k]),a[k])
      const exact=triangle<0?null:triangleSurface(data,triangle,position(b[k]),b[k])
      if(i%31===0){
        cpuDirection.fromArray(ray.direction)
        cpuStart.fromArray(ray.start).addScaledVector(cpuDirection,minDistance)
        const cpu=bvh.raycastFirst(cpuRay.set(cpuStart,cpuDirection),DoubleSide,0,limit-minDistance)
        validation.count++
        if(Boolean(cpu)!==Boolean(exact))validation.missMismatch++
        if(cpu&&exact)validation.maxDistanceError=Math.max(validation.maxDistanceError,Math.abs(cpu.distance+minDistance-exact.distance))
      }
      if(patch)patch.radiance=readTerms(u,ray,patch.albedo,[initialA,firstA,laterA],i)
      if(exact){
        exact.cache=mapped
        exact.radiance=mapped<0?null:readTerms(u,ray,rgb(u.surfaceAlbedo.value.image.data,mapped),[initialB,firstB,laterB],i)
      }
      let route=a[k+3]
      if(!patch&&!exact&&route!==1){
        cpuDirection.fromArray(ray.direction)
        cpuStart.fromArray(ray.start)
        const beyond=bvh.raycastFirst(cpuRay.set(cpuStart,cpuDirection),DoubleSide,limit,80)
        route=beyond?4:ray.direction[1]>0?2:5
      }
      return {...ray,row:i,patch,exact,route}
    })
    if(validation.missMismatch||validation.maxDistanceError>.003)
      throw Error('GPU/CPU reference traversal disagreement '+JSON.stringify(validation))
    const summary=summarizeVisibility(world,rows)
    return {rows,world:summary.world,summary:{...summary.totals,validation},independentUnmapped:independentSources(s,data,rows)}
  }

  async function activate(){
    const old=renderer.getRenderTarget(),mode=s.frameloop
    const routeTarget=new WebGLRenderTarget(pass.bounce.width,pass.bounce.height,{count:2,type:FloatType,depthBuffer:false})
    const routePass=new ShaderPass(view)
    const savedSequence=u.sequence.value
    let result
    try{
      s.setFrameloop('never')
      u.sequence.value=6
      uniforms.auditMeasureRoutes.value=true
      renderer.setRenderTarget(routeTarget)
      await renderer.compileAsync(routePass.scene,routePass.camera)
      routePass.render(renderer,audit.composer.inputBuffer,routeTarget)
      checkGL('Exact view shader warmup')
      const values=await read(routeTarget,0),guides=await read(routeTarget,1)
      let screen=0,mapped=0,unmapped=0,affectedPixels=0,receivers=0
      for(let i=0;i<values.length;i+=4){
        if(guides[i+3]===-1)continue
        receivers++
        screen+=values[i]
        mapped+=values[i+1]
        unmapped+=values[i+2]
        if(values[i+2]>0)affectedPixels++
      }
      result={sequence:6,screen,mapped,unmapped,affectedPixels,receivers,rays:receivers*u.bounceRays.value}
    }finally{
      uniforms.auditMeasureRoutes.value=false
      u.sequence.value=savedSequence
      renderer.setRenderTarget(old)
      routeTarget.dispose()
      s.setFrameloop(mode)
    }
    pass.trace.fullscreenMaterial=view
    pass.resetHistory()
    for(let i=0;i<18;i++)await frame()
    return result
  }

  async function activateFeedback(){
    const mode=s.frameloop,old=renderer.getRenderTarget(),quad=new ShaderPass(feedback),f=feedback.uniforms
    const began=performance.now(),durations=[]
    try{
      s.setFrameloop('never')
      for(const [order,source] of pass.surfaceBounceAtlases.entries()){
        const target=source.clone(),at=performance.now()
        targets.push(target)
        renderer.setRenderTarget(target)
        if(order===0)await renderer.compileAsync(quad.scene,quad.camera)
        f.surfaceBounceOrder.value=order
        f.previousFront.value=order?targets[0].texture:source.texture
        f.previousBack.value=order?targets[0].textures[1]:source.textures[1]
        target.scissorTest=true
        for(let row=0;row<target.height;row+=8){
          target.scissor.set(0,row,target.width,Math.min(8,target.height-row))
          quad.render(renderer,audit.composer.inputBuffer,target)
          if(row%32===0)await new Promise(requestAnimationFrame)
        }
        target.scissorTest=false
        checkGL('Exact feedback')
        const one=new Uint16Array(4)
        await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,one)
        durations.push(performance.now()-at)
      }
    }finally{renderer.setRenderTarget(old);quad.dispose();s.setFrameloop(mode)}
    u.surfaceBounceFront.value=targets[1].texture
    u.surfaceBounceBack.value=targets[1].textures[1]
    pass.resetHistory()
    for(let i=0;i<18;i++)await frame()
    return {durations,elapsed:performance.now()-began,targets:targets.map(t=>[t.width,t.height]),atlasBytes:targets.reduce((sum,t)=>sum+t.width*t.height*16,0)}
  }

  async function restore(){
    pass.trace.fullscreenMaterial=pass.traceMaterial
    u.surfaceBounceFront.value=original.front
    u.surfaceBounceBack.value=original.back
    targets.forEach(t=>t.dispose())
    view.dispose()
    feedback.dispose()
    bvhUniform.dispose()
    geometry.dispose()
    pass.resetHistory()
    for(let i=0;i<18;i++)await frame()
  }
  return {metadata,runPairs,activate,activateFeedback,restore}
}
