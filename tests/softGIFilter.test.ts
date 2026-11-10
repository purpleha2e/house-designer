import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene} from 'three'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {prepareSoftGIGraph,filterSoftGI} from './softGIFilter.ts'

function fixture(kind:string){
 const n=31,floors=kind==='storeys'||kind==='slab'?2:1,scene=new Scene(),material=new MeshStandardMaterial(),boxes:Mesh[]=[]
 const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const m=new Mesh(new BoxGeometry(sx,sy,sz),material);m.position.set(x,y,z);scene.add(m);boxes.push(m)}
 for(let f=0;f<floors;f++){
  if(kind==='hole'){box(.2,f*3-.02,.6,.4,.04,1.2);box(1,f*3-.02,.6,.4,.04,1.2);box(.6,f*3-.02,.2,.4,.04,.4);box(.6,f*3-.02,1,.4,.04,.4)}
  else box(.6,f*3-.02,.6,1.2,.04,1.2)
 }
 if(['thin-wall','closed-door','window'].includes(kind))box(.6,1,.6,kind==='thin-wall'?.006:.04,2,1.3)
 if(kind==='slab')box(.6,1.5,.6,1.2,.006,1.2)
 if(kind==='cabinet')box(.8,.4,.6,.6,.6,.6)
 if(kind==='open-door'){box(.6,1,.2,.006,2,.4);box(.6,1,1,.006,2,.4)}
 const data=new Uint16Array(n*n*floors*16)
 for(let f=0;f<floors;f++)for(let z=0;z<n;z++)for(let x=0;x<n;x++)for(let k=0;k<4;k++){
  const o=((z*floors*4+k*floors+f)*n+x)*4;for(let c=0;c<3;c++)data[o+c]=DataUtils.toHalfFloat(k===0?(f?3:x<n/2?.2:1.2):0);data[o+3]=DataUtils.toHalfFloat(1)
 }
 const field={shOrder:1,bounds:{minX:0,minZ:0,size:1.2},floors:Array.from({length:floors},(_,i)=>({elevation:i*3})),floorLayer:{n,data}} as any
 scene.updateMatrixWorld(true);const visibility=createIndirectVisibility(scene),graph=prepareSoftGIGraph(field,visibility)
 return{field,graph,dispose(){visibility.dispose();boxes.forEach(m=>m.geometry.dispose());material.dispose()}}
}
test('constant signed SH remains bit-identical at all radii, including geometry boundaries',()=>{
 const f=fixture('thin-wall');try{const source=f.field.floorLayer.data as Uint16Array;for(let i=0;i<source.length;i+=4){source[i]=DataUtils.toHalfFloat(.5);source[i+1]=DataUtils.toHalfFloat(-.125);source[i+2]=DataUtils.toHalfFloat(.25)}for(const r of [.05,.1,.2])assert.deepEqual(filterSoftGI(source,f.graph,r).output,source)}finally{f.dispose()}
})
for(const kind of ['thin-wall','closed-door','window','slab','storeys'])test(`${kind}: no added exchange across a solid barrier or between storeys`,()=>{
 const f=fixture(kind);try{const source=f.field.floorLayer.data as Uint16Array,out=filterSoftGI(source,f.graph,.2).output
 if(kind==='storeys'||kind==='slab'){const n=f.graph.n;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const o=((z*8+1)*n+x)*4;assert.equal(out[o],source[o])}}
 else assert.deepEqual(out,source)
 }finally{f.dispose()}
})
test('open doorway permits smoothing, with no values beyond the source range',()=>{
 const f=fixture('open-door');try{const source=f.field.floorLayer.data as Uint16Array,out=filterSoftGI(source,f.graph,.2).output;assert.notDeepEqual(out,source);for(let i=0;i<out.length;i+=4){const v=DataUtils.fromHalfFloat(out[i]);assert.ok(v>=0&&v<=1.201)}}finally{f.dispose()}
})
test('floor hole cannot connect across unsupported samples',()=>{
 const f=fixture('hole');try{const n=f.graph.n;for(let e=0;e<f.graph.a.length;e++){const a=f.graph.a[e],b=f.graph.b[e];assert.ok(f.graph.valid[a]&&f.graph.valid[b]);const x=((a%n)+(b%n))*.02,z=(Math.floor(a/n)+Math.floor(b/n))*.02;assert.ok(!(x>.4&&x<.8&&z>.4&&z<.8))}}finally{f.dispose()}
})
test('low cabinet contact boundary is excluded geometrically',()=>{
 const f=fixture('cabinet');try{assert.ok(f.graph.statistics.rejectedContact>0);const out=filterSoftGI(f.field.floorLayer.data,f.graph,.2);assert.ok(out.output.every((v:number)=>Number.isFinite(DataUtils.fromHalfFloat(v))))}finally{f.dispose()}
})
test('repeated requests use immutable source; partial update matches full output exactly',()=>{
 const f=fixture('open-door');try{const source=f.field.floorLayer.data as Uint16Array,backup=source.slice(),full=filterSoftGI(source,f.graph,.1).output,repeated=filterSoftGI(source,f.graph,.1).output;assert.deepEqual(source,backup);assert.deepEqual(repeated,full)
 const bounds={floor:0,minX:10,maxX:20,minZ:10,maxZ:20},partial=filterSoftGI(source,f.graph,.1,'sh',bounds).output,n=f.graph.n
 for(let z=0;z<n;z++)for(let x=0;x<n;x++)for(let k=0;k<4;k++)for(let c=0;c<4;c++){const i=((z*4+k)*n+x)*4+c;assert.equal(partial[i],x>=10&&x<=20&&z>=10&&z<=20?full[i]:source[i])}
 }finally{f.dispose()}
})
test('changed source patches compose over the previous filtered field and cache restoration is deterministic',()=>{
 const f=fixture('open-door');try{const source=f.field.floorLayer.data as Uint16Array,previous=filterSoftGI(source,f.graph,.1).output,changed=source.slice(),n=f.graph.n
 changed[((15*4)*n+14)*4]=DataUtils.toHalfFloat(.7)
 const full=filterSoftGI(changed,f.graph,.1).output,bounds={floor:0,minX:10,maxX:20,minZ:10,maxZ:20},partial=filterSoftGI(changed,f.graph,.1,'sh',bounds).output,merged=previous.slice()
 for(let z=10;z<=20;z++)for(let x=10;x<=20;x++)for(let k=0;k<4;k++){const o=((z*4+k)*n+x)*4;merged.set(partial.subarray(o,o+4),o)}
 assert.deepEqual(merged,full);assert.deepEqual(filterSoftGI(changed.slice(),f.graph,.1).output,full)
 }finally{f.dispose()}
})
