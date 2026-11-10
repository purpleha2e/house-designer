import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import sharp from 'sharp'
const root='docs/lighting-correctness',before=JSON.parse(readFileSync(`${root}/baseline/results.json`)),after=JSON.parse(readFileSync(`${root}/verified/results.json`))
const beforeField=JSON.parse(readFileSync(`${root}/baseline/field-checksum.json`)),afterField=JSON.parse(readFileSync(`${root}/verified/field-checksum.json`)),fieldChanged=beforeField.volume!==afterField.volume
assert.equal(afterField.probes,beforeField.probes,'physical visibility correction must retain the probe count')
assert.equal(afterField.positions,beforeField.positions,'probe positions remain fixed')
assert.equal(afterField.mask,beforeField.mask,'occupancy masks remain fixed')
const beforeSettings=JSON.parse(readFileSync(`${root}/baseline/settings.json`)),afterSettings=JSON.parse(readFileSync(`${root}/verified/settings.json`))
for(const key of ['width','height','dpr','exposure','shOrder','fill'])assert.deepEqual(afterSettings[key],beforeSettings[key],key+' remains fixed')
assert.deepEqual(afterSettings.sky.base,beforeSettings.sky.base)
assert.deepEqual(afterSettings.lights,beforeSettings.lights)
const half=h=>{const s=h&32768?-1:1,e=h>>>10&31,m=h&1023;return e===0?s*2**-14*m/1024:s*2**(e-15)*(1+m/1024)}
const results=[]
for(const a of after){
 const b=before.find(b=>b.camera.id===a.camera.id),same=JSON.stringify(a.camera)===JSON.stringify(b.camera)
 if(!same){results.push({camera:a.camera.id,compared:false,reason:'Verified camera framing expanded to include requested ceiling/doorway; do not compare mismatched transforms.'});continue}
 for(const mode of ['A','B','C']){
  const buffers=['baseline','verified'].map(run=>gunzipSync(readFileSync(`${root}/${run}/${a.camera.id}/${mode}.rgba16f.gz`)))
  let max=0,sum=0,changed=0,violations=0
  for(let i=0;i<buffers[0].length;i+=2){const x=half(buffers[0].readUInt16LE(i)),y=half(buffers[1].readUInt16LE(i)),d=Math.abs(x-y);max=Math.max(max,d);sum+=d;if(d>0)changed++;if(d>.002*(1+Math.max(Math.abs(x),Math.abs(y))))violations++}
  results.push({camera:a.camera.id,mode,compared:true,lightingFieldChanged:fieldChanged,maxAbsoluteHDRDifference:max,meanAbsoluteHDRDifference:sum/(buffers[0].length/2),changedComponents:changed,roundingViolations:violations})
  if(!fieldChanged)assert.equal(violations,0,'a diagnostic-only correction must preserve normal final-composite lighting')
 }
}
writeFileSync(`${root}/before-after.json`,JSON.stringify(results,null,2))
const reference=JSON.parse(readFileSync(`${root}/verified/reference.json`)),receivers=[]
// The reference has no dependency on the GI field. Reuse its physical rays and
// paths only at exactly identical receivers; attach the baseline GPU values.
const baselineReference={...reference,sharedReference:{source:'../verified/reference.json',reason:'Identical physical scene/light inputs and exactly identical GPU receiver positions/normals; independent reference does not read probes.'},results:reference.results.map(ref=>{
 const point=before.find(v=>v.camera.id===ref.camera)?.points.find(p=>p.name===ref.name&&!p.unavailable)
 assert.ok(point,'baseline receiver exists')
 assert.deepEqual(point.position,ref.position,'reference position is identical')
 assert.deepEqual(point.normal,ref.normal,'reference normal is identical')
 return {...ref,...point}
})}
writeFileSync(`${root}/baseline/reference.json`,JSON.stringify(baselineReference,null,2))
const baselineGallery=readFileSync(`${root}/baseline/index.html`,'utf8').replace('href="performance.json"','href="../production-performance-before.json"')
writeFileSync(`${root}/baseline/index.html`,baselineGallery)
for(const view of after)for(const point of view.points){
 if(point.unavailable)continue
 const previous=before.find(v=>v.camera.id===view.camera.id)?.points.find(p=>p.name===point.name&&!p.unavailable),ref=reference.results.find(p=>p.camera===view.camera.id&&p.name===point.name)
 if(!previous||!ref||point.position.some((v,i)=>Math.abs(v-previous.position[i])>1e-5)||point.normal.some((v,i)=>Math.abs(v-previous.normal[i])>1e-5))continue
 const target=ref.reference.sky.map((v,i)=>v+ref.reference.reflected[i]),error=p=>target.reduce((sum,v,i)=>sum+Math.abs(p.skyIrradiance[i]+p.reflectedIrradiance[i]-v),0)/3
 receivers.push({camera:view.camera.id,name:point.name,beforeMAE:error(previous),afterMAE:error(point)})
}
writeFileSync(`${root}/reference-before-after.json`,JSON.stringify({receivers,matched:receivers.length,meanBefore:receivers.reduce((s,p)=>s+p.beforeMAE,0)/receivers.length,meanAfter:receivers.reduce((s,p)=>s+p.afterMAE,0)/receivers.length},null,2))
// Before/after images of the corrected diagnostic itself: each pair is the
// same sampling grid and visibility, independently compared with production.
for(const phase of ['before','after']){
 const data=JSON.parse(readFileSync(`${root}/sky-seam/${phase}.json`)),rows=data.results.filter(r=>r.order===1&&r.floor===0),width=500,height=100,raw=Buffer.alloc(width*height*3)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const r=rows[Math.min(rows.length-1,Math.floor(x/width*rows.length))],v=y<height/2?r.diagnosticSky:r.productionSky;for(let c=0;c<3;c++)raw[(y*width+x)*3+c]=Math.round(Math.max(0,Math.min(1,v))*255)}
 await sharp(raw,{raw:{width,height,channels:3}}).png().toFile(`${root}/sky-seam/${phase}.png`)
}
console.log('PASS before/after controls and HDR differences for matched cameras',results.length,'field changed:',fieldChanged)
