import {DataUtils,Vector3} from 'three'
import type {IndirectVisibility} from './indirectVisibility.ts'

export type SoftGIField={shOrder:number;bounds:{minX:number;minZ:number;size:number};floors:{elevation:number}[];floorLayer:{n:number;data:Uint16Array}}

export type SoftGIGraph={n:number;floors:number;step:number;valid:Uint8Array;a:Uint32Array;b:Uint32Array;d2:Float32Array;statistics:Record<string,number>}
export type SoftGIBounds={floor:number;minX:number;maxX:number;minZ:number;maxZ:number}
const textureOffset=(cell:number,band:number,n:number,floors:number)=>{const f=Math.floor(cell/(n*n)),q=cell%(n*n),z=Math.floor(q/n),x=q%n;return((z*floors*4+band*floors+f)*n+x)*4}
const plans=new WeakMap<SoftGIGraph,Map<number,{degree:Float32Array;weights:Float32Array;edges:Uint32Array}>>()
const layouts=new WeakMap<SoftGIGraph,{active:Uint32Array;packed:Int32Array}>()
const decoded=new WeakMap<Uint16Array,Map<SoftGIGraph,Float32Array>>()

/** Diagnostic preparation, never a shader query. Each undirected link has a
 * clear near-zero-bias segment and continuous floor support. Floor ownership
 * is the storey, not the room label. Reuse the graph while geometry is fixed. */
