import fs from 'node:fs'
import {DataUtils,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
import {sampleDisplayedIndirect} from '../src/indirectLightingDiagnostic.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
const out='docs/door-pipeline',read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'))
const baseline=read('docs/door-confidence/original-results.json'),angular=read(`${out}/angular.json`),refs=read(`${out}/reference-probes.json`)
if(!angular.complete||!refs.complete)throw Error('Reference or angular run incomplete')
const a=new Map<number,any>(angular.probes.map((p:any)=>[p.index,p])),r=new Map<number,any>(refs.probes.map((p:any)=>[p.index,p])),probes=new Map<number,any>(baseline.probes.map((p:any)=>[p.index,p]))
const input=readDoorInput(),loaded=await loadIndirectLighting(read('docs/door-confidence/original-field.json'),{reflections:false,allowLegacy:true}),field=loaded!.field,visibility=createIndirectVisibilityFromSnapshot(input.geometry),coef=new Float64Array(12)
let maxBaselineDifference=0
const points=baseline.points.map((p:any)=>{
 const support=sampleIndirectCoefficients(field,0,...p.position as[number,number,number],coef,visibility),confidence=Math.min(1,support/.1),production=[0,1,2].map(c=>Math.max(0,coef[c*4]*.886227+coef[c*4+1]*1.023328)*confidence)
 maxBaselineDifference=Math.max(maxBaselineDifference,...production.map((v,c)=>Math.abs(v-p.variants.binary.rgb[c])))
 const w=p.variants.binary.normalizedWeights,blend=(value:(index:number)=>number[])=>[0,1,2].map(c=>p.links.reduce((s:number,l:any,i:number)=>s+(w[i]?w[i]*value(l.index)[c]:0),0)*confidence)
 const ref=p.reference.sky.map((v:number,c:number)=>v+p.reference.reflected[c]),referenceSE=p.reference.skyStandardError.map((v:number,c:number)=>Math.hypot(v,p.reference.reflectedStandardError[c]))
 const referenceProbe=blend(i=>r.get(i).rgb),raw=blend(i=>a.get(i).production.irradiance[0].raw),l1=blend(i=>a.get(i).production.irradiance[0].l1),l2=blend(i=>a.get(i).production.irradiance[0].l2)
 const referenceProbeSE=[0,1,2].map(c=>Math.sqrt(p.links.reduce((s:number,l:any,i:number)=>s+(w[i]?w[i]**2*r.get(l.index).se[c]**2:0),0))*confidence)
 const visible=p.links.filter((l:any)=>l.central).sort((x:any,y:any)=>x.distance-y.distance),nearest=visible[0],old=(i:number)=>[0,1,2].map(c=>probes.get(i).coefficients[c*4]*.886227+probes.get(i).coefficients[c*4+1]*1.023328)
 const without590=(value:(i:number)=>number[])=>{const sum=p.links.reduce((s:number,l:any,i:number)=>s+(l.index===590?0:w[i]),0);return[0,1,2].map(c=>p.links.reduce((s:number,l:any,i:number)=>s+(l.index!==590&&w[i]?w[i]*value(l.index)[c]:0),0)/(sum||1)*confidence)}
 const equalReference=[0,1,2].map(c=>visible.reduce((s:number,l:any)=>s+r.get(l.index).rgb[c],0)/Math.max(1,visible.length)*confidence)
 return{name:p.name,kind:p.kind,position:p.position,reference:ref,referenceSE,referenceSamples:p.reference.samples,production,stored:sampleDisplayedIndirect(field,0,new Vector3().fromArray(p.position),new Vector3(0,1,0)).rgb,raw,l1,l2,referenceProbe,referenceProbeSE,equalReference,nearest:nearest?{index:nearest.index,distance:nearest.distance,production:old(nearest.index),reference:r.get(nearest.index).rgb}:null,without590:{production:without590(old),reference:without590(i=>r.get(i).rgb)},probe590:p.links.find((l:any)=>l.index===590),probe590Weight:w[p.links.findIndex((l:any)=>l.index===590)]??0,links:p.links.map((l:any,i:number)=>({...l,weight:w[i]})),captureReplayDelta:l1.map((v,c)=>v-production[c])}
})
if(maxBaselineDifference>1e-8)throw Error(`Baseline changed: ${maxBaselineDifference}`)
const methods=['production','stored','l1','raw','l2','referenceProbe','equalReference','nearestProduction','nearestReference']
const subsets={all:points,trace:points.filter((p:any)=>p.kind==='trace'),grid:points.filter((p:any)=>p.kind==='grid'),control:points.filter((p:any)=>p.kind==='control'),notch:points.filter((p:any)=>['trace-3','trace-4','trace-5','trace-6'].includes(p.name))}
const metrics=Object.fromEntries(Object.entries(subsets).map(([name,subset])=>[name,Object.fromEntries(methods.map(method=>{
 const errors=subset.map((p:any)=>{const value=method==='nearestProduction'?p.nearest?.production:method==='nearestReference'?p.nearest?.reference:p[method];return(value??[0,0,0]).map((v:number,c:number)=>v-p.reference[c])})
 return[method,{n:subset.length,maeRGB:[0,1,2].map(c=>errors.reduce((s:number,e:number[])=>s+Math.abs(e[c]),0)/errors.length),biasRGB:[0,1,2].map(c=>errors.reduce((s:number,e:number[])=>s+e[c],0)/errors.length),rmseRGB:[0,1,2].map(c=>Math.sqrt(errors.reduce((s:number,e:number[])=>s+e[c]**2,0)/errors.length))}]
}))]))
fs.writeFileSync(`${out}/decomposition.json`,JSON.stringify({points,metrics,maxBaselineDifference,captureMismatches:angular.probes.filter((p:any)=>p.reproducedCoefficientError>1e-5).map((p:any)=>({index:p.index,error:p.reproducedCoefficientError})),note:'All weights and production coefficients remain original. Raw/L1/L2 use identical reproduced pass-six captures. Their replay delta is explicitly retained; raw values for three near-black probes are surrogate captures, not exact recovered originals. Without590 and equal-weight values are controlled diagnostic substitutions, never production corrections.'}))
console.log(JSON.stringify({maxBaselineDifference,metrics},null,2));visibility.dispose();field.dispose()
