import fs from 'node:fs'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const out='docs/local-light',loaded=await loadIndirectLighting(JSON.parse(fs.readFileSync('docs/door-confidence/original-field.json','utf8')),{reflections:false,allowLegacy:true})
assert.ok(loaded);const field=loaded.field,original=field.floorLayer.data
const groups={door:JSON.parse(fs.readFileSync(`${out}/original.json`,'utf8')).points,staircase:JSON.parse(fs.readFileSync(`${out}/staircase.json`,'utf8'))},results=[]
for(const mode of ['baseline','conservative','masked','baseline-10cm','conservative-10cm','masked-10cm']){
 const data=new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync(`${out}/${mode}.rgba16f.gz`))).buffer);field.floorLayer.data=data
 const sets=Object.fromEntries(Object.entries(groups).map(([name,points])=>{
  const sampled=(points as any[]).map(p=>({name:p.name,referenceRGB:p.referenceRGB,rgb:sampleBakedIndirectFloor(field,0,new Vector3().fromArray(p.position),new Vector3(0,1,0)).rgb}))
  const mae=sampled.reduce((sum,p)=>sum+p.rgb.reduce((s,v,c)=>s+Math.abs(v-p.referenceRGB[c]),0)/3,0)/sampled.length
  return[name,{mae,points:sampled}]
 }));results.push({mode,sets})
}
fs.writeFileSync(`${out}/stored-comparison.json`,JSON.stringify(results));field.floorLayer.data=original;field.dispose()
console.log('stored field comparisons',results.map(r=>[r.mode,(r.sets.door as any).mae,(r.sets.staircase as any).mae]))
