// CPU-only, counterbalanced comparison. No browser, renderer or GL context.
// Pass an archived baseline module and an output path.
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {cacheLightingUniformArrays as candidate} from '../src/rendererUniformArrays.ts'
import {Matrix4,Vector2} from 'three'
const {cacheLightingUniformArrays:reference}=await import(pathToFileURL(path.resolve(process.argv[2])).href)
const data=[
  ['hdGIPointIndices',0x1406,new Float32Array(128).fill(-1)],
  ['hdGIFloorRanges',0x8b50,[new Vector2(0,2.5),new Vector2(2.5,5)]],
  ['hdLightPortalEdgeRanges',0x8b50,Array.from({length:16},(_,i)=>new Vector2(i,i+1))],
  ['directionalShadowMatrix',0x8b5c,[new Matrix4()]],
  ['pointShadowMatrix',0x8b5c,Array.from({length:6},()=>new Matrix4())],
  ['hdPointLightRoomIds',0x1406,new Float32Array(11)],
  ['hdLightPortalHeights',0x1406,new Float32Array(16)],
]
const checksum={value:0}
const fixture=(install,[id,type,value])=>{
  const uniform={id,type,size:value.length,setValue(_gl,v){checksum.value+=v.length}}
  install({seq:[uniform]});uniform.setValue(null,value)
  return ()=>uniform.setValue(null,value)
}
const trials=[]
for(const item of data){
  const arms={reference:fixture(reference,item),candidate:fixture(candidate,item)}
  for(const arm of Object.values(arms))for(let i=0;i<20000;i++)arm()
  const rows={reference:[],candidate:[]},iterations=100000
  for(let repeat=0;repeat<8;repeat++)for(const name of repeat%2?['candidate','reference']:['reference','candidate']){
    const start=performance.now()
    for(let i=0;i<iterations;i++)arms[name]()
    rows[name].push((performance.now()-start)*1e6/iterations)
  }
  const median=values=>[...values].sort((a,b)=>a-b).slice(3,5).reduce((a,b)=>a+b)/2
  const old=median(rows.reference),next=median(rows.candidate)
  trials.push({name:item[0],referenceNs:old,candidateNs:next,ratio:next/old,trials:rows})
}
const result={scope:'CPU cache comparison only; does not predict whole viewport FPS',trials,checksum:checksum.value}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2))
console.log(JSON.stringify(trials.map(({trials,...row})=>row),null,2))
