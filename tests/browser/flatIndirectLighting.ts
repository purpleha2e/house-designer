import {DataUtils,HalfFloatType,Matrix3,Matrix4,Mesh,Raycaster,Vector2,Vector3,WebGLRenderTarget} from 'three'
import {getEditorState} from './rendererTestModules'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {inspectIndirectPoint} from '../../src/indirectLightingDiagnostic'
import {createIndirectVisibility} from '../../src/indirectVisibility'
import {createSceneLightingReference} from '../sceneLightingReference'
import {lightingDiagnosticValue,type LightingDiagnosticMode} from '../../src/lightingDiagnostics'
import {isSelectionDecoration} from '../../src/shaderWarmup'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../../src/indirectSH'
import {createIndirectSurfaceCache} from '../../src/indirectSurfaceCache'
import {indirectSurfaceSun} from '../../src/indirectSurfaceRelighting'

// Six fixed receivers in the existing 5 x 4 m daylight fixture. All coordinates
// are actual surfaces; the production inspector applies its normal bias.
export const flatIndirectReceivers = [
  {name:'ceiling above sunlit floor',position:[2.5,2.795,2.3],normal:[0,-1,0],albedo:.8},
  {name:'upper-right ceiling corner',position:[4.7,2.795,3.7],normal:[0,-1,0],albedo:.8},
  {name:'upper-right wall',position:[4.995,2.5,3.7],normal:[-1,0,0],albedo:.8},
  {name:'lower wall near sunlit floor',position:[4.995,.35,2.3],normal:[-1,0,0],albedo:.8},
  {name:'sunlit floor',position:[3,.005,2.3],normal:[0,1,0],albedo:.35},
  {name:'shadowed floor',position:[4,.005,2.3],normal:[0,1,0],albedo:.35},
]

export async function measureFlatIndirectLighting(){
  const s=getEditorState()!,field=s.scene.userData.getLightingField()
  const diagnostic=Reflect.get(window,'houseDesignerLighting').snapshot()
  const visibility=createIndirectVisibility(s.scene)
  const snapshot=await snapshotReferenceScene(s)
  const reference=createSceneLightingReference(snapshot.data)
  try{
    const points=flatIndirectReceivers.map((r,i)=>{
      const inspection=inspectIndirectPoint(field,visibility,new Vector3().fromArray(r.position),new Vector3().fromArray(r.normal),[],diagnostic.direct)
      const receiver={...r,geometricNormal:r.normal}
      const first=reference.evaluate(receiver,32768,1,1234+i*1009,1)
      const final=reference.evaluate(receiver,32768,6,1234+i*1009,6)
      return {...r,inspection,reference:{first,final},diffuseRadiance:inspection.displayed.rgb.map(v=>v*r.albedo/Math.PI)}
    })
    const directions:number[][]=[],weights:number[]=[]
    for(let face=0;face<6;face++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const col=-1+(x+.5)*2/16,row=1-(y+.5)*2/16
      const v=new Vector3().fromArray([[1,row,-col],[-1,row,col],[col,1,-row],[col,-1,row],[col,row,1],[-col,row,-1]][face])
      weights.push(4/v.length()**3);directions.push(v.normalize().toArray())
    }
    const normalization=4*Math.PI/weights.reduce((a,b)=>a+b,0)
    const captureComparison=field.probes.map(p=>{
      const incoming=reference.incoming(p.position.toArray(),directions,0,0)
      const expected=Array.from({length:3},()=>new Array(field.coefficientCount).fill(0))
      directions.forEach((d,i)=>indirectSHRadianceBasis(new Vector3().fromArray(d),field.shOrder).forEach((v,k)=>{
        for(let c=0;c<3;c++)expected[c][k]+=incoming[i].firstPass[c]*weights[i]*normalization*v
      }))
      const actual=diagnostic.direct.map((a:Uint16Array)=>Array.from(a.slice(p.index*field.coefficientCount,(p.index+1)*field.coefficientCount),v=>DataUtils.fromHalfFloat(v)))
      const basis=indirectSHIrradianceBasis(new Vector3(0,-1,0),field.shOrder)
      const down=(coefficients:number[][])=>coefficients.map(a=>Math.max(0,a.reduce((sum,v,k)=>sum+v*basis[k],0)))
      return {index:p.index,position:p.position.toArray(),actual,expected,actualDown:down(actual),expectedDown:down(expected)}
    })
    return {points,captureComparison,probes:field.probes.map(p=>({index:p.index,position:p.position.toArray(),kind:p.kind})),spacing:field.spacing,
      status:{...s.scene.userData.indirectLighting},performance:s.scene.userData.getLightingPerformance(),
      controls:{exposure:s.gl.toneMappingExposure,toneMapping:s.gl.toneMapping,fill:s.scene.userData.getIndirectUniforms().hdGIIndoorFill.value},glError:s.gl.getContext().getError()}
  }finally{visibility.dispose();reference.dispose()}
}

