import {DataUtils,DirectionalLight,FloatType,Mesh,MeshStandardMaterial,OrthographicCamera,Raycaster,Scene,Vector3,WebGLRenderTarget} from 'three'
import {giL2HousePoints} from './giL2HouseView'
import {sampleSpatialReceiversGPU} from './giSpatialReceiverGPU.ts'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {serializeIndirectField} from '../../src/indirectLighting'
import {includeViewportObject} from '../../src/viewportSurfaceVisibility'

export function installBedroomTrace(s:any){
 let atlas:any,lastSun:any,passes:any[]=[],status=s.scene.userData.indirectLighting
 const render=s.gl.render
 s.gl.render=function(scene:any,camera:any){
  const u=scene.children.find((o:any)=>o.material?.uniforms?.hdSurfaceResponses||o.material?.uniforms?.hdSunColor)?.material.uniforms
  if(u?.hdSurfaceResponses)atlas=s.gl.getRenderTarget()
  if(u?.hdSunColor)lastSun={rgb:u.hdSunColor.value.toArray(),direction:u.hdSunDirection.value.toArray()}
  return render.call(this,scene,camera)
 }
 const wrap=(value:any)=>value&&new Proxy(value,{set(target,key,value){Reflect.set(target,key,value);if(key==='fullPassPublications'&&Number(value)>0){const f=s.scene.userData.getLightingField?.();if(f?.probes.length)passes.push({pass:Number(value),at:performance.now(),order:f.shOrder,coefficients:f.probes.map((p:any)=>({index:p.index,position:p.position.toArray(),rgb:f.coefficients.map((c:Uint16Array)=>Array.from(c.subarray(p.index*f.coefficientCount,(p.index+1)*f.coefficientCount),DataUtils.fromHalfFloat))}))})}return true}})
 status=wrap(status);Object.defineProperty(s.scene.userData,'indirectLighting',{configurable:true,get:()=>status,set:value=>{status=wrap(value)}})
 return{reset(){passes=[];lastSun=undefined},state(){return{passes,lastSun}},atlas:()=>atlas}
}

/** Read the real material's GI expression and textured diffuse albedo at each
 * receiver. Geometry attributes, normal maps and receiver corrections remain. */
async function materialReceivers(s:any,points:any[]){
 const ray=new Raycaster(),meshes:Mesh[]=[];s.scene.updateMatrixWorld(true)
 s.scene.traverse((o:any)=>{if(o instanceof Mesh&&includeViewportObject(o))meshes.push(o)})
 const scene=new Scene(),camera=new OrthographicCamera(-.00002,.00002,.00002,-.00002,.00001,.03),target=new WebGLRenderTarget(1,1,{type:FloatType,depthBuffer:true})
 const previous=s.gl.getRenderTarget(),auto=s.gl.autoClear,result=[]
 try{for(const p of points){
  const n=new Vector3().fromArray(p.normal),position=new Vector3().fromArray(p.position),origin=position.clone().addScaledVector(n,.005)
  ray.set(origin,n.clone().negate());ray.far=.01
  const hit=ray.intersectObjects(meshes,false).find(h=>{const m=(Array.isArray((h.object as Mesh).material)?((h.object as Mesh).material as MeshStandardMaterial[])[h.face?.materialIndex??0]:(h.object as Mesh).material)as MeshStandardMaterial;return m instanceof MeshStandardMaterial&&m.visible&&m.opacity>.5&&!/glass|glazing/i.test(m.name)})
  if(!hit)throw Error('Missing material at '+p.name)
  const source=hit.object as Mesh,original=(Array.isArray(source.material)?source.material[hit.face?.materialIndex??0]:source.material) as MeshStandardMaterial,material=original.clone(),mode={value:0},hook=original.onBeforeCompile
  material.onBeforeCompile=(shader,renderer)=>{
   hook.call(original,shader,renderer);shader.uniforms.bedroomAuditMode=mode
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float bedroomAuditMode;vec3 bedroomAuditGI=vec3(0.);')
    .replace('#include <lights_fragment_end>','bedroomAuditGI=irradiance-vec3(hdGIIndoorFill);\n#include <lights_fragment_end>')
    .replace('#include <opaque_fragment>','outgoingLight=bedroomAuditMode<.5?bedroomAuditGI:diffuseColor.rgb*(1.0-metalnessFactor);\n#include <opaque_fragment>')
    .replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','')
  }
  material.customProgramCacheKey=()=>original.customProgramCacheKey()+':bedroom-irradiance-v1';material.toneMapped=false
  const mesh=source.clone(false);mesh.material=Array.isArray(source.material)?source.material.map(()=>material):material;mesh.matrixAutoUpdate=false;mesh.matrix.copy(source.matrixWorld);mesh.matrixWorld.copy(source.matrixWorld);mesh.visible=true;mesh.frustumCulled=false;scene.add(mesh)
  camera.position.copy(origin);camera.up.set(Math.abs(n.y)>.9?1:0,Math.abs(n.y)>.9?0:1,0);camera.lookAt(position);camera.updateMatrixWorld(true)
  const read=async(value:number)=>{mode.value=value;s.gl.setRenderTarget(target);s.gl.autoClear=true;s.gl.clear();s.gl.render(scene,camera);const a=new Float32Array(4);await s.gl.readRenderTargetPixelsAsync(target,0,0,1,1,a);if(a[3]<.5)throw Error('Empty material sample '+p.name);return Array.from(a.slice(0,3))}
  try{const irradiance=await read(0),albedo=await read(1);result.push({name:p.name,irradiance,albedo,material:original.name,linearBaseColor:original.color.toArray(),metalness:original.metalness,roughness:original.roughness,map:original.map?.name??null,normalMap:!!original.normalMap})}
  finally{scene.remove(mesh);material.dispose()}
 }}finally{s.gl.setRenderTarget(previous);s.gl.autoClear=auto;target.dispose()}
 return result
}

