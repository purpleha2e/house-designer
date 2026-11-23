import { Triangle, Vector3 } from 'three'
import type { ReferenceSceneData } from './diffuseSceneMaterials.ts'
import { sampleReferenceSurface } from './diffuseSceneMaterials.ts'

type Patch = {
  face:number; source:number; material:number; tag:number; area:number; plane:number
  normal:Vector3; point:Vector3; min:Vector3; max:Vector3; distance:number
}
const maxLayers=4
const priority=(tag:number)=>tag===1 || tag===2?2:0
export type SourceSpan={start:number;end:number;min:number[];max:number[]}
export function boundLumenSources(data:ReferenceSceneData){
  const spans:SourceSpan[]=[]
  for(let start=0;start<data.materialIndices.length;){
    let end=start+1
    while(end<data.materialIndices.length && data.sourceIds?.[end]===data.sourceIds?.[start])end++
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
    for(let i=start*9;i<end*9;i+=3)for(let k=0;k<3;k++){const x=data.positions[i+k];min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x)}
    spans.push({start,end,min,max});start=end
  }
  return spans
}
const buffers=()=>[new Float64Array(48),new Float64Array(48)]
/** Sutherland-Hodgman against an axis plane. Reuse scratch storage for every
 * triangle, including the interior cells of very large architectural faces. */
function clip(input:Float64Array,count:number,out:Float64Array,axis:number,plane:number,sign:number){
  let written=0
  for(let a=(count-1)*3,b=0;b<count*3;a=b,b+=3){
    const da=(input[a+axis]-plane)*sign, db=(input[b+axis]-plane)*sign
    if((da<0)!==(db<0)){
      const t=da/(da-db)
      for(let k=0;k<3;k++)out[written++]=input[a+k]+t*(input[b+k]-input[a+k])
    }
    if(db>=0)for(let k=0;k<3;k++)out[written++]=input[b+k]
  }
  return written/3
}

