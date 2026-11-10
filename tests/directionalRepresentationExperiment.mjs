import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {SphericalHarmonics3,Vector3} from 'three'
import {referenceIncidentRadiance,referenceIrradiance} from './daylightReferenceCalculation.ts'

const out=process.argv[2]??'docs/gi-kitchen-diagnostics/directional-experiment'
mkdirSync(out,{recursive:true})
const results=[]
for(const point of [[2.5,1.4,.6],[2.5,1.4,2],[.6,1.4,3.4]]){
  const started=performance.now(),samples=65536,sh=new SphericalHarmonics3(),basis=new Array(9),d=new Vector3()
  for(let i=0;i<samples;i++){
    const y=1-2*(i+.5)/samples,r=Math.sqrt(1-y*y),angle=i*Math.PI*(3-Math.sqrt(5));d.set(r*Math.cos(angle),y,r*Math.sin(angle))
    const rgb=referenceIncidentRadiance(point,d.toArray(),{depth:6,seed:Math.imul(i+1,2654435761)})
    SphericalHarmonics3.getBasisAt(d,basis)
    for(let k=0;k<9;k++)sh.coefficients[k].addScaledVector(new Vector3(...rgb),basis[k]*4*Math.PI/samples)
  }
  const projectionMs=performance.now()-started,first=sh.clone();for(let k=4;k<9;k++)first.coefficients[k].set(0,0,0)
  const rows=[]
  for(const normal of [[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[.707,.707,0],[0,.707,-.707]]){
    d.fromArray(normal).normalize()
    const reference=referenceIrradiance(point,d.toArray(),{samples:131072,depth:6,sky:'clear',sun:'away',seed:7291})
    const evaluate=s=>s.getIrradianceAt(d,new Vector3()).toArray().map(v=>Math.max(0,v))
    const l1=evaluate(first),l2=evaluate(sh)
    rows.push({normal:d.toArray(),reference,l1,l2,l1Error:l1.map((v,c)=>Math.abs(v-reference[c])),l2Error:l2.map((v,c)=>Math.abs(v-reference[c]))})
  }
  results.push({point,samples,projectionMs,rows})
}
const mean=(key)=>results.flatMap(p=>p.rows.flatMap(r=>r[key])).reduce((a,b)=>a+b,0)/(results.length*8*3)
const report={scope:'Angular representation only, at identical fixed points inside the independent reference room. No production probe placement/interpolation is used or changed.',results,meanAbsoluteError:{l1:mean('l1Error'),l2:mean('l2Error')},cost:{coefficientsPerColour:{l1:4,l2:9},estimatedCoefficientStorageRatio:9/4,estimatedBlendArithmeticRatio:9/4,visibilityGraphRatio:1,notes:'Operation/storage ratios are estimates, not an integrated browser GPU or bake benchmark. Both variants share the same sampled incoming paths.'}}
writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({errors:report.meanAbsoluteError,projectionMs:results.map(p=>p.projectionMs)}))
assert.ok(report.meanAbsoluteError.l2<report.meanAbsoluteError.l1,'second-order SH should improve the independent fixed-point directional fit')
