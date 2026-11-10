import {BufferAttribute,DataUtils,Matrix3,Mesh,Triangle,Vector3} from 'three'
import type {IndirectField} from '../src/indirectLighting.ts'
import type {IndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'

export type SurfacePoint={position:number[];normal:number[];geometricNormal:number[]}
export function directSurfaceSampler(field:IndirectField,visibility:Pick<IndirectVisibility,'occluded'>,mode:'none'|'bvh'='bvh'){
  const probes=field.probes.filter(p=>field.positionData[p.index*4+3]>.5).map(p=>({index:p.index,position:new Vector3().fromArray(field.positionData,p.index*4)}))
  const radius=field.spacing*1.75
  return (point:SurfacePoint)=>{
    const p=new Vector3().fromArray(point.position).addScaledVector(new Vector3().fromArray(point.geometricNormal).normalize(),.0002),direction=new Vector3(),basis=indirectSHIrradianceBasis(new Vector3().fromArray(point.normal).normalize(),field.shOrder)
    const candidates=probes.map(q=>({...q,d2:q.position.distanceToSquared(p)})).filter(q=>q.d2<radius*radius).sort((a,b)=>a.d2-b.d2).slice(0,12)
    let total=0;const rgb=[0,0,0],links=[]
    for(const q of candidates){const distance=Math.sqrt(q.d2);direction.subVectors(p,q.position).normalize();const blocked=mode==='bvh'&&visibility.occluded(q.position,direction,Math.max(0,distance-.0001),.0001),weight=blocked?0:(1-q.d2/radius**2)**2/(q.d2+.15**2);links.push({index:q.index,blocked,distance,weight});total+=weight
      for(let c=0;c<3;c++)for(let k=0;k<basis.length;k++)rgb[c]+=weight*basis[k]*DataUtils.fromHalfFloat(field.coefficients[c][q.index*field.coefficientCount+k])
    }
    return{rgb:rgb.map(v=>Math.max(0,v/(total||1))),links,support:total}
  }
}

/** Non-indexed face-local attributes prevent welding unrelated cushions/hard
 * boundaries. The lightmap gives each triangle its own padded island. This is
 * intentionally a small feasibility atlas, not a general-purpose UV unwrapper. */
export function bakeSurface(mesh:Mesh,sample:(p:SurfacePoint)=>{rgb:number[]}){
  const start=performance.now(),geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone(),position=geometry.attributes.position,normal=geometry.attributes.normal,normalMatrix=new Matrix3().getNormalMatrix(mesh.matrixWorld),triangles=position.count/3
  const vertex=new Float32Array(position.count*3),uv=new Float32Array(position.count*2),tile=8,padding=2,core=4,columns=Math.ceil(Math.sqrt(triangles)),size=columns*tile,atlas=new Float32Array(size*size*4),triangle=new Triangle(),sn=new Vector3(),gn=new Vector3(),p=new Vector3()
  const receiver=(face:number,u:number,v:number)=>{const ids=[face*3,face*3+1,face*3+2];triangle.a.fromBufferAttribute(position,ids[0]).applyMatrix4(mesh.matrixWorld);triangle.b.fromBufferAttribute(position,ids[1]).applyMatrix4(mesh.matrixWorld);triangle.c.fromBufferAttribute(position,ids[2]).applyMatrix4(mesh.matrixWorld);triangle.getNormal(gn);p.copy(triangle.a).multiplyScalar(1-u-v).addScaledVector(triangle.b,u).addScaledVector(triangle.c,v);sn.set(0,0,0);for(let c=0;c<3;c++)sn.addScaledVector(new Vector3().fromBufferAttribute(normal,ids[c]).applyNormalMatrix(normalMatrix),[1-u-v,u,v][c]);if(sn.dot(gn)<0)gn.negate();return{position:p.toArray(),normal:sn.normalize().toArray(),geometricNormal:gn.toArray()}}
  for(let f=0;f<triangles;f++)for(let c=0;c<3;c++)vertex.set(sample(receiver(f,c===1?1:0,c===2?1:0)).rgb,(f*3+c)*3)
  const vertexBakeMs=performance.now()-start,atlasStart=performance.now()
  for(let f=0;f<triangles;f++){
    const ox=f%columns*tile,oy=Math.floor(f/columns)*tile,cache=new Map<string,number[]>()
    for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){
      let u=Math.max(0,Math.min(1,(x-padding)/(core-1))),v=Math.max(0,Math.min(1,(y-padding)/(core-1)));if(u+v>1){const sum=u+v;u/=sum;v/=sum}
      const key=`${u}:${v}`;let rgb=cache.get(key);if(!rgb){rgb=sample(receiver(f,u,v)).rgb;cache.set(key,rgb)}atlas.set([...rgb,1],((oy+y)*size+ox+x)*4)
    }
    for(let c=0;c<3;c++)uv.set([(ox+padding+.5+(c===1?core-1:0))/size,(oy+padding+.5+(c===2?core-1:0))/size],(f*3+c)*2)
  }
  geometry.setAttribute('giNextIrradiance',new BufferAttribute(vertex,3));geometry.setAttribute('giNextUV',new BufferAttribute(uv,2))
  const lightmapBakeMs=performance.now()-atlasStart
  return{geometry,atlas,size,metadata:{triangles,vertexSamples:position.count,vertexBytes:vertex.byteLength,lightmapBytes:atlas.byteLength,uvBytes:uv.byteLength,size,tile,padding,vertexBakeMs,lightmapBakeMs},receiver,
    at(face:number,worldPosition:number[]){
      const base=face*3;triangle.a.fromBufferAttribute(position,base).applyMatrix4(mesh.matrixWorld);triangle.b.fromBufferAttribute(position,base+1).applyMatrix4(mesh.matrixWorld);triangle.c.fromBufferAttribute(position,base+2).applyMatrix4(mesh.matrixWorld);const bary=triangle.getBarycoord(new Vector3().fromArray(worldPosition),new Vector3())!
      const weights=bary.toArray(),vertexRGB=[0,1,2].map(c=>weights.reduce((s,w,k)=>s+w*vertex[(base+k)*3+c],0)),x=face%columns*tile+padding+bary.y*(core-1),y=Math.floor(face/columns)*tile+padding+bary.z*(core-1),lightmapRGB=[0,0,0]
      for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const w=(dx?x-Math.floor(x):1-x+Math.floor(x))*(dy?y-Math.floor(y):1-y+Math.floor(y));for(let c=0;c<3;c++)lightmapRGB[c]+=w*atlas[((Math.floor(y)+dy)*size+Math.floor(x)+dx)*4+c]}
      return{vertex:vertexRGB,lightmap:lightmapRGB,barycentric:weights}
    },dispose(){geometry.dispose()}}
}