export function prepareSoftGIGraph(field:SoftGIField,visibility:Pick<IndirectVisibility,'hit'|'occluded'>,maxRadius=.2,progress?:(v:unknown)=>void,update?:{previous:SoftGIGraph;bounds:SoftGIBounds}):SoftGIGraph{
 if(field.shOrder!==1)throw Error('Soft filter requires existing L1 field')
 const start=performance.now(),n=field.floorLayer.n,floors=field.floors.length,step=field.bounds.size/(n-1),cells=n*n*floors,valid=new Uint8Array(cells),height=new Float32Array(cells),faceIds=new Int32Array(cells).fill(-1),overhead=new Float32Array(cells),p=new Vector3(),d=new Vector3(),down=new Vector3(0,-1,0),up=new Vector3(0,1,0)
 let queries=0,supportChecks=0,rejectedBarrier=0,rejectedSupport=0,rejectedContact=0
 const floorHit=(x:number,z:number,f:number)=>{supportChecks++;p.set(x,field.floors[f].elevation+.04,z);return visibility.hit(p,down,.07,.00001)}
 for(let f=0;f<floors;f++)for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const i=(f*n+z)*n+x,o=textureOffset(i,0,n,floors)
  if(DataUtils.fromHalfFloat(field.floorLayer.data[o+3])<.999)continue
  const wx=field.bounds.minX+x*step,wz=field.bounds.minZ+z*step,hit=floorHit(wx,wz,f)
  if(!hit||Math.abs(hit.face?.normal.y??0)<.9||Math.abs(hit.point.y-field.floors[f].elevation)>.035)continue
  valid[i]=1;height[i]=hit.point.y;faceIds[i]=hit.faceIndex??-1
  p.set(wx,hit.point.y+.004,wz);const ceiling=visibility.hit(p,up,.5,.0001);queries++;overhead[i]=ceiling?.distance??.5
 }
 const offsets=[];for(let z=0;z<=Math.ceil(maxRadius/step);z++)for(let x=-Math.ceil(maxRadius/step);x<=Math.ceil(maxRadius/step);x++){const d2=(x*x+z*z)*step*step;if((z>0||x>0)&&d2<=maxRadius**2+1e-10)offsets.push({x,z,d2})}
 const aa:number[]=[],bb:number[]=[],dd:number[]=[]
 const inside=(cell:number)=>{if(!update)return true;const f=Math.floor(cell/(n*n)),q=cell%(n*n),x=q%n,z=Math.floor(q/n),b=update.bounds;return (b.floor<0||f===b.floor)&&x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ}
 let retainedPairs=0
 if(update){const old=update.previous;if(old.n!==n||old.floors!==floors||old.step!==step)throw Error('Incremental geometry requires identical grid');for(let i=0;i<valid.length;i++)if(!inside(i)&&valid[i]!==old.valid[i])throw Error('Geometry edit exceeds supplied dirty bounds');for(let e=0;e<old.a.length;e++)if(!inside(old.a[e])&&!inside(old.b[e])){aa.push(old.a[e]);bb.push(old.b[e]);dd.push(old.d2[e]);retainedPairs++}}
 for(let f=0;f<floors;f++)for(let z=0;z<n;z++){
  const reach=Math.ceil(maxRadius/step)
  if(update&&((update.bounds.floor>=0&&f!==update.bounds.floor)||z<update.bounds.minZ-reach||z>update.bounds.maxZ+reach))continue
  if(z%60===0)progress?.({floor:f,row:z,n})
  for(let x=0;x<n;x++){
   if(update&&(x<update.bounds.minX-reach||x>update.bounds.maxX+reach))continue
   const i=(f*n+z)*n+x;if(!valid[i])continue
   for(const o of offsets){const xx=x+o.x,zz=z+o.z;if(xx<0||xx>=n||zz>=n)continue
    const j=(f*n+zz)*n+xx;if(update&&!inside(i)&&!inside(j))continue;if(!valid[j]||Math.abs(height[i]-height[j])>.015)continue
    // Preserve near-contact regions under low furniture rather than mixing
    // them with exposed floor. Both conditions are geometric and symmetric.
    if(Math.min(overhead[i],overhead[j])<.25&&Math.abs(overhead[i]-overhead[j])>.05){rejectedContact++;continue}
    const ax=field.bounds.minX+x*step,az=field.bounds.minZ+z*step,bx=field.bounds.minX+xx*step,bz=field.bounds.minZ+zz*step,len=Math.sqrt(o.d2+(height[j]-height[i])**2)
    p.set(ax,height[i]+.004,az);d.set(bx-ax,height[j]-height[i],bz-az).divideScalar(len);queries++
    if(visibility.occluded(p,d,len-.00001,.00001)){rejectedBarrier++;continue}
    // All crossed grid cells must contain a supported floor sample. A common
    // triangle certifies continuous support because a triangle is convex.
    let safe=true;const steps=Math.ceil(len/.01)
    for(let k=1;k<steps;k++){const t=k/steps,gx=Math.round(x+o.x*t),gz=Math.round(z+o.z*t);if(!valid[(f*n+gz)*n+gx]){safe=false;break}}
    if(!safe){rejectedSupport++;continue}
    if(faceIds[i]!==faceIds[j]||faceIds[i]<0)for(let k=1;k<steps;k++){const t=k/steps,hit=floorHit(ax+(bx-ax)*t,az+(bz-az)*t,f);if(!hit||Math.abs(hit.point.y-(height[i]+(height[j]-height[i])*t))>.015){safe=false;break}}
    if(!safe){rejectedSupport++;continue}
    aa.push(i);bb.push(j);dd.push(o.d2)
   }
  }
 }
 const a=new Uint32Array(aa),b=new Uint32Array(bb),d2=new Float32Array(dd)
 return{n,floors,step,valid,a,b,d2,statistics:{preparationMs:performance.now()-start,queries,supportChecks,rejectedBarrier,rejectedSupport,rejectedContact,retainedPairs,validCells:valid.reduce((s,v)=>s+v,0),pairs:a.length,bytes:valid.byteLength+a.byteLength+b.byteLength+d2.byteLength}}
}

/** Symmetric normalized Gaussian exchange. The same weight is applied in both
 * directions; each row sums to one after its self-weight. This preserves a
 * constant field AND the sum of every signed coefficient before quantization.
 * Always receives the immutable original, never a previously filtered output. */
