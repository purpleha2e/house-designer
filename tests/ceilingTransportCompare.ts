import fs from 'node:fs'
import {DataUtils,Vector3} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
import {restoreIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {createIndirectVolumeLookup,writeIndirectVolumeRow} from '../src/indirectVolume.ts'
import {createIndirectFloorLookup,writeIndirectFloorLayer,sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
import {sampleDisplayedIndirect} from '../src/indirectLightingDiagnostic.ts'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../src/indirectSH.ts'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const root='docs/ceiling-transport',out=root+(process.argv.includes('--exterior-sky-candidate')?'/exterior-sky-candidate':''),read=(n:string,dir=out)=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`,'utf8')),trace=read('production-trace'),audit=read('baseline-audit',root),input=readLocalLightInput('docs/local-light/bedroom-input.bin.gz')
const reference=new Map<number,any>(trace.passes[0].probes.map((p:any)=>[p.index,read(`reference-probe-${p.index}`,root)])),normal=new Vector3(0,-1,0),basis=indirectSHIrradianceBasis(normal,1)
const integrate=(q:any,rgb:number[][])=>{
 const factor=4*Math.PI/q.quadrature.reduce((s:number,p:any)=>s+p.weight,0)
 const coefficients=Array.from({length:4},(_,k)=>[0,1,2].map(c=>q.quadrature.reduce((s:number,p:any,i:number)=>s+p.weight*factor*indirectSHRadianceBasis(new Vector3().fromArray(p.direction),1)[k]*rgb[i][c],0)))
 return{raw:[0,1,2].map(c=>q.quadrature.reduce((s:number,p:any,i:number)=>s+p.weight*factor*Math.max(0,-p.direction[1])*rgb[i][c],0)),l1:[0,1,2].map(c=>Math.max(0,coefficients.reduce((s,a,k)=>s+a[c]*basis[k],0))),coefficients}
}
const rgb=(p:any)=>p.faces.flatMap((f:any)=>Array.from({length:256},(_,i)=>f.radiance.slice(i*4,i*4+3)))
const passes=trace.passes.map((pass:any)=>{
 const probes=pass.probes.map((p:any)=>{const q=reference.get(p.index),production=integrate(q,rgb(p)),ref=q.passes[pass.pass-1],stored=p.coefficients.map((a:number[])=>Math.max(0,a.reduce((s,v,k)=>s+v*basis[k],0)))
 return{index:p.index,production,reference:ref,stored,projectionQuantizationError:stored.map((v:number,c:number)=>v-production.l1[c])}})
 // Interpolate signed coefficients, then clamp once, exactly as production does.
 const blend=(key:'production'|'reference',mode:'raw'|'l1')=>[0,1,2].map(c=>Math.max(0,audit.candidates.reduce((s:number,p:any)=>{const q=probes.find((q:any)=>q.index===p.index)?.[key];return s+p.normalizedWeight*(q?(mode==='raw'?q.raw[c]:q.coefficients.reduce((v:number,a:number[],k:number)=>v+a[c]*basis[k],0)):0)},0)))
 return{pass:pass.pass,probes,weightedProductionRaw:blend('production','raw'),weightedProductionL1:blend('production','l1'),weightedReferenceRaw:blend('reference','raw'),weightedReferenceL1:blend('reference','l1')}
})
const directional=[]
for(const p of trace.passes[0].probes){const q=reference.get(p.index),first=rgb(p),final=rgb(trace.passes[5].probes.find((r:any)=>r.index===p.index)),factor=4*Math.PI/q.quadrature.reduce((s:number,p:any)=>s+p.weight,0)
 const pixels=q.rays.map((r:any,i:number)=>{
  const face=p.faces[Math.floor(i/256)],o=i%256*4,weight=q.quadrature[i].weight*factor*Math.max(0,-q.quadrature[i].direction[1]),delta=final[i].map((v:number,c:number)=>v-r.radiance[c]),receiver=face.receiver.slice(o,o+4),n=face.normal.slice(o,o+4)
  return{pixel:i,face:Math.floor(i/256),row:Math.floor(i%256/16),column:i%16,direction:q.quadrature[i].direction,weight,first:first[i],referenceFirst:r.firstPass,final:final[i],referenceFinal:r.radiance,weightedError:delta.map((v:number)=>v*weight),firstHit:r.firstHit,receiver,normal:n,response:face.response.slice(o,o+4),material:face.material?.slice(o,o+4),staticRadiance:face.staticRadiance.slice(o,o+3)}
 }).sort((a:any,b:any)=>a.weightedError[0]-b.weightedError[0])
 directional.push({index:p.index,pixels})
}
fs.writeFileSync(`${out}/pass-comparison.json`,JSON.stringify(passes,null,2));fs.writeFileSync(`${out}/directional-comparison.json`,JSON.stringify(directional))
console.log('weighted ceiling passes',passes.map((p:any)=>[p.pass,p.weightedProductionRaw[0],p.weightedReferenceRaw[0],p.weightedProductionL1[0],p.weightedReferenceL1[0]]))
if(process.argv.includes('--summary-only'))process.exit(0)
// Verify immutable-baseline + previous completed field recurrence. No paths,
// source strengths, weights or surfaces are modified by this replay.
const field=restoreIndirectField(input.field),visibility=createIndirectVisibilityFromSnapshot(input.geometry),volumeLookup=createIndirectVolumeLookup(field,visibility),floorLookup=createIndirectFloorLookup(field,visibility),result=new Float64Array(12),replay=[]
field.positionData.set(input.field.positionData)
for(let pass=0;pass<5;pass++){
 field.coefficients.forEach(a=>a.fill(0));for(const p of trace.passes[pass].allCoefficients)for(let c=0;c<3;c++)for(let k=0;k<4;k++)field.coefficients[c][p.index*4+k]=DataUtils.toHalfFloat(p.rgb[c][k])
 volumeLookup.refreshCoefficients();floorLookup.refreshCoefficients()
 for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,volumeLookup)
 writeIndirectFloorLayer(field,visibility,floorLookup)
 const probes=[]
 for(const p of trace.passes[0].probes){
  const next=trace.passes[pass+1].probes.find((q:any)=>q.index===p.index),ref=reference.get(p.index),predicted:number[][]=[],pixels=[]
  for(let face=0;face<6;face++)for(let pixel=0;pixel<256;pixel++){
   const f=p.faces[face],o=pixel*4,position=f.receiver.slice(o,o+3),n=f.normal.slice(o,o+3),floor=f.receiver[o+3]-1,floorFlag=f.normal[o+3],base=f.radiance.slice(o,o+3),response=f.response.slice(o,o+3)
   let incident=[0,0,0]
   if(floor>=0&&floor<field.floors.length){const pos=new Vector3().fromArray(position),normal=new Vector3().fromArray(n);field.floorLayer.ready=false;incident=floorFlag>.5?sampleBakedIndirectFloor(field,floor,pos,normal).rgb:sampleDisplayedIndirect(field,floor,pos,normal).rgb;field.floorLayer.ready=true}
   const radiance=base.map((v:number,c:number)=>v+response[c]*incident[c]);predicted.push(radiance)
   pixels.push({pixel:face*256+pixel,incident,predicted:radiance,actual:next.faces[face].radiance.slice(o,o+3),error:radiance.map((v:number,c:number)=>v-next.faces[face].radiance[o+c])})
  }
  probes.push({index:p.index,integratedPrediction:integrate(ref,predicted),pixels})
 }
 replay.push({pass:pass+2,probes});console.log('CPU recurrence checked',pass+2)
}
fs.writeFileSync(`${out}/cpu-replay.json`,JSON.stringify(replay));visibility.dispose();field.dispose()
