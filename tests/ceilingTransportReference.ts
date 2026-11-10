import fs from 'node:fs'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../src/indirectSH.ts'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic opt-in required')
const out='docs/ceiling-transport',audit=JSON.parse(fs.readFileSync(`${out}/baseline-audit.json`,'utf8')),input=readLocalLightInput('docs/local-light/bedroom-input.bin.gz'),saved=JSON.parse(fs.readFileSync('docs/bedroom-daylight/reference.json','utf8'))
const reference=createSceneLightingReference(input.reference),indices=[...new Set<number>([...audit.selected,321,442,332,453])],summary=[]
assert.ok(input.reference.sunDirection.every((v:number,c:number)=>Math.abs(v-audit.sourceSettings.sunDirection[c])<1e-8))
const integrate=(samples:any[],values:number[][],normal:number[])=>{
 const factor=4*Math.PI/samples.reduce((s,p)=>s+p.weight,0),basis=indirectSHIrradianceBasis(new Vector3().fromArray(normal),1)
 const coefficients=Array.from({length:4},(_,k)=>[0,1,2].map(c=>samples.reduce((s,p,i)=>s+p.weight*factor*indirectSHRadianceBasis(new Vector3().fromArray(p.direction),1)[k]*values[i][c],0)))
 return{coefficients,raw:[0,1,2].map(c=>samples.reduce((s,p,i)=>s+p.weight*factor*Math.max(0,p.direction.reduce((s:number,v:number,k:number)=>s+v*normal[k],0))*values[i][c],0)),l1:[0,1,2].map(c=>Math.max(0,coefficients.reduce((s,a,k)=>s+a[c]*basis[k],0)))}
}
for(const index of indices){
 const path=`${out}/reference-probe-${index}.json`
 if(process.argv.includes('--resume')&&fs.existsSync(path)){const p=JSON.parse(fs.readFileSync(path,'utf8'));summary.push({index,passes:p.passes,elapsedMs:p.elapsedMs});continue}
 const started=performance.now(),probe=saved.captures.find((p:any)=>p.index===index);assert.ok(probe,'Missing quadrature for probe '+index)
 const runs:any[]=[],samples=probe.samples,directions=samples.map((p:any)=>p.direction)
 for(let run=0;run<4;run++){
  const rays=reference.incoming(probe.position,directions,32,6,91000+index*1009+run*70001,true,6)
  runs.push(rays);console.log('reference probe',index,'replicate',run+1)
 }
 const averaged=runs[0].map((p:any,i:number)=>({...p,radiance:p.radiance.map((_:number,c:number)=>runs.reduce((s,r)=>s+r[i].radiance[c]/4,0)),components:{direct:p.components.direct.map((a:number[],k:number)=>a.map((_,c)=>runs.reduce((s,r)=>s+r[i].components.direct[k][c]/4,0))),sky:p.components.sky.map((a:number[],k:number)=>a.map((_,c)=>runs.reduce((s,r)=>s+r[i].components.sky[k][c]/4,0)))}}))
 const cumulative=(rays:any[],pass:number)=>rays.map(p=>[0,1,2].map(c=>p.components.direct.slice(0,pass).reduce((s:number,a:number[])=>s+a[c],0)+p.components.sky.slice(0,pass).reduce((s:number,a:number[])=>s+a[c],0)))
 const passes=Array.from({length:6},(_,k)=>{
  const values=cumulative(averaged,k+1),means=integrate(samples,values,[0,-1,0]),replicates=runs.map(r=>integrate(samples,cumulative(r,k+1),[0,-1,0]))
  const standardError=(key:'raw'|'l1')=>[0,1,2].map(c=>Math.sqrt(replicates.reduce((s,r)=>s+(r[key][c]-means[key][c])**2,0)/(4*3)))
  return{pass:k+1,...means,rawStandardError:standardError('raw'),l1StandardError:standardError('l1')}
 })
 const output={index,position:probe.position,normal:[0,-1,0],samplesPerDirection:128,replicates:4,pathsPerReplicate:32,passes,rays:averaged,quadrature:samples.map((p:any)=>({direction:p.direction,weight:p.weight})),elapsedMs:performance.now()-started}
 fs.writeFileSync(path,JSON.stringify(output));summary.push({index,passes,elapsedMs:output.elapsedMs});console.log('reference complete',index,passes.map(p=>p.raw[0]))
}
fs.writeFileSync(`${out}/reference-summary.json`,JSON.stringify(summary,null,2));reference.dispose()
