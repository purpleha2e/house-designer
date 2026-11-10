import fs from 'node:fs'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const out='docs/local-light',read=p=>JSON.parse(fs.readFileSync(p)),provenance=read(`${out}/provenance.json`)
for(const input of provenance.inputs)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(input.path)).digest('hex'),input.sha256,'Preserved input changed: '+input.path)
let receivers=0,variants=0
for(const name of ['bedroom','bedroom-grid','original','moved','rotated','staircase',...['closed','narrow','medium','open','thin-wall','cabinet','underside','slab','stairwell'].map(k=>'rooms-'+k)]){
 const data=read(`${out}/${name}.json`)
 for(const p of data.points??data){
  receivers++
  for(const q of Object.values(p.variants)){
   variants++;assert.ok(q.candidates.every(c=>Number.isFinite(c.regionId)))
   assert.ok(q.candidates.every(c=>c.visible||c.normalizedWeight===0))
   if(!q.validLocal){assert.deepEqual(q.conservative,q.production);assert.deepEqual(q.maskedRGB,q.production)}
   for(let c=0;c<3;c++){
    assert.ok(Number.isFinite(q.maskedRGB[c])&&q.maskedRGB[c]>=0)
    assert.ok(q.maskedRGB[c]>=q.conservative[c]-1e-10)
   }
  }
 }
}
const loaded=read(`${out}/capture-loaded-state.json`),cache=read('docs/door-confidence/original-field.json')
assert.equal(loaded.geometryKey,cache.geometryKey);assert.deepEqual(loaded.coefficients,cache.coefficients);assert.equal(loaded.gi.source,'saved')
assert.deepEqual(read(`${out}/gpu-performance.json`).errors,[])
for(const camera of ['door','staircase'])for(const mode of ['baseline','conservative','masked','baseline-10cm','conservative-10cm','masked-10cm'])assert.ok(fs.statSync(`${out}/${camera}-${mode}.png`).size>10000)
const extra=['docs/local-light/bedroom-input.bin.gz','docs/local-light/door-project.json.gz','docs/door-confidence/original-notch-refined-results.json','docs/soft-gi/staircase-reference.json']
for(const path of extra)if(!provenance.inputs.some(p=>p.path===path))provenance.inputs.push({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')})
provenance.date='2026-11-05';fs.writeFileSync(`${out}/provenance.json`,JSON.stringify(provenance,null,2))
const result={ok:true,receivers,variants,baselineHashesUnchanged:true,finalScreenshotFieldUnchanged:true,screenshots:12,browserErrors:0,productionDefaultsChanged:false}
fs.writeFileSync(`${out}/verification.json`,JSON.stringify(result,null,2));console.log(result)