export async function measureBedroom(s:any){
 const field=s.scene.userData.getLightingField(),u=s.scene.userData.getIndirectUniforms(),points=giL2HousePoints(s).points as any[],sun:DirectionalLight[]=[]
 s.scene.traverse((o:any)=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')sun.push(o)})
 const source=sun[0],direction=new Vector3().subVectors(source.position,source.target.position).normalize(),receivers=points.map(p=>({name:p.name,position:p.position,normal:p.normal,geometricNormal:p.normal}))
 const canonical=await sampleSpatialReceiversGPU(s,receivers),restore=s.scene.userData.bindSoftFloorGI?.()
 let filtered:any,materials:any
 try{filtered=await sampleSpatialReceiversGPU(s,receivers);materials=await materialReceivers(s,points)}finally{restore?.()}
 return{points,canonicalGPU:canonical,filteredGPU:filtered,materialGPU:materials,order:field.shOrder,probeCount:field.probes.length,filter:s.scene.userData.softFloorGI,
  calibration:{sunIntensity:source.intensity,sunColor:source.color.toArray(),sunDirection:direction.toArray(),sunIrradiance:source.color.toArray().map(c=>c*source.intensity),skyDisplay:u.hdSkyDisplayRadianceBase.value.toArray(),skyCapture:u.hdSkyRadianceBase.value.toArray(),groundSunDisplay:u.hdSkyDisplaySunIrradiance.value.toArray(),groundSunCapture:u.hdSkySunIrradiance.value.toArray(),fill:u.hdGIIndoorFill.value,exposure:s.gl.toneMappingExposure,rendererToneMapping:s.gl.toneMapping,settings:s.scene.userData.getBakedIndirectLighting()?.settings},
  gi:{...s.scene.userData.indirectLighting},profile:s.scene.userData.getLightingPerformance(),programs:s.gl.info.programs.length}
}

export async function bedroomReference(s:any,trace:any){
 const active=s.internal.active,loop=s.frameloop;s.setFrameloop('never');s.internal.active=false
 try{
 const measured=giL2HousePoints(s),points=measured.points as any[],field=s.scene.userData.getLightingField(),selected=new Map<number,any>()
 for(const p of points){const position=new Vector3().fromArray(p.samplePosition);field.probes.filter((probe:any)=>field.positionData[probe.index*4+3]>.5&&probe.position.distanceToSquared(position)<(field.spacing*1.75)**2).forEach((probe:any)=>selected.set(probe.index,probe))}
 const cache=s.scene.userData.getIndirectSurfaceCache(),size=cache.layout.size,atlas=trace.atlas(),captures:any[]=[]
 if(!atlas||atlas.width!==cache.layout.width)throw Error('Final replay atlas missing')
 for(const probe of selected.values()){
  const samples=[]
  for(let face=0;face<6;face++){
   const [x,y]=cache.layout.tile(probe.index,face),direct=new Uint16Array(size*size*4),final=new Uint16Array(size*size*4)
   await s.gl.readRenderTargetPixelsAsync(cache.currentRadiance,x,y,size,size,direct);await s.gl.readRenderTargetPixelsAsync(atlas,x,y,size,size,final)
   for(let row=0;row<size;row++)for(let col=0;col<size;col++){const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3,offset=(row*size+col)*4;samples.push({direction:d.normalize().toArray(),weight,direct:[0,1,2].map(c=>DataUtils.fromHalfFloat(direct[offset+c])),final:[0,1,2].map(c=>DataUtils.fromHalfFloat(final[offset+c]))})}
  }
  captures.push({index:probe.index,position:probe.position.toArray(),samples,coefficients:field.coefficients.map((c:Uint16Array)=>Array.from(c.subarray(probe.index*4,probe.index*4+4),DataUtils.fromHalfFloat))})
 }
 const geometry=snapshotIndirectGeometry(s.scene),snapshot=await snapshotReferenceScene(s),{data,...metadata}=snapshot
 const result=await new Promise<any>((resolve,reject)=>{const worker=new Worker(new URL('./bedroomDaylight.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress){s.scene.userData.bedroomReferenceProgress=e.data.progress;return}worker.terminate();e.data.ok?resolve(e.data):reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:data,points,captures,field:serializeIndirectField(field),coefficients:field.coefficients,volume:field.volume.data,floorLayer:field.floorLayer.data,geometry},[data.positions.buffer,data.uvs.buffer,data.materialIndices.buffer,...data.textures.map(t=>t.pixels.buffer)])})
 return{...metadata,...result,captures}
 }finally{s.internal.active=active;s.setFrameloop(loop);s.invalidate()}
}
