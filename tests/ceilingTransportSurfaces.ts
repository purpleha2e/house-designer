import fs from 'node:fs'
import {readLocalLightInput} from './localLightIO.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const root='docs/ceiling-transport',read=(n:string)=>JSON.parse(fs.readFileSync(`${root}/${n}.json`,'utf8')),input=readLocalLightInput('docs/local-light/bedroom-input.bin.gz'),reference=createSceneLightingReference(input.reference),directional=read('directional-comparison'),replay=read('cpu-replay'),results=[]
// High-error directions plus opaque, matching-geometry interior controls. This
// selection affects diagnostics only, never production interpolation or capture.
const selections=[[429,822],[429,1525],[429,1494],[430,466],[430,995],[430,450],[441,1451],[441,435],[441,884],[440,1447],[308,900],[319,900]]
for(const [index,pixel]of selections){
 const p=directional.find((p:any)=>p.index===index).pixels.find((p:any)=>p.pixel===pixel)
 if(!p.firstHit)continue
 const geometric=p.firstHit.normal.map((v:number)=>v*(p.firstHit.normal.reduce((s:number,v:number,c:number)=>s+v*p.direction[c],0)>0?-1:1)),mapped=p.normal.slice(0,3),variants=[{name:'true-hit-geometric-normal',position:p.firstHit.point,normal:geometric},{name:'true-hit-cached-normal',position:p.firstHit.point,normal:mapped},{name:'biased-cache-position-cached-normal',position:p.receiver.slice(0,3),normal:mapped}],measurements=[]
 for(const encounters of [1,5])for(const v of variants){
  const q=reference.evaluate({...v,geometricNormal:v.normal},32768,encounters,42001+index*1009+pixel,encounters)
  const incident=q.sky.map((n:number,c:number)=>n+q.reflected[c]),production=replay[encounters-1].probes.find((q:any)=>q.index===index).pixels.find((q:any)=>q.pixel===pixel)
  measurements.push({encounters,variant:v.name,position:v.position,normal:v.normal,reference:q,incident,referenceOutgoing:p.first.map((n:number,c:number)=>n+p.response[c]*incident[c]),production})
 }
 results.push({index,pixel,direction:p,measurements});fs.writeFileSync(`${root}/surface-reference.json`,JSON.stringify(results));console.log('surface reference',index,pixel)
}
reference.dispose()
