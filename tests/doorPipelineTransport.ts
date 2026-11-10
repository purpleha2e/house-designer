import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
const out='docs/door-pipeline',input=readDoorInput(),reference=createSceneLightingReference(input.reference),capture=JSON.parse(gunzipSync(fs.readFileSync(`${out}/capture.json.gz`)).toString()),results=[]
for(const index of [590,89]){
 const meta=capture.metadata.find((p:any)=>p.index===index),samples=capture.source.find((p:any)=>p.index===index).samples,factor=4*Math.PI/samples.reduce((s:number,p:any)=>s+p.weight,0)
 const incoming=reference.incoming(meta.position,samples.map((q:any)=>q.direction),512,6,7813+index,true)
 const integrate=(get:(p:any)=>number[])=>[0,1,2].map(c=>samples.reduce((s:number,q:any,i:number)=>s+q.weight*factor*Math.max(0,q.direction[1])*get(incoming[i])[c],0))
 const sky=Array.from({length:7},(_,b)=>integrate(p=>p.components.sky[b])),direct=Array.from({length:6},(_,b)=>integrate(p=>p.components.direct[b]))
 const matchedPasses=Array.from({length:6},(_,k)=>[0,1,2].map(c=>sky.slice(0,k+1).reduce((s,p)=>s+p[c],0)+direct.slice(0,k+1).reduce((s,p)=>s+p[c],0)))
 const geometry=samples.map((q:any,i:number)=>{const face=meta.faces[q.face],j=(q.row*capture.size+q.col)*4,normal=face.normals.slice(j,j+3),receiver=face.positions.slice(j,j+3),hit=incoming[i].firstHit;return{face:q.face,row:q.row,col:q.col,direction:q.direction,weight:q.weight,capturedSurface:Math.hypot(...normal)>.5,receiver,normal,referenceHit:hit}})
 results.push({index,position:meta.position,sky,direct,matchedPasses,incoming,geometry})
 fs.writeFileSync(`${out}/transport-components.json`,JSON.stringify({complete:results.length===2,results,samplesPerDirection:512,size:16,note:'sky[b] escaped after b diffuse surface reflections; direct[b] is sun/lamp energy after b+1 surface responses. Production pass k includes sky through k-1 reflections and direct through k surface responses. Receiver direct sun is excluded from GI.'}));console.log('transport components',index,matchedPasses)
}
reference.dispose()
