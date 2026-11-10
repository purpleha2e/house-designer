import fs from 'node:fs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
const out='docs/door-pipeline';fs.mkdirSync(out,{recursive:true})
const baseline=JSON.parse(fs.readFileSync('docs/door-confidence/original-results.json','utf8'))
const used=new Set(baseline.points.flatMap((p:any)=>p.links.filter((l:any)=>l.central).map((l:any)=>l.index)))
const input=readDoorInput(),start=performance.now(),reference=createSceneLightingReference(input.reference)
const probes=[]
for(const p of baseline.probes.filter((p:any)=>used.has(p.index))){
 const runs=[1234,85439].map(seed=>reference.evaluate({name:`probe-${p.index}`,position:p.position,normal:[0,1,0],geometricNormal:[0,0,0]},65536,6,seed))
 const rgb=[0,1,2].map(c=>runs.reduce((s,r)=>s+r.sky[c]+r.reflected[c],0)/runs.length)
 const se=[0,1,2].map(c=>Math.sqrt(runs.reduce((s,r)=>s+r.skyStandardError[c]**2+r.reflectedStandardError[c]**2,0))/runs.length)
 probes.push({...p,runs,rgb,se})
 fs.writeFileSync(`${out}/reference-probes.json`,JSON.stringify({complete:probes.length===used.size,probes,elapsedMs:performance.now()-start}))
 console.log('probe',p.index,rgb,'completed',probes.length,'/',used.size)
}
const transport=[]
for(const index of [590,89,494,495,496]){
 const p=baseline.probes.find((p:any)=>p.index===index);if(!p)continue
 const passes=[]
 for(let depth=0;depth<=6;depth++)passes.push(reference.evaluate({name:`probe-${index}-depth-${depth}`,position:p.position,normal:[0,1,0],geometricNormal:[0,0,0]},65536,depth,49193))
 transport.push({index,position:p.position,passes});console.log('transport',index)
 fs.writeFileSync(`${out}/reference-transport.json`,JSON.stringify({transport,elapsedMs:performance.now()-start}))
}
reference.dispose()
