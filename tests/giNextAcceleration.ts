import {Box3,BufferAttribute,BufferGeometry,DoubleSide,Matrix3,Matrix4,Ray,Vector3} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import type {IndirectGeometrySnapshot} from '../src/indirectVisibility.ts'
import {createParametricSegmentQuery} from './giParametricSegmentQuery.ts'

type Part=IndirectGeometrySnapshot[number]
type Geometry={revision:string;geometry:BufferGeometry;tree:MeshBVH;bounds:Box3;faces:number[];bytes:number;segments:ReturnType<typeof createParametricSegmentQuery>}
type Instance={id:string;key:string;matrix:Matrix4;inverse:Matrix4;box:Box3;leaf?:Node;geometry:Geometry}
type Node={box:Box3;parent?:Node;left?:Node;right?:Node;instance?:Instance;slot?:number;axis?:number}
export type NextHit={distance:number;point:Vector3;normal:Vector3;id:string;face:number}

/** Test-only local-space BLAS / median TLAS. Explicit immutable geometry revision
 * belongs to the caller: transforms never invalidate it. No persistent cache or
 * production imports. All accepted production visibility ranges are double-sided. */
export class NextAcceleration {
  geometries=new Map<string,Geometry>()
  instances=new Map<string,Instance>()
  root?:Node
  builds=0
  refits=0
  private packedBounds=new Float64Array(0)
  private packedNodes=new Int32Array(0)
  private packedInstances:Instance[]=[]
  private stack=new Int32Array(0)
  private rayOrigin=new Float64Array(3)
  private rayDirection=new Float64Array(3)
  private rayInverse=new Float64Array(3)
  setGeometry(key:string,revision:string,part:Part){
    if(this.geometries.get(key)?.revision===revision)return false
    const positions:number[]=[],faces:number[]=[],attribute=new BufferAttribute(part.position,part.stride,part.normalized)
    for(const range of part.ranges)for(let t=range.start;t+2<range.start+range.count;t+=3){
      faces.push(Math.floor(t/3))
      for(let c=0;c<3;c++){const v=part.index?.[t+c]??t+c;for(let a=0;a<3;a++)positions.push(attribute.getComponent(v,part.offset+a))}
    }
    if(!faces.length)throw Error('Empty geometry must be removed, not built')
    const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array(positions),3))
    const tree=new MeshBVH(geometry,{strategy:SAH,targetLeafSize:4});geometry.computeBoundingBox()
    const serialized=MeshBVH.serialize(tree,{cloneBuffers:false})
    this.geometries.get(key)?.geometry.dispose()
    this.geometries.set(key,{revision,geometry,tree,bounds:geometry.boundingBox!.clone(),faces,bytes:positions.length*4+(serialized.index?.byteLength??0)+serialized.roots.reduce((s,r)=>s+r.byteLength,0)+faces.length*8,segments:createParametricSegmentQuery(tree)})
    this.builds++
    for(const instance of this.instances.values())if(instance.key===key){instance.geometry=this.geometries.get(key)!;this.bounds(instance);this.refit(instance.leaf)}
    return true
  }
  private bounds(instance:Instance){instance.box.copy(this.geometries.get(instance.key)!.bounds).applyMatrix4(instance.matrix).expandByScalar(1e-6)}
  setInstance(id:string,key:string,matrix:Matrix4){
    if(!this.geometries.has(key))throw Error('Unknown geometry '+key)
    if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-12)throw Error('Singular/nonfinite instance transform')
    let instance=this.instances.get(id)
    if(instance){instance.key=key;instance.geometry=this.geometries.get(key)!;instance.matrix.copy(matrix);instance.inverse.copy(matrix).invert();this.bounds(instance);this.refit(instance.leaf)}
    else{instance={id,key,geometry:this.geometries.get(key)!,matrix:matrix.clone(),inverse:matrix.clone().invert(),box:new Box3()};this.bounds(instance);this.instances.set(id,instance);this.root=undefined}
  }
  removeInstance(id:string){if(this.instances.delete(id))this.root=undefined}
  removeUnusedGeometry(){const used=new Set([...this.instances.values()].map(i=>i.key));for(const [key,g]of this.geometries)if(!used.has(key)){g.geometry.dispose();this.geometries.delete(key)}}
  rebuild(){
    const build=(instances:Instance[],parent?:Node):Node|undefined=>{
      if(!instances.length)return
      const node:Node={box:instances.reduce((b,i)=>b.union(i.box),new Box3()),parent}
      if(instances.length===1){node.instance=instances[0];instances[0].leaf=node;return node}
      const size=node.box.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z'
      node.axis=axis==='x'?0:axis==='y'?1:2
      instances.sort((a,b)=>a.box.min[axis]+a.box.max[axis]-b.box.min[axis]-b.box.max[axis]);const mid=instances.length>>1
      node.left=build(instances.slice(0,mid),node);node.right=build(instances.slice(mid),node);return node
    }
    this.root=build([...this.instances.values()])
    const nodes:Node[]=[];this.packedInstances=[]
    const collect=(node?:Node)=>{if(!node)return;node.slot=nodes.length;nodes.push(node);collect(node.left);collect(node.right)};collect(this.root)
    this.packedBounds=new Float64Array(nodes.length*6);this.packedNodes=new Int32Array(nodes.length*4);this.stack=new Int32Array(nodes.length)
    for(const node of nodes){this.writeBounds(node);const at=node.slot!*4;if(node.instance){this.packedNodes[at+3]=this.packedInstances.push(node.instance)}else{this.packedNodes[at]=node.left!.slot!;this.packedNodes[at+1]=node.right!.slot!;this.packedNodes[at+2]=node.axis!}}
  }
  private writeBounds(node:Node){if(node.slot===undefined)return;const i=node.slot*6,b=node.box,a=this.packedBounds;a[i]=b.min.x;a[i+1]=b.min.y;a[i+2]=b.min.z;a[i+3]=b.max.x;a[i+4]=b.max.y;a[i+5]=b.max.z}
  private refit(node?:Node){while(node){if(node.instance)node.box.copy(node.instance.box);else node.box.copy(node.left!.box).union(node.right!.box);this.writeBounds(node);node=node.parent;this.refits++}}
  hit(origin:Vector3,direction:Vector3,far=80,near=.025):NextHit|null{
    if(!this.root)this.rebuild()
    if(!direction.lengthSq()||far<near)return null
    const worldRay=new Ray(origin,direction.clone().normalize()),localRay=new Ray(),v=new Vector3();let closest:NextHit|null=null
    const visit=(node?:Node)=>{
      if(!node)return
      const limit=closest?.distance??far
      if(!node.box.containsPoint(origin)&&(!worldRay.intersectBox(node.box,v)||origin.distanceTo(v)>limit))return
      if(!node.instance){visit(node.left);visit(node.right);return}
      const i=node.instance,g=this.geometries.get(i.key)!,e=i.inverse.elements,d=worldRay.direction
      // |inverse linear * unit world ray| converts world distances to local
      // distances even with nonuniform scale, shear and negative determinants.
      v.set(e[0]*d.x+e[4]*d.y+e[8]*d.z,e[1]*d.x+e[5]*d.y+e[9]*d.z,e[2]*d.x+e[6]*d.y+e[10]*d.z)
      const scale=v.length();localRay.origin.copy(origin).applyMatrix4(i.inverse);localRay.direction.copy(v).divideScalar(scale)
      const h=g.tree.raycastFirst(localRay,DoubleSide,near*scale,limit*scale)
      if(h){const distance=h.distance/scale;if(!closest||distance<closest.distance)closest={distance,point:h.point.clone().applyMatrix4(i.matrix),normal:h.face!.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(i.matrix)),id:i.id,face:g.faces[Math.floor(h.face!.a/3)]}}
    }
    visit(this.root);return closest
  }
  occludedNearest(origin:Vector3,direction:Vector3,far:number,near=.025){const h=this.hit(origin,direction,far,near);return !!h&&h.distance<far}
  /** Allocation-free after preparation; no nearest point, identity, normal,
   * sqrt per instance, inverse calculation, material lookup or Map lookup. */
  occluded(origin:Vector3,direction:Vector3,far:number,near=.025){
    if(far<=near||!direction.lengthSq())return false
    if(!this.root)this.rebuild()
    if(!this.root)return false
    const length=direction.length(),ox=origin.x,oy=origin.y,oz=origin.z,dx=direction.x/length,dy=direction.y/length,dz=direction.z/length
    const origins=this.rayOrigin,directions=this.rayDirection,inverses=this.rayInverse,bounds=this.packedBounds,nodes=this.packedNodes,stack=this.stack
    origins[0]=ox;origins[1]=oy;origins[2]=oz;directions[0]=dx;directions[1]=dy;directions[2]=dz;inverses[0]=1/dx;inverses[1]=1/dy;inverses[2]=1/dz
    let pending=1;stack[0]=0
    while(pending){const node=stack[--pending],b=node*6,m=node*4;let low=near,high=far
      for(let axis=0;axis<3;axis++){const o=origins[axis],d=directions[axis];if(d===0){if(o<bounds[b+axis]||o>bounds[b+axis+3]){high=-Infinity;break}}else{const a=(bounds[b+axis]-o)*inverses[axis],c=(bounds[b+axis+3]-o)*inverses[axis];low=Math.max(low,Math.min(a,c));high=Math.min(high,Math.max(a,c));if(low>high)break}}
      if(low>high)continue
      const leaf=nodes[m+3]
      if(!leaf){const left=nodes[m],right=nodes[m+1],forward=directions[nodes[m+2]]>=0;stack[pending++]=forward?right:left;stack[pending++]=forward?left:right;continue}
      const instance=this.packedInstances[leaf-1],e=instance.inverse.elements
      if(instance.geometry.segments.query(e[0]*ox+e[4]*oy+e[8]*oz+e[12],e[1]*ox+e[5]*oy+e[9]*oz+e[13],e[2]*ox+e[6]*oy+e[10]*oz+e[14],e[0]*dx+e[4]*dy+e[8]*dz,e[1]*dx+e[5]*dy+e[9]*dz,e[2]*dx+e[6]*dy+e[10]*dz,near,far))return true
    }
    return false
  }
  memory(){return {geometryAndTreeBytes:[...this.geometries.values()].reduce((s,g)=>s+g.bytes,0),blasQueryBytes:[...this.geometries.values()].reduce((s,g)=>s+g.segments.bytes,0),tlasQueryBytes:this.packedBounds.byteLength+this.packedNodes.byteLength+this.stack.byteLength+72,instances:this.instances.size,uniqueGeometries:this.geometries.size,note:'Typed buffers and face-number payload; JS objects, tree-node objects and allocator overhead excluded'}}
  dispose(){for(const g of this.geometries.values())g.geometry.dispose();this.geometries.clear();this.instances.clear();this.root=undefined;this.packedInstances=[];this.packedBounds=new Float64Array(0);this.packedNodes=new Int32Array(0);this.stack=new Int32Array(0)}
}
