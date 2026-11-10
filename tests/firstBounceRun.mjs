import fs from 'node:fs'
import crypto from 'node:crypto'
import {Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {readGatherInput} from './localFinalGatherInput.mjs'
import {gatherLocalIndirect} from './localFinalGather.ts'
import {createSunHitMaterials,createSunSurfaceQuery,createDirectSunRadiance} from './firstBounceSun.ts'
import {readFirstBounceInput} from './firstBounceTextures.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {mapSunTriangles} from './firstBounceMapping.ts'

if(!process.argv.includes('--first-bounce-sun'))throw Error('Diagnostic opt-in required: --first-bounce-sun')
const root='docs/first-bounce-sun';fs.mkdirSync(root,{recursive:true})
const previous=process.argv.includes('--reuse-reference')?JSON.parse(fs.readFileSync(root+'/provenance.json','utf8')):undefined,previousReferences=previous?JSON.parse(fs.readFileSync(root+'/reference.json','utf8')):[]
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),json=p=>JSON.parse(fs.readFileSync(p,'utf8')),Y=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
const source=json('docs/sunlit-bounce/inputs.json'),baseline=json('docs/local-final-gather/source-baseline.json')
if(previous&&previous.source.sha256!==source.sha256)throw Error('Reference source project changed')
if(hash('colin_house_v2.json')!==source.sha256)throw Error('Current authored house differs from the frozen reference fixture')
const sourceHashes=Object.fromEntries(Object.keys(baseline).map(p=>[p,hash(p)]));fs.writeFileSync(root+'/source-baseline.json',JSON.stringify(sourceHashes,null,2))
const at=performance.now(),temp=fs.mkdtempSync('tmp/first-bounce-textures-'),loaded=await readFirstBounceInput('docs/sunlit-bounce/scene-input.bin.gz',temp),d=loaded.data,r=d.reference
process.once('exit',()=>loaded.close())
const tagged=await readGatherInput('docs/sunlit-bounce/reference-input.bin.gz',p=>['reference.sourceCategories','reference.positions','reference.uvs','reference.materialIndices'].includes(p))
for(const key of ['positions','uvs','materialIndices']){const a=r[key],b=tagged.data.reference[key];if(a.length!==b.length||!a.every((v,i)=>v===b[i]))throw Error('Tagged reference metadata differs: '+key)}
const categories=tagged.data.reference.sourceCategories,owners=new Uint32Array(r.materialIndices.length),ownerRanges=[];let triangleOffset=0,ownerId=0
for(let part=0;part<d.geometry.length;part++)for(let instance=0;instance<d.geometry[part].matrices.length;instance++){
 const count=d.geometry[part].ranges.reduce((n,g)=>n+Math.floor(g.count/3),0);owners.fill(ownerId,triangleOffset,triangleOffset+count);ownerRanges.push({owner:ownerId,part,instance,start:triangleOffset,count});triangleOffset+=count;ownerId++
}
if(triangleOffset!==r.materialIndices.length)throw Error('Triangle ownership count mismatch')
const inputMs=performance.now()-at,prepareAt=performance.now(),visibility=createIndirectVisibilityFromSnapshot(d.geometry),positions=visibility.snapshot().positions
const mappingAt=performance.now(),mapped=mapSunTriangles(positions.subarray(0,triangleOffset*9),r.positions,r.materialIndices,r.uvs,Uint8Array.from(categories,v=>v===1?1:0),.000005,r.materials),mappingMs=performance.now()-mappingAt
fs.writeFileSync(root+'/primitive-mapping.json',JSON.stringify({...mapped.stats,mappingMs,method:'triangle vertices verified within 5 micrometres after Float32 transform rounding; material/UV/source equivalence required; ambiguous mappings remain unsupported'},null,2))
const prepareMs=performance.now()-prepareAt,identity={geometry:1,lighting:1,source:'surface-sun',bounces:1}
const meta={positions:r.positions,uvs:r.uvs,materialIndices:r.materialIndices,owners,materials:r.materials,textures:loaded.textures,triangleMap:mapped.mapping,legacyOpaqueDoubleSide:true}
const resolve=createSunHitMaterials(meta),query=createSunSurfaceQuery(visibility,resolve),results=[],paired=[],mapping=[]
const seeds=Array.from({length:8},(_,i)=>(20261106+Math.imul(i,2654435761))>>>0),raysList=[8,16,32,64,128,256]
const moments=(samples,n)=>{const sum=[0,0,0],squares=[0,0,0];let sumY=0,squareY=0;for(const s of samples){for(let c=0;c<3;c++){sum[c]+=s[c];squares[c]+=s[c]*s[c]}const y=Y(s);sumY+=y;squareY+=y*y}return{rgb:sum.map(v=>v*Math.PI/n),Y:sumY*Math.PI/n,rayVariance:squares.map((v,c)=>n>1?Math.PI**2*Math.max(0,(v-sum[c]*sum[c]/n)/(n-1)):0),rayVarianceY:n>1?Math.PI**2*Math.max(0,(squareY-sumY*sumY/n)/(n-1)):0}}
function run(point,n,seed,keepPaired=false){
 const primary=[],duvet=[],qBefore={...query.stats},sun=createDirectSunRadiance({query,sunDirection:r.sunDirection,sunIrradiance:r.sunIrradiance,daylightGain:r.daylightGain,identity})
 const result=gatherLocalIndirect({enabled:true,receiver:point,rays:n,seed,identity,visibility:query,lookup:sun.lookup,observe(i,rgb,hit,direction){primary.push(rgb??[0,0,0]);const referenceTriangle=hit?mapped.mapping[Math.floor(hit.face.a/3)]:null,tag=referenceTriangle!==null?categories[referenceTriangle]:0;duvet.push(tag===1&&rgb?rgb:[0,0,0]);if(keepPaired)paired.push({receiver:point.name,index:i,direction:direction.toArray(),radiance:rgb,triangle:referenceTriangle,duvet:tag===1})}})
 const m=moments(primary,n),tag=moments(duvet,n),qAfter=query.stats
 return{...result,seed,...m,duvet:tag,unsupportedPercent:100*(sun.stats.unsupportedHits/n),validHits:sun.stats.validHits,unsupportedHits:sun.stats.unsupportedHits,sunVisibleHits:sun.stats.sunVisibleHits,sunOccludedHits:sun.stats.sunOccludedHits,materialEvaluationMs:qAfter.materialMs-qBefore.materialMs,nearestIntersectionMs:qAfter.traceMs-qBefore.traceMs,sunVisibilityMs:sun.stats.sunVisibilityMs,radianceMs:sun.stats.radianceMs,totalPerRayMs:result.totalMs/n,primitiveLookups:sun.samples.length,texturedHits:sun.samples.filter(s=>r.materials[s.materialId]?.map>=0).length}
}
try{
 console.log('B1: triangle/UV/material/owner mapping',JSON.stringify(mapped.stats))
 for(const point of d.points){
  const normal=new Vector3().fromArray(point.geometricNormal).normalize(),origin=new Vector3().fromArray(point.position).addScaledVector(normal,.005),direction=normal.clone().negate(),hit=query.hit(origin,direction,.02,.00001)
  if(!hit)throw Error('B1 receiver ownership ray missed '+point.name)
  const m=query.material(hit,direction);mapping.push({name:point.name,...m,hit:undefined,normal:m.normal.toArray(),material:r.materials[m.materialId],ownerRecord:ownerRanges[m.owner]})
  for(const n of raysList){const trials=seeds.map((seed,i)=>run(point,n,seed,n===256&&i===0)),primary=trials[0],mean=[0,1,2].map(c=>trials.reduce((s,t)=>s+t.rgb[c],0)/trials.length),meanY=Y(mean),varianceY=trials.reduce((s,t)=>s+(t.Y-meanY)**2,0)/(trials.length-1)
   const duetMean=[0,1,2].map(c=>trials.reduce((s,t)=>s+t.duvet.rgb[c],0)/trials.length),duvetMeanY=Y(duetMean),duvetVarianceY=trials.reduce((s,t)=>s+(t.duvet.Y-duvetMeanY)**2,0)/(trials.length-1)
   results.push({receiver:point.name,rays:n,primary,replicates:{count:trials.length,rgb:mean,Y:meanY,valid:trials.every(t=>t.state==='ready'),varianceY,standardErrorY:Math.sqrt(varianceY/trials.length),duvetRGB:duetMean,duvetY:duvetMeanY,duvetVarianceY,duvetStandardErrorY:Math.sqrt(duvetVarianceY/trials.length),seeds},trials});console.log(JSON.stringify({receiver:point.name,rays:n,Y:primary.Y,duvet:primary.duvet.Y,unsupported:primary.unsupportedHits,ms:primary.totalMs}))
  }
 }
 // A higher-count check is diagnostic validation, not an extra runtime target.
 // Preserve requested 8..256 results even if this process is interrupted later.
 fs.writeFileSync(root+'/convergence.json',JSON.stringify(results,null,2));fs.writeFileSync(root+'/hit-mapping.json',JSON.stringify(mapping,null,2));fs.writeFileSync(root+'/paired-directions.json',JSON.stringify(paired))
 const validation=[]
 for(const point of d.points){const trials=seeds.map((seed,i)=>run(point,4096,seed,i===0)),mean=[0,1,2].map(c=>trials.reduce((s,t)=>s+t.rgb[c],0)/trials.length),duvetMean=[0,1,2].map(c=>trials.reduce((s,t)=>s+t.duvet.rgb[c],0)/trials.length);validation.push({receiver:point.name,raysPerShift:4096,shifts:8,complete:trials.every(t=>t.state==='ready'),rgb:mean,Y:Y(mean),duvetRGB:duvetMean,duvetY:Y(duvetMean),trials});console.log('validation',point.name,Y(mean),Y(duvetMean))}
 fs.writeFileSync(root+'/validation.json',JSON.stringify(validation,null,2));fs.writeFileSync(root+'/paired-directions.json',JSON.stringify(paired))
}finally{visibility.dispose()}
console.log('Production BVH disposed; preparing the existing independent reference sequentially')
const referenceAt=performance.now(),referenceData={...r,textures:loaded.referenceTextures,sourceCategories:categories,skyBase:[0,0,0],skySun:[0,0,0],lights:[]},reference=createSceneLightingReference(referenceData),referenceRows=[],pairedChecks=[]
const samples=Number(process.env.FIRST_BOUNCE_REFERENCE_SAMPLES??262144)
try{
 for(const point of d.points){
  const start=performance.now(),old=previousReferences.find(row=>row.receiver===point.name&&row.samples>=samples),value=old?undefined:reference.evaluate(point,samples,1,0x317a21,1,true),all=value?.solarContributions[0],duvet=value?.solarContributions[1]
  referenceRows.push(old??{receiver:point.name,samples,rgb:all.cumulative[0],Y:Y(all.cumulative[0]),standardErrorRGB:all.standardError[0],duvetRGB:duvet.cumulative[0],duvetY:Y(duvet.cumulative[0]),duvetStandardErrorRGB:duvet.standardError[0],seconds:(performance.now()-start)/1000,rayCount:value.rays,directAtReceiverExcluded:value.direct,method:'existing independent scene reference, depth=1, maxEncounters=1; sky/ground/lamps zero'})
  const saved=paired.filter(p=>p.receiver===point.name),origin=new Vector3().fromArray(point.position).addScaledVector(new Vector3().fromArray(point.geometricNormal).normalize(),.0002),checks=reference.incoming(origin.toArray(),saved.map(p=>p.direction),1,0,11,true,1)
  let maxRGB=0,wrongPrimitive=0;for(let i=0;i<saved.length;i++){if(saved[i].triangle!==(checks[i].firstHit?.triangle??null))wrongPrimitive++;for(let c=0;c<3;c++)maxRGB=Math.max(maxRGB,Math.abs((saved[i].radiance?.[c]??0)-checks[i].firstPass[c]))}
  pairedChecks.push({receiver:point.name,rays:saved.length,maxRadianceDifference:maxRGB,wrongPrimitive})
  fs.writeFileSync(root+'/reference.json',JSON.stringify(referenceRows,null,2));fs.writeFileSync(root+'/paired-checks.json',JSON.stringify(pairedChecks,null,2));console.log('reference',point.name,referenceRows.at(-1).Y,referenceRows.at(-1).duvetY,'paired',maxRGB,wrongPrimitive)
 }
}finally{reference.dispose()}
const provenance={source,sourceHashes,independentReferenceReused:!!previous,originalReferenceCalculationSeconds:previous?.originalReferenceCalculationSeconds??previous?.performance.referenceSeconds,geometry:{triangles:triangleOffset,owners:ownerRanges.length,materials:r.materials.length,textures:loaded.textures.length,exactTriangleGeometryMapping:mapped.stats},settings:{sun:r.sunIrradiance,direction:r.sunDirection,daylightGain:r.daylightGain,referenceSky:source.settings?.skyStrength??1,receiverOffset:.0002,firstBounceOnly:true},legacyMaterialPolicy:{mode:'explicit existing-reference opaque/double-sided diffuse model',rendererSideAndOpacityMetadata:'not present in the old snapshot; not inferred per material',rendererAlphaAndSideParityVerified:false,normalPolicy:'geometric hit normal, oriented toward receiver, matching the independent reference',texturePolicy:'linear-sRGB half-float GPU texture readbacks; no second decode',unsupportedWithinReferenceModel:results.reduce((s,row)=>s+row.primary.unsupportedHits,0),limitation:'Numeric accuracy is for the explicit frozen reference model. Actual renderer alpha/side/normal-map/vertex-colour/metalness-map overrides were not captured and must be exported before a production-equivalence claim.'},performance:{inputMs,prepareMs,mappingMs,referenceSeconds:(performance.now()-referenceAt)/1000,totalSeconds:(performance.now()-at)/1000,memory:process.memoryUsage(),input:loaded.memory,textureIO:loaded.stats},noProductionChanges:true,noGPUOrBrowser:true}
for(const [p,h]of Object.entries(sourceHashes))if(hash(p)!==h)throw Error('Production input changed: '+p)
fs.writeFileSync(root+'/provenance.json',JSON.stringify(provenance,null,2));loaded.close();console.log('Completed first-bounce diagnostic; no runtime integration')
