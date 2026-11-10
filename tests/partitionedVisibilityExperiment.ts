import {Box3,BufferAttribute,BufferGeometry,DoubleSide,Matrix4,Ray,Vector3} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import {createIndirectSegmentQuery} from '../src/indirectSegmentQuery.ts'
import {createIndirectVisibilityFromSnapshot,type IndirectGeometrySnapshot} from '../src/indirectVisibility.ts'

type Part={positions:Float32Array;geometry:BufferGeometry;tree:MeshBVH;box:Box3;query:ReturnType<typeof createIndirectSegmentQuery>}
type Node={box:Box3;left?:Node;right?:Node;part?:Part}
/** Read-only prototype: world-space BLAS preserve production Float32 triangle
 * coordinates; a bounds hierarchy prunes objects. Not wired into the baker. */
export function runPartitionedVisibilityExperiment(before:IndirectGeometrySnapshot,after:IndirectGeometrySnapshot,samples=12000){
 let previous=new Map<string,Part[]>(),root:Node|undefined
 const point=new Vector3(),matrix=new Matrix4(),ray=new Ray()
 const stats:{cold?:unknown;edit?:unknown}={}
 const prepare=(parts:IndirectGeometrySnapshot)=>{
  const start=performance.now(),next=new Map<string,Part[]>(),owned=new Set<Part>(),leaves:Part[]=[]
  let reused=0,rebuilt=0,bytes=0
  for(const part of parts)for(const transform of part.matrices){
   const count=part.ranges.reduce((n,r)=>n+Math.floor(r.count/3)*9,0),positions=new Float32Array(count),bits=new Uint32Array(positions.buffer),attribute=new BufferAttribute(part.position,part.stride,part.normalized)
   matrix.fromArray(transform);const mirrored=matrix.determinant()<0;let offset=0
   for(const range of part.ranges)for(let t=range.start;t+2<range.start+range.count;t+=3)for(let c=0;c<3;c++){
    const corner=mirrored&&c?3-c:c,index=part.index?.[t+corner]??t+corner
    point.set(attribute.getComponent(index,part.offset),attribute.getComponent(index,part.offset+1),attribute.getComponent(index,part.offset+2)).applyMatrix4(matrix).toArray(positions,offset);offset+=3
   }
   if(!count)continue
   let hash=2166136261;for(const value of bits)hash=Math.imul(hash^value,16777619)
   const key=count+':'+(hash>>>0),old=previous.get(key)?.find(p=>!owned.has(p)&&p.positions.every((v,i)=>Object.is(v,positions[i])))
   let entry=old
   if(entry){reused++;owned.add(entry)}else{
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3))
    const tree=new MeshBVH(geometry,{strategy:SAH,targetLeafSize:4});geometry.computeBoundingBox()
    entry={positions,geometry,tree,box:geometry.boundingBox!.clone().expandByScalar(.00001),query:createIndirectSegmentQuery(tree)};rebuilt++
   }
   leaves.push(entry);const bucket=next.get(key)??[];bucket.push(entry);next.set(key,bucket)
   const snapshot=MeshBVH.serialize(entry.tree,{cloneBuffers:false});bytes+=entry.positions.byteLength+(snapshot.index?.byteLength??0)+snapshot.roots.reduce((n,r)=>n+r.byteLength,0)
  }
  for(const bucket of previous.values())for(const part of bucket)if(!owned.has(part))part.geometry.dispose()
  previous=next
  const build=(items:Part[]):Node|undefined=>{
   if(!items.length)return
   const box=items.reduce((b,p)=>b.union(p.box),new Box3())
   if(items.length===1)return{box,part:items[0]}
   const size=box.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z'
   items.sort((a,b)=>(a.box.min[axis]+a.box.max[axis])-(b.box.min[axis]+b.box.max[axis]));const middle=items.length>>1
   return{box,left:build(items.slice(0,middle)),right:build(items.slice(middle))}
  }
  root=build(leaves);return{ms:performance.now()-start,reused,rebuilt,parts:leaves.length,retainedGeometryAndTreeBytes:bytes}
 }
 const intersects=(box:Box3,origin:Vector3,direction:Vector3,max:number)=>{
  let near=0,far=max
  for(const axis of ['x','y','z']as const){const d=direction[axis],o=origin[axis];if(Math.abs(d)<1e-15){if(o<box.min[axis]||o>box.max[axis])return false;continue}const a=(box.min[axis]-o)/d,b=(box.max[axis]-o)/d;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(far<near)return false}return true
 }
 const query=(node:Node|undefined,origin:Vector3,direction:Vector3,max:number):boolean=>!!node&&intersects(node.box,origin,direction,max)&&(node.part?node.part.query(origin,direction,max):query(node.left,origin,direction,max)||query(node.right,origin,direction,max))
 const nearest=(node:Node|undefined,origin:Vector3,direction:Vector3,max:number):number=>{
  if(!node||!intersects(node.box,origin,direction,max))return max
  if(node.part){ray.set(origin,direction);return node.part.tree.raycastFirst(ray,DoubleSide,.025,max)?.distance??max}
  return nearest(node.right,origin,direction,nearest(node.left,origin,direction,max))
 }
 try{
  stats.cold=prepare(before);stats.edit=prepare(after)
  const start=performance.now(),whole=createIndirectVisibilityFromSnapshot(after),wholeBuildMs=performance.now()-start
  try{
   const bounds=root!.box,extent=bounds.getSize(new Vector3()),origin=new Vector3(),direction=new Vector3(),segments:{origin:Vector3;direction:Vector3;max:number}[]=[]
   let state=1234;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296}
   for(let i=0;i<samples;i++){origin.set(bounds.min.x+random()*extent.x,bounds.min.y+random()*extent.y,bounds.min.z+random()*extent.z);direction.set(random()*2-1,random()*2-1,random()*2-1).normalize();segments.push({origin:origin.clone(),direction:direction.clone(),max:.03+random()*20})}
   let mismatches=0,maxDistanceError=0
   let at=performance.now();const expected=segments.map(s=>whole.occluded(s.origin,s.direction,s.max));const wholeQueryMs=performance.now()-at
   at=performance.now();const actual=segments.map(s=>query(root,s.origin,s.direction,s.max));const partitionedQueryMs=performance.now()-at
   for(let i=0;i<segments.length;i++){if(expected[i]!==actual[i])mismatches++;const s=segments[i];maxDistanceError=Math.max(maxDistanceError,Math.abs(whole.distance(s.origin,s.direction,s.max)-nearest(root,s.origin,s.direction,s.max)))}
   return{...stats,wholeBuildMs,samples,mismatches,maxDistanceError,wholeQueryMs,partitionedQueryMs,scope:'read-only world-space per-part BVH plus median AABB hierarchy; exact world triangles; no production adoption; GPU primitive-ID remapping and worker cancellation integration remain unimplemented'}
  }finally{whole.dispose()}
 }finally{for(const parts of previous.values())for(const part of parts)part.geometry.dispose()}
}
