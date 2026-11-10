import {DataUtils,Vector3} from 'three'
import type {IndirectField} from '../src/indirectLighting.ts'
import type {IndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {pointIsInsideRoomPolygon} from '../src/roomLightMask.ts'
import {indirectLocalFloorReceiver} from '../src/indirectSpatialInterpolation.ts'

export type SpatialMethod='current'|'nearest'|'same-room'|'portal'|'local-1'|'local-2'|'local-3'|'occluder-local'
export type SpatialReceiver={position:number[];normal:number[];geometricNormal:number[];floor?:number}
/** Diagnostic only. All methods share the exact same geometric visibility,
 * support radius, positions and coefficients. Room labels never replace rays. */
export function spatialInfluences(field:IndirectField,visibility:IndirectVisibility,receiver:SpatialReceiver,method:SpatialMethod,partitionX?:number){
 const n=new Vector3().fromArray(receiver.geometricNormal),point=new Vector3().fromArray(receiver.position).addScaledVector(n,.004),delta=new Vector3()
 const floor=receiver.floor??Math.max(0,field.floors.findIndex((f,i)=>point.y>=f.elevation-.02&&point.y<=field.ranges[i].top))
 if(n.y>.9&&Math.abs(point.y-field.floors[floor].elevation)<.08)point.y=field.floors[floor].elevation+.016
 const region=field.regions.find(r=>r.floorId===field.floors[floor].id&&pointIsInsideRoomPolygon({x:point.x,y:point.z},r.polygon))
 const radiusSquared=(field.spacing*1.75)**2
 const localFloor=method==='occluder-local'&&n.y>.9&&point.y<field.floors[floor].elevation+.08&&indirectLocalFloorReceiver(field,visibility,floor,point.x,point.y,point.z)
 const links=field.probes.flatMap(probe=>{
  if(field.positionData[probe.index*4+3]<.5)return[]
  const p=new Vector3().fromArray(field.positionData,probe.index*4),d2=delta.subVectors(point,p).lengthSq(),distance=Math.sqrt(d2)
  if(d2>=radiusSquared)return[]
  const max=Math.max(0,distance-.001),blocked=max>.025&&visibility.occluded(p,delta.clone().multiplyScalar(1/distance),max)
  const crossRoom=partitionX===undefined?probe.region.id!==region?.id:(point.x<partitionX)!==(p.x<partitionX)
  let allowed=!blocked
  if(method==='same-room'&&crossRoom)allowed=false
  // For the controlled partition, the actual opening is known. For real
  // rooms, geometric segments are the stricter evidence for an open portal.
  if(method==='portal'&&crossRoom&&partitionX!==undefined){const t=(partitionX-p.x)/(point.x-p.x),y=p.y+(point.y-p.y)*t,z=p.z+(point.z-p.z)*t;if(y>2.1||z<1.5||z>2.4)allowed=false}
  const baseWeight=(1-d2/radiusSquared)**2
  const power=method==='local-1'?1:method==='local-2'||localFloor?2:method==='local-3'?3:0
  const weight=allowed?baseWeight/(d2+.15**2)**(power/2):0
  return[{index:probe.index,position:p.toArray(),distance,baseWeight,weight,blocked,crossRoom,region:probe.region.id}]
 })
 if(method==='nearest'){const visible=links.filter(p=>p.weight>0).sort((a,b)=>a.distance-b.distance);for(const p of links)p.weight=p===visible[0]?1:0}
 const total=links.reduce((s,p)=>s+p.weight,0),baseSupport=links.filter(p=>p.weight>0).reduce((s,p)=>s+p.baseWeight,0)
 for(const p of links)p.weight/=total||1
 return{point:point.toArray(),support:baseSupport,coverage:links.filter(p=>p.weight>0).length,crossRoomWeight:links.filter(p=>p.crossRoom).reduce((s,p)=>s+p.weight,0),links}
}
export function spatialIrradiance(field:IndirectField,weights:ReturnType<typeof spatialInfluences>,normal:number[],coefficients=field.coefficients,order=field.shOrder){
 const basis=indirectSHIrradianceBasis(new Vector3().fromArray(normal),order)
 return[0,1,2].map(c=>Math.max(0,weights.links.reduce((s,p)=>s+p.weight*basis.reduce((v,b,i)=>v+b*DataUtils.fromHalfFloat(coefficients[c][p.index*field.coefficientCount+i]),0),0)))
}