export function measureSpringfieldLanding(){
  const s=getEditorState()!,snapshot=s.scene.userData.lightingDiagnostics.snapshot(),field=snapshot.display??snapshot.field
  const visibility=createIndirectVisibility(s.scene),ray=new Raycaster(),matrix=new Matrix4()
  const locations=[['ceiling above sunlit carpet',.50,.12],['upper-right ceiling corner',.70,.25],
    ['upper-right wall',.91,.38],['lower wall near carpet',.12,.80],['sunlit carpet',.38,.95],['shadowed carpet',.52,.95]] as const
  try{
    const points=locations.map(([name,x,y])=>{
      ray.setFromCamera(new Vector2(x*2-1,1-y*2),s.camera)
      const hit=ray.intersectObjects(s.scene.children,true).find(h=>{
        if(!(h.object instanceof Mesh)||isSelectionDecoration(h.object))return false
        for(let parent:import('three').Object3D|null=h.object;parent;parent=parent.parent)if(!parent.visible)return false
        const material=Array.isArray(h.object.material)?h.object.material[h.face?.materialIndex??0]:h.object.material
        return material.visible&&(!material.transparent||material.opacity>.99)
      })
      if(!hit?.face)throw Error('No opaque receiver: '+name)
      matrix.copy(hit.object.matrixWorld)
      if('isInstancedMesh' in hit.object&&hit.instanceId!==undefined){const instance=new Matrix4();(hit.object as import('three').InstancedMesh).getMatrixAt(hit.instanceId,instance);matrix.multiply(instance)}
      const normal=hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(matrix)).normalize()
      if(normal.dot(ray.ray.direction)>0)normal.negate()
      return {name,pixel:{x:Math.floor(x*s.gl.domElement.width),y:Math.floor(y*s.gl.domElement.height)},object:hit.object.name,role:hit.object.userData.houseDesignerRole,
        inspection:inspectIndirectPoint(field,visibility,hit.point,normal,[],snapshot.direct)}
    })
    Reflect.set(window,'landingMeasurements',points)
    return {points,shOrder:field.shOrder,spacing:field.spacing,probeCount:field.probes.length,controls:{exposure:s.gl.toneMappingExposure,toneMapping:s.gl.toneMapping},performance:s.scene.userData.getLightingPerformance()}
  }finally{visibility.dispose()}
}

/** Read the production shader's linear material output at the inspected pixels.
 * This is test-only; display mode changes themselves use the existing uniform. */
export async function captureLandingMaterial(mode:LightingDiagnosticMode,probeStrength=1,fill?:number){
  const s=getEditorState()!,gl=s.gl,u=s.scene.userData.getIndirectUniforms(),previous=gl.getRenderTarget()
  const original=[u.hdLightingDiagnostic.value,u.hdGIProbeStrength.value,u.hdGIIndoorFill.value]
  const target=new WebGLRenderTarget(gl.domElement.width,gl.domElement.height,{type:HalfFloatType})
  try{
    u.hdLightingDiagnostic.value=lightingDiagnosticValue(mode);u.hdGIProbeStrength.value=probeStrength
    if(fill!==undefined)u.hdGIIndoorFill.value=fill
    gl.setRenderTarget(target);gl.render(s.scene,s.camera)
    const pixels=new Uint16Array(target.width*target.height*4)
    await gl.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels)
    const points=Reflect.get(window,'landingMeasurements') as {name:string;pixel:{x:number;y:number}}[]
    return points.map(p=>({name:p.name,rgb:[0,1,2].map(c=>DataUtils.fromHalfFloat(pixels[((target.height-1-p.pixel.y)*target.width+p.pixel.x)*4+c]))}))
  }finally{
    [u.hdLightingDiagnostic.value,u.hdGIProbeStrength.value,u.hdGIIndoorFill.value]=original
    gl.setRenderTarget(previous);target.dispose();s.invalidate()
  }
}

