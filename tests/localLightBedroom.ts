import fs from 'node:fs'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {restoreIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {createLocalLightSampler} from './localLightReconstruction.ts'
import {readLocalLightInput} from './localLightIO.mjs'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const out='docs/local-light',start=performance.now(),input=readLocalLightInput(`${out}/bedroom-input.bin.gz`),field=restoreIndirectField(input.field)
field.coefficients=input.coefficients
const visibility=createIndirectVisibilityFromSnapshot(input.geometry),reference=createSceneLightingReference(input.reference),sampler=createLocalLightSampler(field,visibility,true)
const saved=JSON.parse(fs.readFileSync('docs/bedroom-daylight/reference.json','utf8'))
const points=input.points.map((p:any,i:number)=>{
 const r=sampler.sample(p.samplePosition,p.normal,p.floor),expected=saved.reconstruction[i].exactAtShiftedSample.rgb
 r.variants.spatial.production.forEach((v,c)=>assert.ok(Math.abs(v-expected[c])<1e-7,`Frozen bedroom geometry replay mismatch at ${p.name}: ${v} / ${expected[c]}`))
 const ref=saved.sweeps[0].receivers[i]
 return {name:p.name,receiverPosition:p.position,samplingOffset:p.bias,reference:ref,referenceRGB:ref.sky.map((v:number,c:number)=>v+ref.reflected[c]),stored:saved.reconstruction[i].displayed.rgb,...r}
})
fs.writeFileSync(`${out}/bedroom.json`,JSON.stringify({points,counters:sampler.counters}))
console.log('bedroom six baselines matched',points.map((p:any)=>[p.name,p.variants.geometric.conservative[0]]))
const grid=[],normal=[0,1,0],floorY=input.points.find((p:any)=>p.name==='floor').samplePosition[1]
for(let iz=0;iz<=16;iz++)for(let ix=0;ix<=20;ix++){
 const position=[.05+ix*.2,floorY,11.05+iz*.2],name=`bedroom-grid-${ix}-${iz}`
 // Only actual floor surface locations, not samples outside this floor polygon.
 const floorHit=visibility.hit(new Vector3().fromArray(position),new Vector3(0,-1,0),.02,.0001)
 if(!floorHit||Math.abs(floorHit.point.y-(floorY-.004))>.002)continue
 const r=reference.evaluate({name,position,normal,geometricNormal:normal},4096,6,1234,6)
 grid.push({name,reference:r,referenceRGB:r.sky.map((v,c)=>v+r.reflected[c]),samplingOffset:.004,...sampler.sample(position,normal,true)})
 if(grid.length%40===0)console.log('bedroom dense grid',grid.length)
}
fs.writeFileSync(`${out}/bedroom-grid.json`,JSON.stringify({points:grid,step:.2,samples:4096,counters:sampler.counters,elapsedMs:performance.now()-start,memory:process.memoryUsage()}))
reference.dispose();visibility.dispose();field.dispose();console.log('bedroom grid done',grid.length)