export function rasterSurfacePatches(data:ReferenceSceneData,origin:number[],dims:number[],spacing:number,spans:SourceSpan[],viewProjection?:number[]){
  const stacks=new Map<number,Patch[]>(), conflicts={normal:0,material:0,separatedPlanes:0}
  const raster=buffers(),depth=buffers(),tri=new Triangle(),n=new Vector3(),point=new Vector3(),lo=new Vector3(),hi=new Vector3(),bary=new Vector3()
  const cell=[0,0,0],input=new Float64Array(9)
  const gridOrigin=new Vector3().fromArray(origin)
  const times=new Map<number,{triangles:number;milliseconds:number;patches:number}>()
  let active=-1,activeSince=0,dropped=0
  const timeFor=(id:number)=>{let row=times.get(id);if(!row){row={triangles:0,milliseconds:0,patches:0};times.set(id,row)}return row}
  let culledTriangles=0
  for(const span of spans){
    if(span.min.some((v,k)=>v>origin[k]+dims[k]*spacing || span.max[k]<origin[k])){
      culledTriangles+=span.end-span.start;continue
    }
    for(let face=span.start;face<span.end;face++){
      const source=data.sourceIds?.[face]??0,material=data.materialIndices[face],tag=data.sourceCategories?.[face]??0
      if(source!==active){const now=performance.now();if(active>=0)timeFor(active).milliseconds+=now-activeSince;active=source;activeSince=now}
      timeFor(source).triangles++
      tri.a.fromArray(data.positions,face*9);tri.b.fromArray(data.positions,face*9+3);tri.c.fromArray(data.positions,face*9+6)
      tri.getNormal(n);if(n.lengthSq()<.5)continue
      const axis=Math.abs(n.y)>Math.abs(n.x)?(Math.abs(n.y)>Math.abs(n.z)?1:2):(Math.abs(n.x)>Math.abs(n.z)?0:2)
      const u=(axis+1)%3,v=(axis+2)%3
      for(let j=0;j<9;j++)input[j]=(data.positions[face*9+j]-origin[j%3])/spacing
      const min=(axis:number)=>Math.max(0,Math.floor(Math.min(input[axis],input[axis+3],input[axis+6])))
      const max=(axis:number)=>Math.min(dims[axis]-1,Math.floor(Math.max(input[axis],input[axis+3],input[axis+6])))
      if(min(axis)>max(axis))continue
      const uMin=min(u),uMax=max(u),vMin=min(v),vMax=max(v)
      const plane=n.dot(tri.a)
      for(let j=vMin;j<=vMax;j++)for(let i=uMin;i<=uMax;i++){
        let count=clip(input,3,raster[0],u,i,1)
        count=clip(raster[0],count,raster[1],u,i+1,-1)
        count=clip(raster[1],count,raster[0],v,j,1)
        count=clip(raster[0],count,raster[1],v,j+1,-1)
        if(count<3)continue
        let dMin=Infinity,dMax=-Infinity
        for(let k=axis;k<count*3;k+=3){dMin=Math.min(dMin,raster[1][k]);dMax=Math.max(dMax,raster[1][k])}
        for(let d=Math.max(0,Math.floor(dMin));d<=Math.min(dims[axis]-1,Math.floor(dMax));d++){
          let polygon=raster[1],vertices=count
          if(dMin<d || dMax>d+1){
            vertices=clip(polygon,vertices,depth[0],axis,d,1)
            vertices=clip(depth[0],vertices,depth[1],axis,d+1,-1);polygon=depth[1]
          }
          if(vertices<3)continue
          let area=0;point.set(0,0,0);lo.setScalar(Infinity);hi.setScalar(-Infinity)
          for(let k=0,prev=(vertices-1)*3;k<vertices*3;prev=k,k+=3){
            area+=polygon[prev+u]*polygon[k+v]-polygon[k+u]*polygon[prev+v]
            bary.fromArray(polygon,k);point.add(bary);lo.min(bary);hi.max(bary)
          }
          area=Math.abs(area)*.5;if(area<1e-7)continue
          point.multiplyScalar(1/vertices)
          cell[u]=i;cell[v]=j;cell[axis]=d
          const distance=(point.x-cell[0]-.5)**2+(point.y-cell[1]-.5)**2+(point.z-cell[2]-.5)**2
          lo.multiplyScalar(spacing).add(gridOrigin);hi.multiplyScalar(spacing).add(gridOrigin);point.multiplyScalar(spacing).add(gridOrigin)
          const address=cell[0]+dims[0]*(cell[1]+dims[1]*cell[2])
          let stack=stacks.get(address);if(!stack){stack=[];stacks.set(address,stack)}
          const own=stack.find(s=>s.source===source && s.material===material && s.normal.dot(n)>.999 && Math.abs(s.plane-plane)<.002)
          if(own){own.area+=area;own.min.min(lo);own.max.max(hi);if(distance<own.distance){own.face=face;own.distance=distance;own.point.copy(point)};continue}
          if(stack.length===maxLayers){
            let smallest=0
            for(let k=1;k<stack.length;k++)if(stack[k].area+priority(stack[k].tag)<stack[smallest].area+priority(stack[smallest].tag))smallest=k
            dropped++
            const old=stack[smallest]
            if(area+priority(tag)<=old.area+priority(old.tag))continue
            old.face=face;old.source=source;old.material=material;old.tag=tag;old.area=area;old.plane=plane;old.distance=distance
            old.normal.copy(n);old.point.copy(point);old.min.copy(lo);old.max.copy(hi)
          }else{
            stack.push({face,source,material,tag,area,plane,normal:n.clone(),point:point.clone(),min:lo.clone(),max:hi.clone(),distance})
          }
        }
      }
    }
  }
  if(active>=0)timeFor(active).milliseconds+=performance.now()-activeSince
  let count=0;for(const stack of stacks.values())count+=stack.length
  const width=256,height=Math.max(1,Math.ceil(count/width)),length=width*height*4
  const positions=new Float32Array(length),normals=new Float32Array(length),albedo=new Float32Array(length),boundsLo=new Uint8Array(length),boundsHi=new Uint8Array(length)
  const cells=new Uint32Array(dims[0]*dims[1]*dims[2]),faces:number[]=[],weights:number[]=[]
  let index=0
  // Publish nearby samples first. Initial sky rows serve the area around the viewer.
  const cameraCell=dims.map(d=>d/2)
  const order=(key:number)=>{const x=key%dims[0],y=Math.floor(key/dims[0])%dims[1],z=Math.floor(key/(dims[0]*dims[1]));return (x-cameraCell[0])**2+(y-cameraCell[1])**2+(z-cameraCell[2])**2}
  const ranked=Array.from(stacks,([key,stack])=>{
    let rank=order(key)
    if(viewProjection){
      const m=viewProjection,{x,y,z}=stack[0].point
      const clip=(k:number)=>m[k]*x+m[4+k]*y+m[8+k]*z+m[12+k]
      const w=clip(3)
      if(w<=0 || Math.abs(clip(0))>w || Math.abs(clip(1))>w || Math.abs(clip(2))>w)rank+=10000
    }
    return {key,rank}
  }).sort((a,b)=>a.rank-b.rank)
  for(const {key} of ranked){
    const stack=stacks.get(key)!
    stack.sort((a,b)=>(b.area+priority(b.tag))-(a.area+priority(a.tag)))
    if(stack.some(s=>Math.abs(s.normal.dot(stack[0].normal))<.94))conflicts.normal++
    if(stack.some(s=>s.material!==stack[0].material))conflicts.material++
    if(stack.some(s=>Math.abs(s.normal.dot(stack[0].normal))>.94 && Math.abs(s.normal.dot(stack[0].point)-s.plane)>.012))conflicts.separatedPlanes++
    cells[key]=index+1
    for(let k=0;k<stack.length;k++,index++){
      const s=stack[k],at=index*4,f=s.face
      timeFor(s.source).patches++
      faces[index]=f;tri.a.fromArray(data.positions,f*9);tri.b.fromArray(data.positions,f*9+3);tri.c.fromArray(data.positions,f*9+6)
      tri.getBarycoord(s.point,bary);bary.toArray(weights,index*3)
      const uv=(c:number)=>data.uvs[f*6+c]*bary.x+data.uvs[f*6+c+2]*bary.y+data.uvs[f*6+c+4]*bary.z
      albedo.set(sampleReferenceSurface(data,f,uv(0),uv(1),bary).rho,at)
      s.point.toArray(positions,at);positions[at+3]=s.material
      s.normal.toArray(normals,at);normals[at+3]=s.tag
      albedo[at+3]=k+1<stack.length?index+2:0
      for(let c=0;c<3;c++){
        boundsLo[at+c]=Math.max(0,Math.floor(127.5+127.5*(s.min.getComponent(c)-s.point.getComponent(c))/spacing))
        boundsHi[at+c]=Math.min(255,Math.ceil(127.5+127.5*(s.max.getComponent(c)-s.point.getComponent(c))/spacing))
      }
      boundsLo[at+3]=s.source&255;boundsHi[at+3]=(s.source>>8)&255
    }
  }
  const byName=new Map<string,{name:string;triangles:number;milliseconds:number;patches:number}>()
  for(const [id,row] of times){
    const name=data.sourceNames?.[id]??'Geometry',merged=byName.get(name)??{name,triangles:0,milliseconds:0,patches:0}
    merged.triangles+=row.triangles;merged.milliseconds+=row.milliseconds;merged.patches+=row.patches;byName.set(name,merged)
  }
  return {atlas:{origin,dimensions:dims,spacing,count,width,height,cells,positions,normals,albedo,boundsLo,boundsHi},faces,weights,conflicts,
    accounting:{occupied:stacks.size,dropped,culledTriangles,byCost:Array.from(byName.values()).sort((a,b)=>b.milliseconds-a.milliseconds).slice(0,24)}}
}
