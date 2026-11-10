import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {DataUtils,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {restoreIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {indirectFloorConfidence} from '../src/indirectFloorLighting.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
import {createLocalLightSampler,reconstructLocalLight,localDefinitions,type LocalLink} from './localLightReconstruction.ts'

if(!process.argv.includes('--diagnostic-local-light'))throw Error('Explicit --diagnostic-local-light required')
const out='docs/local-light';fs.mkdirSync(out,{recursive:true})
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'))
const save=(p:string,d:unknown)=>fs.writeFileSync(`${out}/${p}.json`,JSON.stringify(d))
const rgb=(r:any)=>r.sky.map((v:number,c:number)=>v+r.reflected[c])
const inputs=['docs/bedroom-daylight/completed-baseline-cache.json.gz','docs/bedroom-daylight/reference.json',...['original','moved','rotated'].flatMap(p=>[`docs/door-confidence/${p}-input.bin.gz`,`docs/door-confidence/${p}-results.json`])]
save('provenance',{date:'2026-11-04',inputs:inputs.map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),productionDefaultsChanged:false,transportRecomputed:false})
const ref=read('docs/bedroom-daylight/reference.json'),cache=JSON.parse(gunzipSync(fs.readFileSync(inputs[0])).toString()),loaded=await loadIndirectLighting(cache,{reflections:false,allowLegacy:true})
assert.ok(loaded);const field=loaded.field
const bedroom=ref.reconstruction.map((r:any,i:number)=>{
  const links:LocalLink[]=r.weightsAtBiasedPoint.probes.map((p:any)=>({index:p.index,position:p.position,distance:p.distance,spatialWeight:p.kernel,visible:p.visible,regionId:field.probes.find(q=>q.index===p.index)?.region.id??-1,coefficients:field.coefficients.flatMap(c=>Array.from(c.subarray(p.index*4,p.index*4+4),DataUtils.fromHalfFloat))}))
  const variants=Object.fromEntries(['spatial','cell-four'].map(key=>[key,reconstructLocalLight(links,r.shiftedPoint,r.normal,field.spacing,key as any,r.floorLayer)]))
  const production=(variants.spatial as any).production
  production.forEach((v:number,c:number)=>assert.ok(Math.abs(v-r.exactAtShiftedSample.rgb[c])<1e-7,'Bedroom baseline replay mismatch'))
  return {name:ref.sweeps[0].receivers[i].name,reference:ref.sweeps[0].receivers[i],referenceRGB:rgb(ref.sweeps[0].receivers[i]),receiverPosition:r.point,samplingOffset:r.bias,stored:r.displayed.rgb,variants}
})
save('bedroom-checkpoint',bedroom);field.dispose()
console.log('bedroom checkpoint',bedroom.map((p:any)=>({name:p.name,ref:p.referenceRGB[0],production:p.variants.spatial.production[0],spatial:p.variants.spatial.conservative[0],mask:p.variants.spatial.maskedRGB[0],four:p.variants['cell-four'].conservative[0]})))
if(process.argv.includes('--bedroom-only'))process.exit(0)
for(const pose of ['original','moved','rotated']){
 const start=performance.now(),input=readDoorInput(pose),field=restoreIndirectField(input.field);field.coefficients=input.coefficients
 const visibility=createIndirectVisibilityFromSnapshot(input.geometry),sampler=createLocalLightSampler(field,visibility,true),previous=read(`docs/door-confidence/${pose}-results.json`)
 const refined=pose==='original'?read('docs/door-confidence/original-notch-refined-results.json').points:[]
 const points=previous.points.map((p:any)=>{
   const result=sampler.sample(p.position)
   result.variants.spatial.production.forEach((v,c)=>assert.ok(Math.abs(v-p.variants.binary.rgb[c])<1e-7,'Door baseline replay mismatch'))
   const reference=refined.find((q:any)=>q.name===p.name)?.reference??p.reference
   return {name:p.name,kind:p.kind,reference,referenceRGB:rgb(reference),samplingOffset:.004,...result}
 })
 if(pose==='original'){
  const stairs=read('docs/soft-gi/staircase-reference.json').points.map((p:any)=>({name:p.name,kind:'staircase',reference:p.reference,referenceRGB:rgb(p.reference),samplingOffset:.004,...sampler.sample([p.position[0],p.position[1]+.004,p.position[2]])}))
  save('staircase',stairs)
 }
 // Independent production implementation validates replay with signed SH mixing.
 const coefficients=new Float64Array(12),basis=indirectSHIrradianceBasis(new Vector3(0,1,0),1)
 for(const p of points.filter((_:any,i:number)=>i%31===0)){
  const support=sampleIndirectCoefficients(field,0,...p.position as [number,number,number],coefficients,visibility)
  const expected=[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coefficients[c*4+k],0))*indirectFloorConfidence(support))
  expected.forEach((v,c)=>assert.ok(Math.abs(v-p.variants.spatial.production[c])<1e-7))
 }
 save(pose,{points,counters:sampler.counters,elapsedMs:performance.now()-start,memory:process.memoryUsage(),probeCount:field.probes.length,spacing:field.spacing,geometryKey:input.configuration})
 console.log(pose,'complete',points.length,sampler.counters)
 visibility.dispose();field.dispose()
}
