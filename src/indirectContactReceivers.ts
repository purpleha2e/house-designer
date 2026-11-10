import {Float32BufferAttribute,Uint16BufferAttribute,Matrix3,Mesh,Vector3,type Object3D} from 'three'
import type {IndirectVisibility,IndirectGeometrySnapshot} from './indirectVisibility.ts'
import type {IndirectField} from './indirectLighting.ts'

export type IndirectContactReceiverQuery={offsets:Uint32Array;points:Float32Array;probes:number[][];geometry?:IndirectGeometrySnapshot}
const LINK_BUDGET=.75*1024*1024
let nextLayout=1

/** A vertex supplies its flat probe index only to faces that use it as their
 * provoking (last) vertex. Require visibility at all corners and centres of
 * those faces, not just at the vertex.
 * This is geometry-only data and remains valid across lighting changes. */
export function selectIndirectContactLinks(query:IndirectContactReceiverQuery,visibility:Pick<IndirectVisibility,'occluded'>){
 const links=new Int16Array(query.offsets.length-1).fill(-1),origin=new Vector3(),point=new Vector3(),direction=new Vector3()
 for(let vertex=0;vertex<links.length;vertex++){
  const start=query.offsets[vertex],end=query.offsets[vertex+1];let closest=.6**2
  point.fromArray(query.points,start*3)
  for(let slot=0;slot<query.probes.length;slot++){
   origin.fromArray(query.probes[slot]);const d2=origin.distanceToSquared(point);if(d2>=closest)continue
   let visible=true
   for(let i=start;i<end;i++){direction.fromArray(query.points,i*3).sub(origin);const distance=direction.length()
    if(distance>.0003&&visibility.occluded(origin,direction.divideScalar(distance),distance-.0002,.0001)){visible=false;break}
   }
   if(visible){closest=d2;links[vertex]=slot}
  }
 }return links
}

/** Uses the small geometries already owned by receiver-safety metadata. The
 * original shared GLTF buffers and triangle identities remain unchanged. */
export function snapshotIndirectContactReceivers(scene:Object3D,field:IndirectField){
 const records:{mesh:Mesh;vertices:number[];start:number}[]=[],points:number[]=[],offsets=[0]
 const a=new Vector3(),b=new Vector3(),c=new Vector3(),n=new Vector3(),normalMatrix=new Matrix3()
 scene.updateMatrixWorld(true)
 scene.traverse(object=>{
  if(!(object instanceof Mesh)||!object.geometry.attributes.hdGIReceiverMaxBias)return
  const geometry=object.geometry,position=geometry.attributes.position,normal=geometry.attributes.normal,limits=geometry.attributes.hdGIReceiverMaxBias
  if(!position||!normal)return
  const adjacent=new Map<number,Set<number>>(),centres=new Map<number,number[]>(),vertices:number[]=[]
  normalMatrix.getNormalMatrix(object.matrixWorld)
  const shifted=(id:number)=>{
   a.fromBufferAttribute(position,id).applyMatrix4(object.matrixWorld);n.fromBufferAttribute(normal,id).applyNormalMatrix(normalMatrix)
   return a.addScaledVector(n,Math.min(.001,limits.getX(id)*.25)).toArray()
  }
  const count=geometry.index?.count??position.count
  for(let face=0;face+2<count;face+=3){
   const ids=[0,1,2].map(k=>geometry.index?.getX(face+k)??face+k)
   if(!ids.some(id=>limits.getX(id)<.12))continue
   a.fromBufferAttribute(position,ids[0]).applyMatrix4(object.matrixWorld);b.fromBufferAttribute(position,ids[1]).applyMatrix4(object.matrixWorld);c.fromBufferAttribute(position,ids[2]).applyMatrix4(object.matrixWorld)
   a.add(b).add(c).multiplyScalar(1/3);n.set(0,0,0)
   for(const id of ids)n.add(b.fromBufferAttribute(normal,id));n.normalize().applyNormalMatrix(normalMatrix)
   centres.set(face,a.addScaledVector(n,Math.min(.001,...ids.map(id=>limits.getX(id)*.25))).toArray())
   const id=ids[2],faces=adjacent.get(id)??new Set<number>();faces.add(face);adjacent.set(id,faces)
  }
  const start=offsets.length-1
  for(const [id,faces]of adjacent){
   if(limits.getX(id)>=.12||limits.getX(id)<.002)continue
   vertices.push(id);points.push(...shifted(id))
   const corners=new Set<number>()
   for(const face of faces){points.push(...centres.get(face)!);for(let k=0;k<3;k++)corners.add(geometry.index?.getX(face+k)??face+k)}
   for(const corner of corners)if(corner!==id)points.push(...shifted(corner))
   offsets.push(points.length/3)
  }
  if(vertices.length)records.push({mesh:object,vertices,start})
 })
 const query:IndirectContactReceiverQuery={offsets:new Uint32Array(offsets),points:new Float32Array(points),probes:field.probes.filter(p=>p.kind==='contact').map(p=>p.position.toArray())}
 return{query,install(links:Int16Array){
  const tag=nextLayout++;field.contactReceiverTag=tag
  let bytes=0,matched=0,meshes=0,omitted=0
  const ordered=records.map(r=>({...r,count:r.vertices.reduce((s,_,i)=>s+(links[r.start+i]>=0?1:0),0)})).sort((a,b)=>b.count/b.mesh.geometry.attributes.position.count-a.count/a.mesh.geometry.attributes.position.count)
  for(const record of ordered){const geometry=record.mesh.geometry;geometry.deleteAttribute('hdGIContactLink');if(!record.count)continue
   const packed=tag<=65535,cost=geometry.attributes.position.count*(packed?4:8);if(bytes+cost>LINK_BUDGET){omitted+=record.count;continue}
   const values=packed?new Uint16Array(geometry.attributes.position.count*2):new Float32Array(geometry.attributes.position.count*2)
   record.vertices.forEach((id,i)=>{const slot=links[record.start+i];if(slot>=0){values[id*2]=slot+1;values[id*2+1]=tag;matched++}})
   geometry.setAttribute('hdGIContactLink',packed?new Uint16BufferAttribute(values,2):new Float32BufferAttribute(values,2));bytes+=cost;meshes++
  }
  return{tag,bytes,matched,meshes,omitted,queries:query.offsets.length-1}
 }}
}
