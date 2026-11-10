/** Fixed-field diagnostic publication/performance test. No transport changes. */
import fs from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {DataUtils} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {createIndirectFloorLookup,writeIndirectFloorRow} from '../src/indirectFloorLighting.ts'
import {createIndirectVolumeLookup,writeIndirectVolumeRow} from '../src/indirectVolume.ts'
import {filterSoftGI,type SoftGIGraph} from './softGIFilter.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const out='docs/local-light',input=readDoorInput(),loaded=await loadIndirectLighting(JSON.parse(fs.readFileSync('docs/door-confidence/original-field.json','utf8')),{reflections:false,allowLegacy:true})
assert.ok(loaded);const field=loaded.field,visibility=createIndirectVisibilityFromSnapshot(input.geometry),floorOriginal=field.floorLayer.data.slice(),volumeOriginal=field.volume.data.slice(),metrics:any={memoryBefore:process.memoryUsage(),geometryQueriesAdditional:0,selection:'fixed four nearest active probes to 1m cell centre; coefficient-independent',maskVolume:'Not projected: positive-part irradiance is not an L1 field. Floor preview adds only the upward correction to L0; only upward floor appearance is validated.'}
const probes=field.probes.filter(p=>field.positionData[p.index*4+3]>=.5).map(p=>({index:p.index,position:Array.from(field.positionData.subarray(p.index*4,p.index*4+3))}))
const decoded=field.coefficients.map(a=>Float32Array.from(a,DataUtils.fromHalfFloat))
const saveTexture=(name:string,data:Uint16Array)=>fs.writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(data.buffer,data.byteOffset,data.byteLength)))
for(const kind of ['floor','volume']){
 const floor=kind==='floor',n=floor?field.floorLayer.n:field.volume.n,rows=floor?field.floors.length*n:field.volume.rows,result=new Float64Array(12)
 const lookup=floor?createIndirectFloorLookup(field,visibility):createIndirectVolumeLookup(field,visibility)
 const write=(row:number,fn:any,only=false)=>floor?writeIndirectFloorRow(field,row,visibility,fn,only):writeIndirectVolumeRow(field,row,result,visibility,fn,only)
 const start=performance.now();for(let row=0;row<rows;row++)write(row,lookup,true)
 const geometryMs=performance.now()-start;lookup.refreshCoefficients()
 let t=performance.now();for(let row=0;row<rows;row++)write(row,lookup)
 const productionMs=performance.now()-t,baseline=(floor?field.floorLayer.data:field.volume.data).slice()
 if(floor){let max=0;for(let i=0;i<baseline.length;i++)max=Math.max(max,Math.abs(DataUtils.fromHalfFloat(baseline[i])-DataUtils.fromHalfFloat(floorOriginal[i])));assert.ok(max<.002,'Reconstructed production field diverges');metrics.baselineMaxCoefficientError=max;saveTexture('baseline',floorOriginal)}
 t=performance.now();const graph=lookup.graph(),sets=new Map<string,Set<number>>();let localHits=0,fallbacks=0,classificationMs=0
 const flags=new Uint8Array(graph.indices.length),prepared=new Uint8Array(graph.counts.length)
 const classify=(x:number,y:number,z:number,voxel:number)=>{
  if(prepared[voxel])return
  const before=performance.now(),cell=[x,y,z].map(v=>Math.floor(v/(field.spacing/2))),key=cell.join(':')
  let ids=sets.get(key)
  if(!ids){const center=cell.map(v=>(v+.5)*field.spacing/2),distance=(p:typeof probes[number])=>p.position.reduce((s,v,i)=>s+(v-center[i])**2,0);ids=new Set([...probes].sort((a,b)=>distance(a)-distance(b)||a.index-b.index).slice(0,4).map(p=>p.index));sets.set(key,ids)}
  for(let i=graph.offsets[voxel],end=i+graph.counts[voxel];i<end;i++)flags[i]=ids.has(graph.indices[i])?1:0
  prepared[voxel]=1;classificationMs+=performance.now()-before
 }
 const local=new Float64Array(12),all=new Float64Array(12)
 const make=(masked:boolean,production=false)=>(_f:number,x:number,y:number,z:number,voxel:number,target:Float64Array)=>{
  if(!production)classify(x,y,z,voxel);local.fill(0);all.fill(0);let support=0,localSupport=0,count=0
  for(let i=graph.offsets[voxel],end=i+graph.counts[voxel];i<end;i++){
   const index=graph.indices[i],w=graph.weights[i];support+=w
   if(flags[i]){localSupport+=w;count++}
   for(let c=0;c<3;c++)for(let k=0;k<4;k++){const value=decoded[c][index*4+k]*w;all[c*4+k]+=value;if(flags[i])local[c*4+k]+=value}
  }
  const valid=!production&&count>=2&&localSupport>=.1
  if(valid)localHits++;else fallbacks++
  for(let k=0;k<12;k++)target[k]=valid?local[k]/localSupport:support?all[k]/support:0
  if(masked&&valid&&support>localSupport){const crossSupport=support-localSupport,coupling=crossSupport/support;for(let c=0;c<3;c++){
   const raw=.886227*target[c*4]+1.023328*target[c*4+1],e=Math.max(0,raw),cross=Math.max(0,(.886227*(all[c*4]-local[c*4])+1.023328*(all[c*4+1]-local[c*4+1]))/crossSupport)
   const correction=coupling*Math.max(0,cross-e)
   if(correction>0)target[c*4]+=(correction-Math.min(0,raw))/.886227
  }}
  return support
 }
 const graphExportMs=performance.now()-t,localLookup=make(false),maskLookup=make(true),compactProduction=make(false,true)
 t=performance.now();for(let row=0;row<rows;row++)write(row,compactProduction)
 const compactProductionMs=performance.now()-t;localHits=0;fallbacks=0
 t=performance.now();for(let row=0;row<rows;row++)write(row,localLookup)
 const coldLocalMs=performance.now()-t,localOutput=(floor?field.floorLayer.data:field.volume.data).slice()
 t=performance.now();for(let row=0;row<rows;row++)write(row,localLookup)
 const warmLocalMs=performance.now()-t
 let maskedMs:number|null=null
 if(floor){saveTexture('conservative',localOutput);t=performance.now();for(let row=0;row<rows;row++)write(row,maskLookup);maskedMs=performance.now()-t;saveTexture('masked',field.floorLayer.data)}
 // Measured coefficient-only update at the actual door footprint; visibility
 // and cell memberships remain valid. Geometry changes require cache invalidation.
 const incrementalStart=performance.now();let incrementalCells=0
 for(let iz=0;iz<n;iz++)for(let ix=0;ix<n;ix++){
  const x=field.bounds.minX+ix/(n-1)*field.bounds.size,z=field.bounds.minZ+iz/(n-1)*field.bounds.size
  if(x<1.1||x>2.3||z<14.2||z>15.4)continue
  const voxel=floor?iz*n+ix:(iz*12)*n+ix;localLookup(0,x,floor?.016:field.floors[0].elevation+.06,z,voxel,result);incrementalCells++
 }
 metrics[kind]={geometryMs,productionMs,compactProductionMs,graphExportMs,classificationMs,coldLocalMs,warmLocalMs,maskedMs,localHits,fallbacks,cells:graph.counts.length,links:graph.indices.length,additionalTypedBytes:flags.byteLength+prepared.byteLength+decoded.reduce((s,a)=>s+a.byteLength,0),exportedGraphBytes:graph.offsets.byteLength+graph.counts.byteLength+graph.indices.byteLength+graph.weights.byteLength,cellSets:sets.size,textureBytes:baseline.byteLength,incrementalCells,incrementalMs:performance.now()-incrementalStart,baselineLookup:lookup.statistics()}
 console.log(kind,metrics[kind])
 if(!floor)field.volume.data.set(volumeOriginal)
}
const meta=JSON.parse(fs.readFileSync('docs/soft-gi/original/graph.json','utf8')),readArray=(name:string,C:any)=>new C(Uint8Array.from(gunzipSync(fs.readFileSync(`docs/soft-gi/original/${name}.gz`))).buffer)
const graph:SoftGIGraph={...meta,valid:readArray('valid',Uint8Array),a:readArray('a',Uint32Array),b:readArray('b',Uint32Array),d2:readArray('d2',Float32Array)}
metrics.smoothing=[]
for(const mode of ['baseline','conservative','masked']){const data=new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${out}/${mode}.rgba16f.gz`))).buffer),filtered=filterSoftGI(data,graph,.1);saveTexture(`${mode}-10cm`,filtered.output);metrics.smoothing.push({mode,...filtered.statistics})}
metrics.memoryAfter=process.memoryUsage();metrics.additionalGpuTextureBytes=floorOriginal.byteLength;metrics.transportPasses=0
fs.writeFileSync(`${out}/bake-performance.json`,JSON.stringify(metrics,null,2));field.floorLayer.data.set(floorOriginal);field.dispose();visibility.dispose()
