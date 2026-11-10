import fs from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {readDoorInput} from './doorPipelineInput.mjs'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {prepareSoftGIGraph,filterSoftGI,type SoftGIGraph} from './softGIFilter.ts'
import {Vector3,DataUtils} from 'three'
import {sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
const pose=process.argv[2]??'original',out=`docs/soft-gi/${pose}`;if(!['original','moved','rotated'].includes(pose))throw Error('Invalid pose');fs.mkdirSync(out,{recursive:true})
// Read the unchanged lossless geometry snapshot from the earlier investigation.
const input=readDoorInput(pose),loaded=await loadIndirectLighting(JSON.parse(fs.readFileSync(`docs/door-confidence/${pose}-field.json`,'utf8')),{reflections:false,allowLegacy:true}),field=loaded!.field,original=field.floorLayer.data.slice(),start=performance.now()
let graph:SoftGIGraph
if(process.argv.includes('--reuse-graph')){
 const meta=JSON.parse(fs.readFileSync(`${out}/graph.json`,'utf8')),read=(name:string,C:any)=>new C(Uint8Array.from(gunzipSync(fs.readFileSync(`${out}/${name}.gz`))).buffer)
 graph={...meta,valid:read('valid',Uint8Array),a:read('a',Uint32Array),b:read('b',Uint32Array),d2:read('d2',Float32Array)}
}else{
 const visibility=createIndirectVisibilityFromSnapshot(input.geometry)
 console.log('geometry ready',performance.now()-start)
 graph=prepareSoftGIGraph(field,visibility,.2,v=>console.log('prepare',v));visibility.dispose()
 const{a,b,d2,valid,...meta}=graph;fs.writeFileSync(`${out}/graph.json`,JSON.stringify(meta,null,2))
 for(const[name,array]of Object.entries({a,b,d2,valid}))fs.writeFileSync(`${out}/${name}.gz`,gzipSync(Buffer.from(array.buffer)))
}
fs.writeFileSync(`${out}/baseline.rgba16f.gz`,gzipSync(Buffer.from(original.buffer)))
const reference=JSON.parse(fs.readFileSync(`docs/door-confidence/${pose}-results.json`,'utf8')),results=[]
const normals=[[0,1,0],[1,0,0],[0,0,1],[0,-1,0]],evaluate=(data:Uint16Array)=>{field.floorLayer.data=data as typeof field.floorLayer.data;return reference.points.map((p:any)=>({name:p.name,kind:p.kind,position:p.position,values:normals.map(n=>sampleBakedIndirectFloor(field,0,new Vector3().fromArray(p.position),new Vector3().fromArray(n)).rgb),reference:p.reference}))}
results.push({id:'baseline',points:evaluate(original)})
for(const radius of [.05,.1,.2]){
 const filtered=filterSoftGI(original,graph,radius),id=`${Math.round(radius*100)}cm`
 fs.writeFileSync(`${out}/${id}.rgba16f.gz`,gzipSync(Buffer.from(filtered.output.buffer)))
 const upward=filterSoftGI(original,graph,radius,'upward')
 let upMax=0,horizontalMax=0;const shPoints=evaluate(filtered.output),rgbPoints=evaluate(upward.output)
 shPoints.forEach((p:any,i:number)=>p.values.forEach((v:number[],k:number)=>v.forEach((v,c)=>{if(k===0)upMax=Math.max(upMax,Math.abs(v-rgbPoints[i].values[k][c]));else horizontalMax=Math.max(horizontalMax,Math.abs(v-rgbPoints[i].values[k][c]))})))
 results.push({id,radius,statistics:filtered.statistics,upwardComparison:{statistics:upward.statistics,upMax,horizontalMax,points:rgbPoints},points:shPoints})
 console.log('filtered',pose,id,filtered.statistics)
}
// Incremental output cells: radius expansion of a 40cm door-edit footprint.
const grid=(v:number,min:number)=>Math.round((v-min)/graph.step),bounds={floor:0,minX:grid(1.1,field.bounds.minX),maxX:grid(2.3,field.bounds.minX),minZ:grid(14.2,field.bounds.minZ),maxZ:grid(15.4,field.bounds.minZ)}
const incremental=filterSoftGI(original,graph,.1,'sh',bounds),full=gunzipSync(fs.readFileSync(`${out}/10cm.rgba16f.gz`)),expected=new Uint16Array(Uint8Array.from(full).buffer);let mismatch=0
for(let z=bounds.minZ;z<=bounds.maxZ;z++)for(let x=bounds.minX;x<=bounds.maxX;x++)for(let k=0;k<4;k++)for(let c=0;c<4;c++){const o=((z*graph.floors*4+k*graph.floors)*graph.n+x)*4+c;if(incremental.output[o]!==expected[o])mismatch++}
const metrics={pose,graph:graph.statistics,dimensions:{n:graph.n,floors:graph.floors,step:graph.step,bounds:field.bounds,elevations:field.floors.map(f=>f.elevation),textureBytes:original.byteLength},results,incremental:{bounds,statistics:incremental.statistics,mismatch},elapsedMs:performance.now()-start,memory:process.memoryUsage(),scope:'Completed floor coefficients only; original field, probes, direct light, volume and caches remain unchanged. Graph invalidated by geometry changes, reused for coefficient changes.'}
fs.writeFileSync(`${out}/measurements.json`,JSON.stringify(metrics));field.floorLayer.data=original;field.dispose();console.log('complete',pose)

