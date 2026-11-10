import fs from 'node:fs'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {readFirstBounceInput} from './firstBounceTextures.mjs'
import {readGatherInput} from './localFinalGatherInput.mjs'
import {mapSunTriangles} from './firstBounceMapping.ts'
import {createSunHitMaterials,createSunSurfaceQuery,createDirectSunRadiance} from './firstBounceSun.ts'
import {gatherLocalIndirect} from './localFinalGather.ts'
if(!process.argv.includes('--first-bounce-sun'))throw Error('Diagnostic opt-in required')
const at=performance.now(),root='docs/first-bounce-sun',loaded=await readFirstBounceInput('docs/sunlit-bounce/scene-input.bin.gz',fs.mkdtempSync('tmp/first-bounce-textures-')),d=loaded.data,r=d.reference,{data}=await readGatherInput('docs/sunlit-bounce/reference-input.bin.gz',p=>p==='reference.sourceCategories'),owners=new Uint32Array(r.materialIndices.length)
process.once('exit',()=>loaded.close())
let count=0,owner=0;for(const part of d.geometry)for(const _instance of part.matrices){const n=part.ranges.reduce((s,g)=>s+Math.floor(g.count/3),0);owners.fill(owner++,count,count+n);count+=n}
const prepAt=performance.now(),visibility=createIndirectVisibilityFromSnapshot(d.geometry),bvhMs=performance.now()-prepAt,mappingAt=performance.now(),mapped=mapSunTriangles(visibility.snapshot().positions.subarray(0,count*9),r.positions,r.materialIndices,r.uvs,Uint8Array.from(data.reference.sourceCategories,v=>v===1?1:0),.000005,r.materials),mappingMs=performance.now()-mappingAt,resolve=createSunHitMaterials({...r,textures:loaded.textures,owners,triangleMap:mapped.mapping,legacyOpaqueDoubleSide:true}),query=createSunSurfaceQuery(visibility,resolve),identity={geometry:1,lighting:1,source:'surface-sun',bounces:1},rows=[]
const seeds=Array.from({length:8},(_,i)=>(20261106+Math.imul(i,2654435761))>>>0),median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]
try{
 for(const point of d.points)for(const rays of [8,16,32,64,128,256]){
  const trials=[]
  for(const seed of seeds){
   const a={...query.stats},m={...resolve.timings},sun=createDirectSunRadiance({query,sunDirection:r.sunDirection,sunIrradiance:r.sunIrradiance,daylightGain:r.daylightGain,identity}),beforeIO={...loaded.stats},result=gatherLocalIndirect({enabled:true,receiver:point,rays,seed,identity,visibility:query,lookup:sun.lookup})
   if(result.state!=='ready')throw Error('Unsupported sample in performance run: '+point.name)
   trials.push({seed,totalMs:result.totalMs,totalPerRayMs:result.totalMs/rays,nearestIntersectionMs:query.stats.traceMs-a.traceMs,materialEvaluationMs:query.stats.materialMs-a.materialMs,primitiveIdentificationMs:resolve.timings.identificationMs-m.identificationMs,barycentricUVms:resolve.timings.barycentricUVms-m.barycentricUVms,textureEvaluationMs:resolve.timings.textureMs-m.textureMs,diffuseResponseMs:resolve.timings.responseMs-m.responseMs,sunVisibilityInclusiveMs:sun.stats.sunVisibilityMs,radianceMs:sun.stats.radianceMs,textureDiskTiles:loaded.stats.reads-beforeIO.reads,unsupportedHits:sun.stats.unsupportedHits})
  }
  const summary=Object.fromEntries(Object.keys(trials[0]).filter(k=>k!=='seed').map(key=>[key,median(trials.map(t=>t[key]))]));rows.push({receiver:point.name,rays,median:summary,minTotalMs:Math.min(...trials.map(t=>t.totalMs)),maxTotalMs:Math.max(...trials.map(t=>t.totalMs)),trials})
 }
}finally{visibility.dispose()}
const output={method:'CPU performance pass with eight fixed nested sample shifts per receiver/ray count. Texture LRU cap is 2 MiB; existing texture readbacks are staged on disk. Timings include instrumentation; sun-visibility time is inclusive and overlaps nearest/material components.',preparation:{bvhMs,mappingMs,totalInputAndPreparationMs:performance.now()-at-rows.reduce((s,r)=>s+r.trials.reduce((n,t)=>n+t.totalMs,0),0)},rows,memory:process.memoryUsage(),textureIO:loaded.stats,totalMs:performance.now()-at,noRuntimeOrGPUIntegration:true}
fs.writeFileSync(root+'/performance.json',JSON.stringify(output,null,2));loaded.close();console.log(JSON.stringify({rows:rows.length,seconds:output.totalMs/1000,rssMiB:output.memory.rss/1048576}))
