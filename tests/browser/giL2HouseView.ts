import {Mesh,MeshStandardMaterial,Raycaster,Vector3,Matrix3,Matrix4,InstancedMesh} from 'three'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'
import {usesIndirectFloorLayer} from '../../src/indirectFloorLighting'
import {includeViewportObject} from '../../src/viewportSurfaceVisibility'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
export async function giL2HouseReference(s:any){
 const measured=giL2HousePoints(s),snapshot=await snapshotReferenceScene(s),{data,...metadata}=snapshot
 const points=measured.points.filter(p=>'samplePosition'in p).map(p=>({name:p.name,position:p.samplePosition,normal:p.normal,geometricNormal:p.normal}))
 const result=await new Promise<any>((resolve,reject)=>{const worker=new Worker(new URL('./giL2HouseReference.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{worker.terminate();e.data.ok?resolve(e.data):reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:data,points},[data.positions.buffer,data.uvs.buffer,data.materialIndices.buffer,...data.textures.map(t=>t.pixels.buffer)])})
 return{...metadata,...result,points,convention:'Six source encounters (same as six production passes), reference at the identical biased field sampling positions. Diffuse scene reference excludes display ambient fill, screen-space AO, specular and normal-map detail.'}
}
export function giL2HousePoints(s:any){
 const field=s.scene.userData.getLightingField(),meshes:Mesh[]=[];s.scene.updateMatrixWorld(true)
 s.scene.traverse((o:any)=>{if(o instanceof Mesh&&includeViewportObject(o)&&!o.userData.selectionDecoration&&o.userData.houseDesignerRole!=='ground-image')meshes.push(o)})
 const ray=new Raycaster(),points=[]
 for(const [name,origin,direction,walls] of [
  ['sunlit wall',[.7,4.3,11.8],[-1,0,0],true],['shaded wall',[1,3.8,13.8],[1,0,0],true],
  ['ceiling',[1,4,13],[0,1,0],false],['bed',[.7,4,12.4],[0,-1,0],false],
  ['floor',[2.1,3.5,13.7],[0,-1,0],false],['dark corner',[2.2,3.2,14],[0,0,1],true],
 ] as [string,number[],number[],boolean][]){
  ray.set(new Vector3().fromArray(origin),new Vector3().fromArray(direction));const hit=ray.intersectObjects(walls?meshes.filter(m=>m.userData.houseDesignerRole==='wall-engine-render'):meshes,false).find(h=>{const o=h.object as Mesh,m=(Array.isArray(o.material)?o.material[h.face?.materialIndex??0]:o.material)as MeshStandardMaterial;return m instanceof MeshStandardMaterial&&m.visible&&m.opacity>.5&&!/glass|glazing/i.test(m.name)})
  if(!hit?.face){points.push({name,error:'No opaque surface'});continue}
  const world=hit.object.matrixWorld.clone();if(hit.object instanceof InstancedMesh&&hit.instanceId!==undefined){const instance=new Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);world.multiply(instance)}
  const n=hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(world)).normalize();if(n.dot(ray.ray.direction)>0)n.negate()
  const f=field.floors.findIndex((_:any,i:number)=>hit.point.y+n.y*.08>=field.ranges[i].bottom&&hit.point.y+n.y*.08<field.ranges[i].top)
  if(f<0){points.push({name,error:'Outside GI floor',point:hit.point.toArray()});continue}
  const floor=usesIndirectFloorLayer(field,f,hit.point,n),range=field.ranges[f],bias=floor?.004:.02+(Math.abs(n.x)+Math.abs(n.z))*field.bounds.size/(field.volume.n-1)+Math.abs(n.y)*(range.top-range.bottom)/11
  const p=hit.point.clone().addScaledVector(n,bias)
  points.push({name,position:hit.point.toArray(),normal:n.toArray(),samplePosition:p.toArray(),bias,floor,irradiance:sampleDisplayedIndirect(field,f,p,n).rgb,nearSurfaceIrradiance:sampleDisplayedIndirect(field,f,hit.point.clone().addScaledVector(n,.004),n).rgb,object:hit.object.name})
 }
 return{points,order:field.shOrder,probes:field.probes.length,memory:{volumeBytes:field.volume.data.byteLength,floorBytes:field.floorLayer.data.byteLength,coefficientBytes:field.coefficients.reduce((s:number,a:Uint16Array)=>s+a.byteLength,0)},note:'Geometric-normal field samples with the ordinary receiver bias; no material normal-map or corner-plane correction. Near-surface samples distinguish offset sensitivity. No independent house path reference.'}
}