export async function referenceSpringfieldLanding(){
  const s=getEditorState()!,snapshot=Reflect.get(window,'landingReferenceSnapshot')??await snapshotReferenceScene(s)
  Reflect.set(window,'landingReferenceSnapshot',snapshot)
  const measured=Reflect.get(window,'landingMeasurements') as {name:string;inspection:ReturnType<typeof inspectIndirectPoint>}[]
  const points=measured.map(p=>({name:p.name,position:p.inspection.point,normal:p.inspection.normal,geometricNormal:p.inspection.normal}))
  const run=(solar:boolean,maxEncounters=6)=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./lightingCorrectnessReference.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();e.data.ok?resolve({...e.data,snapshot:{triangles:snapshot.triangles,textures:snapshot.textures},lighting:{sun:snapshot.data.sunIrradiance,sky:snapshot.data.skyBase,lights:snapshot.data.lights.length}}):reject(Error(e.data.error))}
    worker.onerror=e=>{worker.terminate();reject(Error(e.message))}
    worker.postMessage({scene:solar?{...snapshot.data,lights:[],skyBase:[0,0,0],skySun:[0,0,0]}:snapshot.data,points,samples:8192,maxEncounters})
  })
  return {full:await run(false),solar:await run(true),solarFirst:await run(true,1)}
}

export async function measureLandingSolarCapture(){
  const s=getEditorState()!,field=s.scene.userData.getLightingField(),original=s.scene.userData.getIndirectSurfaceCache(),u=s.scene.userData.getIndirectUniforms()
  const measured=Reflect.get(window,'landingMeasurements') as {inspection:ReturnType<typeof inspectIndirectPoint>}[]
  const indices=[...new Set(measured.flatMap(p=>p.inspection.probes.filter(q=>q.visibleAtSurface).map(q=>q.index)))]
  const copy=createIndirectSurfaceCache(s.gl,[...original.layout.slots.keys()],original.layout.size,u,true,original.captureNear)!
  const sun=indirectSurfaceSun(s.scene)
  try{
    const retained=await copy.retainFrom(original,indices,()=>false)
    if(retained!==indices.length)throw Error('Incomplete retained solar comparison cache')
    copy.hydrateRetained();await copy.compile()
    const coefficients=field.coefficients.map((a:Uint16Array)=>new Uint16Array(a.length))
    for(const index of indices){
      const p=Array.from(field.positionData.slice(index*4,index*4+3)) as number[]
      const on=await copy.relight(index,p,[],sun,1),off=await copy.relight(index,p,[],undefined,1)
      for(let k=0;k<field.coefficientCount;k++)for(let c=0;c<3;c++)coefficients[c][index*field.coefficientCount+k]=DataUtils.toHalfFloat(on.coefficients[k].getComponent(c)-off.coefficients[k].getComponent(c))
    }
    const visibility=createIndirectVisibility(s.scene)
    try{return measured.map(p=>inspectIndirectPoint({...field,coefficients},visibility,new Vector3().fromArray(p.inspection.point),new Vector3().fromArray(p.inspection.normal),[]).exactAtSurface)}
    finally{visibility.dispose()}
  }finally{copy.dispose()}
}

/** Production frame loop, with a fixed small camera path and no lighting edits. */
export async function measureLightingInteraction(durationMs=6000){
 const s=getEditorState()!,position=s.camera.position.clone(),quaternion=s.camera.quaternion.clone()
 const state=()=>({generation:s.scene.userData.indirectLighting.generation,faces:s.scene.userData.indirectLighting.capturedFaces,programs:s.gl.info.programs?.length})
 const before=state(),started=performance.now(),intervals:number[]=[]
 let last=started,frames=0
 const root=Reflect.get(s.scene,'__r3f').root
 const unsubscribe=s.internal.subscribe({current:()=>{
  const now=performance.now();intervals.push(now-last);last=now;frames++
  s.camera.position.copy(position);s.camera.position.x+=Math.sin((now-started)/1000)*.1;s.camera.updateMatrixWorld()
 }},-100,root)
 try{await new Promise(resolve=>setTimeout(resolve,durationMs))}
 finally{unsubscribe();s.camera.position.copy(position);s.camera.quaternion.copy(quaternion);s.camera.updateMatrixWorld();s.invalidate()}
 const elapsed=performance.now()-started,after=state(),sorted=intervals.sort((a,b)=>a-b)
 return {before,after,frames,durationMs:elapsed,fps:frames*1000/elapsed,medianFrameMs:sorted[Math.floor(sorted.length*.5)],p95FrameMs:sorted[Math.floor(sorted.length*.95)]}
}
