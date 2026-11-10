import fs from 'node:fs'
import {readLocalLightInput} from './localLightIO.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const input=readLocalLightInput('docs/local-light/bedroom-input.bin.gz'),reference=createSceneLightingReference(input.reference),results=[],root='docs/ceiling-transport'
for(const index of [429,441,440,430]){
 const probe=JSON.parse(fs.readFileSync(`${root}/reference-probe-${index}.json`,'utf8')),resolutions=[]
 for(const size of [16,32,64]){
  const directions:number[][]=[],weights:number[]=[]
  for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const col=-1+(x+.5)*2/size,row=1-(y+.5)*2/size,p=face===0?[1,row,-col]:face===1?[-1,row,col]:face===2?[col,1,-row]:face===3?[col,-1,row]:face===4?[col,row,1]:[-col,row,-1],length=Math.hypot(...p)
   directions.push(p.map(v=>v/length));weights.push(4/length**3)
  }
  const rays=reference.incoming(probe.position,directions,1,1,1,false,1),normalization=4*Math.PI/weights.reduce((s,w)=>s+w,0)
  resolutions.push({size,rawFirst:[0,1,2].map(c=>rays.reduce((s,r,i)=>s+r.firstPass[c]*Math.max(0,-directions[i][1])*weights[i]*normalization,0))})
 }
 results.push({index,resolutions});console.log('reference angular resolution',index,resolutions)
}
fs.writeFileSync(`${root}/resolution-reference.json`,JSON.stringify(results,null,2));reference.dispose()
