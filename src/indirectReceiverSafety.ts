import {BufferAttribute,BufferGeometry,DataUtils,DoubleSide,Float16BufferAttribute,InstancedMesh,Matrix3,Mesh,MeshStandardMaterial,Ray,Vector3,type Object3D} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import {isLightingGlazing} from './lightingVisibility.ts'
import type {IndirectContactSeed} from './indirectContactProbes.ts'
import {refineIndirectReceiverGeometry} from './indirectReceiverRefinement.ts'

const UNBOUNDED=32
const receiverSeeds=new WeakMap<Object3D,IndirectContactSeed[]>()
export const getIndirectReceiverSeeds=(root:Object3D)=>receiverSeeds.get(root)??[]
/** Limits a displaced receiver against the actual surfaces of its imported
 * model. Geometry is immutable/shared until a limit is needed; lighting,
 * camera motion and probe publications never rebuild these rays. */
export function attachIndirectReceiverSafety(root:Object3D){
 root.updateWorldMatrix(true,true)
 const meshes:Mesh[]=[],positions:number[]=[],p=new Vector3(),n=new Vector3(),direction=new Vector3(),ray=new Ray(),normalMatrix=new Matrix3()
 const opaque=(m:unknown)=>m instanceof MeshStandardMaterial&&!isLightingGlazing(m)&&m.opacity>.95
 root.traverse(o=>{if(o instanceof Mesh&&!(o instanceof InstancedMesh)&&!('isSkinnedMesh'in o)&&!o.morphTargetInfluences?.length&&o.geometry.attributes.normal&&!o.userData.selectionDecoration&&(Array.isArray(o.material)?o.material:[o.material]).some(opaque))meshes.push(o)})
 const ranges=(mesh:Mesh)=>{const g=mesh.geometry,materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];return(g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}]).filter(group=>opaque(materials[Array.isArray(mesh.material)?group.materialIndex??0:0]))}
 for(const mesh of meshes)for(const group of ranges(mesh))for(let i=group.start;i<group.start+group.count;i++){
  p.fromBufferAttribute(mesh.geometry.attributes.position,mesh.geometry.index?.getX(i)??i).applyMatrix4(mesh.matrixWorld);positions.push(p.x,p.y,p.z)
 }
 const physical=new BufferGeometry();physical.setAttribute('position',new BufferAttribute(new Float32Array(positions),3))
 const tree=positions.length?new MeshBVH(physical,{strategy:SAH,targetLeafSize:4}):null,owned:{mesh:Mesh;source:BufferGeometry;geometry:BufferGeometry;releaseRefinement?:()=>void}[]=[]
 let vertices=0,limited=0,bytes=0
 const seeds:IndirectContactSeed[]=[]
 const limit=(position:Vector3,normal:Vector3,back:boolean)=>{
  direction.copy(normal).multiplyScalar(back?-1:1);ray.origin.copy(position).addScaledVector(direction,.0001);ray.direction.copy(direction)
  const hit=tree?.raycastFirst(ray,DoubleSide,.0001,4)
  if(!hit)return UNBOUNDED
  // The reverse of a closed outward face starts inside the model and cannot
  // be displayed from outside. Do not let that exit constrain the front face.
  if(back&&(hit.face?.normal.dot(direction)??0)>.01)return UNBOUNDED
  return Math.max(.0002,hit.distance-.002)
 }
 try{for(const mesh of meshes){
  const seedStart=seeds.length
  const source=mesh.geometry,position=source.attributes.position,normal=source.attributes.normal,values=new Float32Array(position.count*2).fill(UNBOUNDED),used=new Uint8Array(position.count)
  normalMatrix.getNormalMatrix(mesh.matrixWorld)
  for(const group of ranges(mesh))for(let i=group.start;i<group.start+group.count;i++)used[source.index?.getX(i)??i]=1
  for(let i=0;i<position.count;i++)if(used[i]){p.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);n.fromBufferAttribute(normal,i).applyNormalMatrix(normalMatrix);values[i*2]=limit(p,n,false);values[i*2+1]=limit(p,n,true)}
  // Sampling a triangle centre catches a narrow opposing surface between
  // vertices. Share its conservative limit with the adjacent vertices.
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),na=new Vector3(),nb=new Vector3(),nc=new Vector3(),triangleLimits=new Map<number,number[]>()
  for(const group of ranges(mesh))for(let i=group.start;i+2<group.start+group.count;i+=3){
   const ids=[0,1,2].map(k=>source.index?.getX(i+k)??i+k)
   a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);p.copy(a).add(b).add(c).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld)
   na.fromBufferAttribute(normal,ids[0]);nb.fromBufferAttribute(normal,ids[1]);nc.fromBufferAttribute(normal,ids[2]);n.copy(na).add(nb).add(nc).normalize().applyNormalMatrix(normalMatrix)
   const centre=[0,1].map(side=>limit(p,n,!!side))
   triangleLimits.set(i,centre.map((bound,side)=>Math.min(bound,...ids.map(id=>values[id*2+side]))))
   const groupMaterial=(Array.isArray(mesh.material)?mesh.material:[mesh.material])[Array.isArray(mesh.material)?group.materialIndex??0:0] as MeshStandardMaterial
   if(groupMaterial.metalness<.5){
    a.applyMatrix4(mesh.matrixWorld);b.applyMatrix4(mesh.matrixWorld);c.applyMatrix4(mesh.matrixWorld)
    const area=b.sub(a).cross(c.sub(a)).length()*.5
    for(let side=0;side<2;side++)if(centre[side]>.014&&centre[side]<.15)seeds.push({position:p.clone().addScaledVector(n,(side?-1:1)*Math.min(.08,centre[side]*.5)).toArray(),gap:centre[side],area,receiver:p.toArray(),normal:n.clone().multiplyScalar(side?-1:1).toArray()})
   }
  }
  const count=[...triangleLimits.values()].reduce((s,v)=>s+v.filter(v=>v<UNBOUNDED).length,0);if(!count)continue
  // Every vertex of an obstructed face must obey that face's limit. Compute
  // face limits first, then take the minimum at shared vertices; no iterative
  // propagation or duplication of the model's position/normal/UV buffers.
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material],canRefine=materials.every(m=>m instanceof MeshStandardMaterial&&!m.normalMap&&!m.bumpMap&&!m.flatShading)
  const refinement=canRefine?refineIndirectReceiverGeometry(source,mesh.matrixWorld,triangleLimits):null,geometry=refinement?.geometry??new BufferGeometry(),caps=refinement?.caps??new Float32Array(position.count*2).fill(UNBOUNDED)
  if(refinement){
   // Subdivision makes a coarse face's conservative bound obsolete. Recast
   // every new face and corner; inheriting the old minimum would mark clear
   // fabric as a contact and create visible triangular lighting patches.
   seeds.length=seedStart
   const rp=geometry.attributes.position,rn=geometry.attributes.normal,areas=new Float64Array(rp.count),raw=new Float32Array(rp.count*2),faceBounds=new Map<number,number[]>()
   for(let id=0;id<rp.count;id++){
    p.fromBufferAttribute(rp,id).applyMatrix4(mesh.matrixWorld);n.fromBufferAttribute(rn,id).applyNormalMatrix(normalMatrix)
    for(let side=0;side<2;side++)raw[id*2+side]=limit(p,n,!!side)
   }
   for(const group of geometry.groups.length?geometry.groups:[{start:0,count:geometry.index!.count,materialIndex:0}])for(let i=group.start;i<group.start+group.count;i+=3){
    const ids=[0,1,2].map(k=>geometry.index!.getX(i+k));a.fromBufferAttribute(rp,ids[0]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(rp,ids[1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(rp,ids[2]).applyMatrix4(mesh.matrixWorld)
    p.copy(a).add(b).add(c).multiplyScalar(1/3);n.set(0,0,0);for(const id of ids)n.add(na.fromBufferAttribute(rn,id));n.applyNormalMatrix(normalMatrix)
    const area=b.sub(a).cross(c.sub(a)).length()*.5,centre=[0,1].map(side=>limit(p,n,!!side))
    faceBounds.set(i,centre.map((bound,side)=>Math.min(bound,...ids.map(id=>raw[id*2+side]))))
    for(const id of ids)areas[id]+=area/6
    const material=materials[group.materialIndex??0] as MeshStandardMaterial
    if(material.metalness<.5)for(let side=0;side<2;side++){const bound=centre[side]
     if(bound>.014&&bound<.15)seeds.push({position:p.clone().addScaledVector(n,(side?-1:1)*Math.min(.08,bound*.5)).toArray(),receiver:p.toArray(),normal:n.clone().multiplyScalar(side?-1:1).toArray(),gap:bound,area:area*.5})
    }
   }
   caps.fill(UNBOUNDED)
   for(const [start,bounds]of faceBounds)for(let k=0;k<3;k++){const id=geometry.index!.getX(start+k);for(let side=0;side<2;side++)caps[id*2+side]=Math.min(caps[id*2+side],bounds[side])}
   if(materials.every(m=>(m as MeshStandardMaterial).metalness<.5))for(let id=0;id<rp.count;id++){
    p.fromBufferAttribute(rp,id).applyMatrix4(mesh.matrixWorld);n.fromBufferAttribute(rn,id).applyNormalMatrix(normalMatrix)
    for(let side=0;side<2;side++){const bound=raw[id*2+side];if(bound>.014&&bound<.15)seeds.push({position:p.clone().addScaledVector(n,(side?-1:1)*Math.min(.08,bound*.5)).toArray(),receiver:p.toArray(),normal:n.clone().multiplyScalar(side?-1:1).toArray(),gap:bound,area:areas[id]})}
   }
  }else{
   for(const [start,bounds]of triangleLimits)for(let k=0;k<3;k++){const id=source.index?.getX(start+k)??start+k;for(let side=0;side<2;side++)caps[id*2+side]=Math.min(caps[id*2+side],bounds[side])}
   for(const [name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute)
   geometry.setIndex(source.index);geometry.groups=source.groups.map(g=>({...g}));geometry.drawRange={...source.drawRange}
   geometry.morphAttributes=source.morphAttributes;geometry.morphTargetsRelative=source.morphTargetsRelative
   geometry.boundingBox=source.boundingBox?.clone()??null;geometry.boundingSphere=source.boundingSphere?.clone()??null;geometry.userData={...source.userData};geometry.name=source.name
  }
  const packed=Uint16Array.from(caps,v=>DataUtils.toHalfFloat(v))
  geometry.setAttribute('hdGIReceiverMaxBias',new Float16BufferAttribute(packed,2));mesh.geometry=geometry;owned.push({mesh,source,geometry,releaseRefinement:refinement?.release});vertices+=geometry.attributes.position.count;limited+=count
  bytes+=packed.byteLength+(refinement?.bytes??0)
 }}finally{physical.dispose()}
 receiverSeeds.set(root,seeds)
 root.userData.indirectReceiverSafety={vertices,limited,bytes}
 return()=>{for(const {mesh,source,geometry,releaseRefinement}of owned){if(mesh.geometry===geometry)mesh.geometry=source;geometry.dispose();releaseRefinement?.()}receiverSeeds.delete(root);delete root.userData.indirectReceiverSafety}
}