export function filterSoftGI(original:Uint16Array,graph:SoftGIGraph,radius:number,mode:'sh'|'upward'='sh',bounds?:{floor:number;minX:number;maxX:number;minZ:number;maxZ:number}){
 const started=performance.now(),{n,floors,a,b,d2}=graph,cells=n*n*floors,sigma=radius/2
 let layout=layouts.get(graph);if(!layout){const active=new Uint32Array(Array.from(graph.valid,(_,i)=>i).filter(i=>graph.valid[i])),packed=new Int32Array(cells).fill(-1);active.forEach((cell,i)=>packed[cell]=i);layout={active,packed};layouts.set(graph,layout)}
 let map=plans.get(graph);if(!map){map=new Map();plans.set(graph,map)}let plan=map.get(radius);const reusedPlan=!!plan
 if(!plan){const degree=new Float32Array(cells).fill(1),weights=new Float32Array(a.length),edges=[];for(let e=0;e<a.length;e++)if(d2[e]<=radius*radius+1e-9){const w=Math.exp(-d2[e]/(2*sigma*sigma));weights[e]=w;degree[a[e]]+=w;degree[b[e]]+=w;edges.push(e)}plan={degree,weights,edges:new Uint32Array(edges)};map.set(radius,plan)}
 const{degree,weights,edges}=plan,planMs=performance.now()-started
 let sources=decoded.get(original);if(!sources){sources=new Map();decoded.set(original,sources)}let source=sources.get(graph);const reusedSource=!!source
 if(!source){source=new Float32Array(layout.active.length*12);layout.active.forEach((cell,i)=>{for(let k=0;k<4;k++){const o=textureOffset(cell,k,n,floors);for(let c=0;c<3;c++)source![i*12+k*3+c]=DataUtils.fromHalfFloat(original[o+c])}});sources.set(graph,source)}
 const result=source.slice(),affected=(i:number)=>{if(!bounds)return true;const f=Math.floor(i/(n*n)),q=i%(n*n),x=q%n,z=Math.floor(q/n);return (bounds.floor<0||f===bounds.floor)&&x>=bounds.minX&&x<=bounds.maxX&&z>=bounds.minZ&&z<=bounds.maxZ}
 let links=0
 for(const e of edges){
  const i=a[e],j=b[e],ai=affected(i),aj=affected(j);if(!ai&&!aj)continue
  const w=weights[e]/Math.max(degree[i],degree[j]);links++
  const oi=layout.packed[i]*12,oj=layout.packed[j]*12
  if(mode==='sh')for(let k=0;k<12;k++){const delta=w*(source[oj+k]-source[oi+k]);if(ai)result[oi+k]+=delta;if(aj)result[oj+k]-=delta}
  else for(let c=0;c<3;c++){const ei=Math.max(0,.886227*source[oi+c]+1.023328*source[oi+3+c]),ej=Math.max(0,.886227*source[oj+c]+1.023328*source[oj+3+c]),delta=w*(ej-ei)/.886227;if(ai)result[oi+c]+=delta;if(aj)result[oj+c]-=delta}
 }
 const output=original.slice();let changed=0,maxDelta=0
 layout.active.forEach((cell,i)=>{if(!affected(cell))return;for(let k=0;k<4;k++){const o=textureOffset(cell,k,n,floors);for(let c=0;c<3;c++){const p=i*12+k*3+c;if(result[p]!==source[p]){output[o+c]=DataUtils.toHalfFloat(result[p]);if(output[o+c]!==original[o+c])changed++;maxDelta=Math.max(maxDelta,Math.abs(result[p]-source[p]))}}}})
 return{output,statistics:{filterMs:performance.now()-started,planMs,reusedPlan,reusedSource,radius,sigma,links,changedComponents:changed,maxCoefficientDelta:maxDelta,workingBytes:source.byteLength+result.byteLength+degree.byteLength+weights.byteLength+edges.byteLength+layout.active.byteLength+layout.packed.byteLength+output.byteLength},mode}
}
