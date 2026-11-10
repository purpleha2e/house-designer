import fs from 'node:fs'
import crypto from 'node:crypto'
import {DataUtils,Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {gatherLocalIndirect,localFinalGatherEnabled} from './localFinalGather.ts'
import {readGatherInput} from './localFinalGatherInput.mjs'

if(!localFinalGatherEnabled(process.argv))throw Error('Diagnostic opt-in required: --local-final-gather')
const root='docs/local-final-gather';fs.mkdirSync(root,{recursive:true})
const json=(path)=>JSON.parse(fs.readFileSync(path,'utf8')),hash=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const tracked=['src/indirectVisibility.ts','src/indirectSegmentQuery.ts','src/indirectSurfaceCache.ts','src/indirectSurfaceRelighting.ts','src/indirectLighting.worker.ts','src/indirectLightingClient.ts','src/indirectFloorLighting.ts','src/indirectVolume.ts','src/indirectLightingShader.ts','src/indirectContinuousLighting.ts','src/indirectLightingZones.ts','src/components/IndirectLighting.tsx','src/components/ThreeDView.tsx','src/components/SoftFloorGI.tsx','src/components/SunBounceExperiment.tsx','src/materials/catalog/dulux-timeless-matt.json','colin_house_v2.json']
const sourceHashes=Object.fromEntries(tracked.map(path=>[path,hash(path)]));fs.writeFileSync(root+'/source-baseline.json',JSON.stringify(sourceHashes,null,2))
const sourceInput=json('docs/sunlit-bounce/inputs.json')
if(sourceHashes['colin_house_v2.json']!==sourceInput.sha256)throw Error('Saved diagnostic house differs from the current authored project')
const start=performance.now(),memBefore=process.memoryUsage()
console.log('Streaming geometry and cached radiance; skipping reference material images')
const sceneRead=await readGatherInput('docs/sunlit-bounce/scene-input.bin.gz',path=>path.startsWith('geometry.'))
const scene=sceneRead.data,cacheRead=await readGatherInput('docs/sunlit-bounce/cache-sources.bin.gz'),cache=cacheRead.data
const loadedAt=performance.now(),bvhat=performance.now(),visibility=createIndirectVisibilityFromSnapshot(scene.geometry),buildMs=performance.now()-bvhat
const identity={geometry:1,lighting:1,source:'surface-sun',bounces:1},results=[],metrics=[]
const tilesById=new Map(cache.tiles.map(tile=>[tile.index,tile])),pixelHits=new Map()
// Mirror only the existing snapshot's triangle order, without another geometry
// or acceleration structure. This is diagnostic provenance, not a new atlas.
const ownerByTriangle=[],rangeByTriangle=[];let owner=0,rangeId=0
for(const part of scene.geometry)for(const _matrix of part.matrices){for(const range of part.ranges){for(let t=0;t<Math.floor(range.count/3);t++){ownerByTriangle.push(owner);rangeByTriangle.push(rangeId)}rangeId++}owner++}
const capabilities={nearestHit:true,surfacePositions:'biased GI receiver positions',geometricNormals:false,shadingNormals:true,diffuseResponse:true,materialParameters:true,depthInLiveGPUCache:true,depthInSavedDiagnostic:false,primitiveIdentity:false,surfaceChartIdentity:false,sideIdentity:false,sourceSeparatedInNormalCache:false,matchedBounceSeparatedInNormalCache:false,productionWorkerOwnsBVH:true,workerGatherRequest:false}

function projected(tile,p){
 const dx=p.x-tile.position[0],dy=p.y-tile.position[1],dz=p.z-tile.position[2],ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz);let face,u,v
 if(ax>=ay&&ax>=az){face=dx>=0?0:1;u=(dx>=0?-dz:dz)/ax;v=dy/ax}
 else if(ay>=az){face=dy>=0?2:3;u=dx/ay;v=(dy>=0?-dz:dz)/ay}
 else{face=dz>=0?4:5;u=(dz>=0?dx:-dx)/az;v=dy/az}
 return{face,x:Math.max(0,Math.min(cache.size-1,Math.floor((u+1)*.5*cache.size))),y:Math.max(0,Math.min(cache.size-1,Math.floor((1-v)*.5*cache.size)))}
}
function inspectLookup(hit,direction){
 const p=hit.point,n=hit.face.normal.clone();if(n.dot(direction)>0)n.negate()
 let best
 // A generous 3x3 projection neighborhood measures spatial availability.
 // It cannot verify a surface, so it is never accepted as a radiance lookup.
 for(const tile of cache.tiles){const q=projected(tile,p),[ox,oy]=tile.faces[q.face]
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const x=q.x+dx,y=q.y+dy;if(x<0||y<0||x>=cache.size||y>=cache.size)continue
   const offset=((oy+y)*cache.width+ox+x)*4,nx=cache.normal[offset],ny=cache.normal[offset+1],nz=cache.normal[offset+2],length=Math.hypot(nx,ny,nz)
   if(length<.5)continue
   const cosine=(nx*n.x+ny*n.y+nz*n.z)/length;if(cosine<.9)continue
   const px=cache.receiver[offset]-p.x,py=cache.receiver[offset+1]-p.y,pz=cache.receiver[offset+2]-p.z,distance=Math.hypot(px,py,pz)
   if(!best||distance<best.distance)best={distance,planeDistance:Math.abs(px*n.x+py*n.y+pz*n.z),normalCosine:cosine,probe:tile.index,face:q.face,pixel:[ox+x,oy+y],receiverId:cache.receiver[offset+3],solar:0.2126*DataUtils.fromHalfFloat(cache.solar[offset])+0.7152*DataUtils.fromHalfFloat(cache.solar[offset+1])+0.0722*DataUtils.fromHalfFloat(cache.solar[offset+2])}
  }
 }
 if(best){
  const key=best.pixel.join(':'),tile=tilesById.get(best.probe),[ox,oy]=tile.faces[best.face]
  let projectedHit=pixelHits.get(key)
  if(projectedHit===undefined){
   const u=-1+(best.pixel[0]-ox+.5)*2/cache.size,v=1-(best.pixel[1]-oy+.5)*2/cache.size,f=best.face,coords=f===0?[1,v,-u]:f===1?[-1,v,u]:f===2?[u,1,-v]:f===3?[u,-1,v]:f===4?[u,v,1]:[-u,v,-1],d=new Vector3().fromArray(coords).normalize(),q=visibility.hit(new Vector3().fromArray(tile.position),d,80,.03)
   projectedHit=q?{primitive:q.faceIndex,owner:ownerByTriangle[Math.floor(q.face.a/3)],range:rangeByTriangle[Math.floor(q.face.a/3)],point:q.point.toArray(),side:q.face.normal.dot(d)<0?1:-1}:null;pixelHits.set(key,projectedHit)
  }
  const receiverSide=hit.face.normal.dot(direction)<0?1:-1
  best.geometryProjection=projectedHit?{samePrimitive:projectedHit.primitive===hit.faceIndex,sameOwner:projectedHit.owner===ownerByTriangle[Math.floor(hit.face.a/3)],sameMaterialRange:projectedHit.range===rangeByTriangle[Math.floor(hit.face.a/3)],sameSide:projectedHit.side===receiverSide,rawHitDistance:new Vector3().fromArray(projectedHit.point).distanceTo(hit.point)}:null
 }
 metrics.push({receiver:currentReceiver,ray:metrics.filter(m=>m.receiver===currentReceiver).length,hit:hit.point.toArray(),primitive:hit.faceIndex,best})
 return {valid:false,rgb:[0,0,0],identity,reason:'cache-has-no-primitive-or-side-identity'}
}
let currentReceiver=''
try{
 for(const point of scene.points){
  currentReceiver=point.name
  for(const rays of [8,16,32,64]){
   const before=metrics.length,result=gatherLocalIndirect({enabled:true,receiver:point,rays,seed:20261106,identity,visibility,lookup:inspectLookup})
   const samples=metrics.slice(before),distances=samples.flatMap(m=>m.best?[m.best.distance]:[]).sort((a,b)=>a-b),within=d=>distances.filter(v=>v<=d).length
   const projected=samples.flatMap(m=>m.best?.geometryProjection?[m.best.geometryProjection]:[])
   results.push({receiver:point.name,position:point.position,normal:point.normal,rays,...result,unverifiedCandidates:{count:distances.length,within2cm:within(.02),within5cm:within(.05),within10cm:within(.1),sameProjectedPrimitive:projected.filter(p=>p.samePrimitive&&p.sameSide).length,differentProjectedPrimitive:projected.filter(p=>!p.samePrimitive).length,differentProjectedOwner:projected.filter(p=>!p.sameOwner).length,differentProjectedMaterialRange:projected.filter(p=>!p.sameMaterialRange).length,medianDistance:distances.length?distances[Math.floor(distances.length*.5)]:null,p95Distance:distances.length?distances[Math.min(distances.length-1,Math.floor(distances.length*.95))]:null}})
   console.log(JSON.stringify({receiver:point.name,rays,state:result.state,confidence:result.confidence,traceMs:result.traceMs,lookupMs:result.lookupMs}))
  }
 }
}finally{visibility.dispose()}
const reference=json('docs/sunlit-bounce/reference.json'),production=json('docs/sunlit-bounce/production.json'),lum=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722
const baseline=scene.points.map(point=>{
 const full=production.variants.find(v=>v.name==='A'),off=production.variants.find(v=>v.name==='B'),rgb=full.receivers.find(p=>p.name===point.name).gi.map((v,c)=>v-off.receivers.find(p=>p.name===point.name).gi[c]),ref=reference.results.find(p=>p.name===point.name).solarContributions.find(v=>v.name==='duvet')
 const first=full.passes[0].receivers.find(p=>p.name===point.name).gi.map((v,c)=>v-off.passes[0].receivers.find(p=>p.name===point.name).gi[c])
 return {receiver:point.name,productionDuvetSun6:rgb,referenceDuvetSun6:ref.cumulative[5],productionY:lum(rgb),referenceY:lum(ref.cumulative[5]),relativeError:lum(rgb)/lum(ref.cumulative[5])-1,productionDuvetSun1:first,referenceDuvetSun1:ref.cumulative[0],referenceStandardError6:ref.standardError[5],localGather:null,hybrid:null,reason:'Checkpoint A failed; incomplete cache lookups cannot replace matched source lighting'}
})
const report={checkpoint:'A',decision:'stop-before-receiver-cache-and-shader-integration',reason:'Existing probe-view cache does not support verified first-hit surface/source/bounce lookups. Position/normal proximity cannot establish identity or side; unknown rays must not be treated as black.',capabilities,provenance:{source:sourceInput,sourceHashes,savedData:'Existing sunlit-bounce diagnostic export; source project hash matches the current authored file. Current live lighting state was not baked or changed.',referenceSamples:reference.samples},inputMemory:{scene:sceneRead.memory,cache:cacheRead.memory},timing:{inputReadMs:loadedAt-start,buildSingleExistingVisibilityMs:buildMs,totalMs:performance.now()-start},memory:{before:memBefore,after:process.memoryUsage()},results,baseline,rendering:{gpuBytes:0,productionChanges:0,receiverCache:false,shaderIntegration:false,bedMoveDemonstration:false,productionDefaultsChanged:false},limitations:['Strict gather irradiance and variance are unavailable when any ray has unknown radiance. Ray-count results measure lookup feasibility, not successful illumination convergence.','One standalone instance of the existing production visibility implementation is built from the frozen snapshot; no duplicate BVH or independent reference BVH is built in this process.','The live GI worker would need a new gather message to reuse its already-prepared BVH; this harness does not add that integration.','Historical independent reference is reused; it is not rerun or presented as a new measurement.','Live GPU depth can recover raw capture points, but does not supply surface/material chart identity or matched source/bounce attribution.','Surface cache regressions, render comparisons, receiver-spacing sweeps and incremental bed updates are gated by a successful accuracy proof and were not performed.']}
for(const [path,digest]of Object.entries(sourceHashes))if(hash(path)!==digest)throw Error('Production source changed during audit: '+path)
fs.writeFileSync(root+'/audit.json',JSON.stringify(report,null,2));fs.writeFileSync(root+'/lookup-samples.json',JSON.stringify(metrics,null,2))
fs.writeFileSync(root+'/ray-counts.csv',['receiver,rays,state,known,hits,confidence,trace_ms,lookup_ms,median_unverified_distance_m,p95_unverified_distance_m',...results.map(r=>[r.receiver,r.rays,r.state,r.known,r.hits,r.confidence,r.traceMs,r.lookupMs,r.unverifiedCandidates.medianDistance,r.unverifiedCandidates.p95Distance].join(','))].join('\n')+'\n')
console.log(JSON.stringify({checkpoint:report.checkpoint,decision:report.decision,loadedMiB:(sceneRead.memory.loadedBytes+cacheRead.memory.loadedBytes)/1048576,skippedMiB:sceneRead.memory.skippedBytes/1048576,rssMiB:report.memory.after.rss/1048576,totalMs:report.timing.totalMs}))
