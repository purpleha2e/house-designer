import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const out='docs/ceiling-transport';fs.mkdirSync(out,{recursive:true})
const files=['docs/bedroom-daylight/reference.json','docs/bedroom-daylight/sun-1.json','docs/bedroom-daylight/sun-1-repeat.json','docs/bedroom-daylight/project.json.gz','docs/bedroom-daylight/completed-baseline-cache.json.gz','docs/local-light/bedroom-input.bin.gz']
const ref=JSON.parse(fs.readFileSync(files[0])),baseline=JSON.parse(fs.readFileSync(files[1])),repeat=JSON.parse(fs.readFileSync(files[2])),ceiling=ref.reconstruction[2]
const points=ref.referenceProbeBlends.map((p,i)=>({...p,material:baseline.materialGPU[i].irradiance,point:baseline.points[i]}))
assert.ok(Math.abs(points[2].storedField[0]-.09442)<.00001);assert.ok(Math.abs(points[2].independentAtReceiver[0]-.13868)<.00001);assert.ok(Math.abs(points[2].referenceProbeBlend[0]-.13789)<.00001)
const candidates=ceiling.weightsAtBiasedPoint.probes.map(p=>{
 const r=ref.probeReference.find(q=>q.index===p.index),q=r?.receivers.find(q=>q.name==='ceiling'),capture=ref.captures.find(q=>q.index===p.index)
 return {...p,coefficients:capture?.coefficients??null,independentCoefficients:r?.referenceCoefficients??null,production:q?.productionSH??null,independent:q?.referenceSH??null,raw:q??null,
  contribution:q?.productionSH.map(v=>v*p.normalizedWeight)??[0,0,0],referenceContribution:q?.referenceSH.map(v=>v*p.normalizedWeight)??[0,0,0],weightedError:q?.productionSH.map((v,c)=>(v-q.referenceSH[c])*p.normalizedWeight)??[0,0,0]}
}).sort((a,b)=>a.weightedError[0]-b.weightedError[0])
const selected=candidates.filter(p=>p.visible).map(p=>p.index)
const passCoefficients=repeat.trace.passes.map(pass=>({pass:pass.pass,probes:pass.coefficients.filter(p=>selected.includes(p.index)),ceilingPoint:[0,1,2].map(c=>Math.max(0,candidates.filter(p=>p.visible).reduce((s,p)=>{const a=pass.coefficients.find(q=>q.index===p.index).rgb[c];return s+p.normalizedWeight*(.886227*a[0]-1.023328*a[1])},0)))}))
const data={points,candidates,selected,passCoefficients,sourceSettings:baseline.calibration,baselineSHA256:files.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))}
fs.writeFileSync(`${out}/baseline-audit.json`,JSON.stringify(data,null,2));console.log('ceiling verified; contributors',selected,'passes',passCoefficients.map(p=>[p.pass,p.ceilingPoint[0]]))
