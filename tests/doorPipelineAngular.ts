import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {DataUtils,Vector3} from 'three'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
const out='docs/door-pipeline',capture=JSON.parse(gunzipSync(fs.readFileSync(`${out}/capture.json.gz`)).toString())
const baseline=JSON.parse(fs.readFileSync('docs/door-confidence/original-results.json','utf8'))
const input=readDoorInput(),reference=createSceneLightingReference(input.reference),start=performance.now()
const normals=[[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]
export function angularMeasure(samples:any[],values:number[][]){
 const factor=4*Math.PI/samples.reduce((s,q)=>s+q.weight,0),q=samples.map(p=>({...p,omega:p.weight*factor,basis:indirectSHRadianceBasis(new Vector3().fromArray(p.direction),2)}))
 const coefficients=Array.from({length:9},(_,k)=>[0,1,2].map(c=>q.reduce((s,p,j)=>s+p.omega*p.basis[k]*values[j][c],0)))
 const irradiance=normals.map(normal=>{
  const raw=[0,1,2].map(c=>q.reduce((s,p,j)=>s+p.omega*Math.max(0,p.direction.reduce((s,v,k)=>s+v*normal[k],0))*values[j][c],0))
  const sh=(order:1|2)=>[0,1,2].map(c=>Math.max(0,indirectSHIrradianceBasis(new Vector3().fromArray(normal),order).reduce((s,b,k)=>s+b*coefficients[k][c],0)))
  return{normal,raw,l1:sh(1),l2:sh(2)}
 })
 const rmse=(bands:number)=>[0,1,2].map(c=>Math.sqrt(q.reduce((s,p,j)=>s+p.omega*(p.basis.slice(0,bands).reduce((s,b,k)=>s+b*coefficients[k][c],0)-values[j][c])**2,0)/(4*Math.PI)))
 return{coefficients,irradiance,radianceRMSE:{l1:rmse(4),l2:rmse(9)}}
}
const probes=[]
for(const p of capture.passes.at(-1).probes){
 const meta=capture.metadata.find((m:any)=>m.index===p.index),previous=baseline.probes.find((m:any)=>m.index===p.index),samples=p.samples
 const production=angularMeasure(samples,samples.map((s:any)=>s.rgb))
 const pathsPerDirection=p.index===590?512:128
 const incoming=reference.incoming(meta.position,samples.map((s:any)=>s.direction),pathsPerDirection,6,777+p.index*1009)
 const independent=angularMeasure(samples,incoming.map(s=>s.radiance)),source=angularMeasure(samples,capture.source.find((s:any)=>s.index===p.index).samples.map((s:any)=>s.rgb)),referenceSource=angularMeasure(samples,incoming.map(s=>s.firstPass)),referenceSky=angularMeasure(samples,incoming.map(s=>s.sky))
 const passes=[source,...capture.passes.map((pass:any)=>angularMeasure(samples,pass.probes.find((q:any)=>q.index===p.index).samples.map((s:any)=>s.rgb)))]
 const coefficientError=Math.max(...production.coefficients.slice(0,4).flatMap((v,k)=>v.map((v,c)=>Math.abs(v-previous.coefficients[c*4+k]))))
 const reproducedCoefficientError=Math.max(...previous.coefficients.map((v:number,k:number)=>Math.abs(v-DataUtils.fromHalfFloat(capture.coefficients[Math.floor(k/4)][p.index*4+k%4]))))
 const matchedRadianceRMSE=[0,1,2].map(c=>Math.sqrt(samples.reduce((s:number,q:any,j:number)=>s+q.weight*(q.rgb[c]-incoming[j].radiance[c])**2,0)/samples.reduce((s:number,q:any)=>s+q.weight,0)))
 probes.push({index:p.index,position:meta.position,production,independent,source,referenceSource,referenceSky,passes,coefficientError,reproducedCoefficientError,pathsPerDirection,matchedRadianceRMSE,incoming})
 fs.writeFileSync(`${out}/angular.json`,JSON.stringify({complete:probes.length===capture.metadata.length,probes,size:capture.size,elapsedMs:performance.now()-start,convention:'Incoming radiance: visible sky or outgoing radiance of first surface. Source includes sky and direct-lit surface response, not receiver direct sunlight. L1 and L2 share identical final pass-six samples.'}))
 console.log('angular',p.index,'up',production.irradiance[0],'reference',independent.irradiance[0].raw,'savedDifference',reproducedCoefficientError)
}
reference.dispose()
