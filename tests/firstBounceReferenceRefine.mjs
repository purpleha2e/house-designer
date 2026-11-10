import fs from 'node:fs'
import {readFirstBounceInput} from './firstBounceTextures.mjs'
import {readGatherInput} from './localFinalGatherInput.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
if(!process.argv.includes('--first-bounce-sun'))throw Error('Diagnostic opt-in required')
const root='docs/first-bounce-sun',loaded=await readFirstBounceInput('docs/sunlit-bounce/scene-input.bin.gz',fs.mkdtempSync('tmp/first-bounce-textures-'),512),d=loaded.data,r=d.reference,{data}=await readGatherInput('docs/sunlit-bounce/reference-input.bin.gz',p=>p==='reference.sourceCategories')
process.once('exit',()=>loaded.close())
const reference=createSceneLightingReference({...r,textures:loaded.referenceTextures,sourceCategories:data.reference.sourceCategories,skyBase:[0,0,0],skySun:[0,0,0],lights:[]}),point=d.points.find(p=>p.name==='dark corner'),samples=1048576,at=performance.now(),Y=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722
try{
 const result=reference.evaluate(point,samples,1,0x317a21,1,true),all=result.solarContributions[0],duvet=result.solarContributions[1],rows=JSON.parse(fs.readFileSync(root+'/reference.json','utf8')),index=rows.findIndex(r=>r.receiver===point.name),old=rows[index]
 rows[index]={...old,samples,rgb:all.cumulative[0],Y:Y(all.cumulative[0]),standardErrorRGB:all.standardError[0],duvetRGB:duvet.cumulative[0],duvetY:Y(duvet.cumulative[0]),duvetStandardErrorRGB:duvet.standardError[0],seconds:(performance.now()-at)/1000,rayCount:result.rays,refinedFromSamples:old.samples}
 fs.writeFileSync(root+'/reference.json',JSON.stringify(rows,null,2));fs.writeFileSync(root+'/reference-refinement.json',JSON.stringify({receiver:point.name,samples,previous:old,current:rows[index],seconds:(performance.now()-at)/1000,textureCacheBytes:loaded.stats.maximumCacheBytes,memory:process.memoryUsage(),noProductionChanges:true},null,2));console.log(JSON.stringify(rows[index]))
}finally{reference.dispose();loaded.close()}
