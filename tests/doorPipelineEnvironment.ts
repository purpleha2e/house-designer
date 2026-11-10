import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
import {Vector3} from 'three'
const out='docs/door-pipeline',input=readDoorInput(),reference=createSceneLightingReference(input.reference),capture=JSON.parse(gunzipSync(fs.readFileSync(`${out}/capture.json.gz`)).toString()),samples=capture.source[0].samples
const base=JSON.parse(fs.readFileSync('docs/door-confidence/original-results.json','utf8')),results=[]
for(const p of base.points.filter((p:any)=>['trace-3','trace-4','trace-5','trace-6'].includes(p.name))){
 const position=[p.position[0],p.position[1]-.004+.0002,p.position[2]],incoming=reference.incoming(position,samples.map((q:any)=>q.direction),128,6,8143)
 results.push({name:p.name,position,incoming,separationFrom590:Math.hypot(position[0]-2.25,position[1]-.18000000715255737,position[2]-14)})
 fs.writeFileSync(`${out}/environment.json`,JSON.stringify({results}));console.log('environment',p.name)
}
const sourceResolution=[]
for(const size of [16,32,64]){
 const q=[];for(let face=0;face<6;face++)for(let row=0;row<size;row++)for(let col=0;col<size;col++){
  const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3
  q.push({direction:d.normalize().toArray(),weight})
 }
 const values=reference.incoming([2.25,.18000000715255737,14],q.map(q=>q.direction),1,0,1),factor=4*Math.PI/q.reduce((s,p)=>s+p.weight,0)
 sourceResolution.push({size,raw:[0,1,2].map(c=>q.reduce((s,p,j)=>s+p.weight*factor*Math.max(0,p.direction[1])*values[j].firstPass[c],0)),sky:[0,1,2].map(c=>q.reduce((s,p,j)=>s+p.weight*factor*Math.max(0,p.direction[1])*values[j].sky[c],0))})
}
fs.writeFileSync(`${out}/environment.json`,JSON.stringify({complete:true,results,sourceResolution,pathsPerDirection:128,depth:6,convention:'Receiver directional paths start at the same .0122m Y as the retained independent floor integrator; probe directions start at the probe itself.'}));reference.dispose()
