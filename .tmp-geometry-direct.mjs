import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runWallRoofClipInputJob } from './src/wallEngine/wallRoofClipJob.ts'
const inputs=JSON.parse(readFileSync('.tmp-geometry-inputs.json','utf8'))
const results=[];const only=process.argv[3]===undefined?null:Number(process.argv[3])
for (const [i,input] of inputs.entries()) {
  if(only!==null&&only!==i)continue
  const start=performance.now()
  const faces=runWallRoofClipInputJob(input)
  const result={i,inputFaces:input.faces.length,roofs:input.input.roofs.length,faces:faces.length,ms:performance.now()-start,hash:createHash('sha256').update(JSON.stringify(faces)).digest('hex')}
  results.push(result);console.log(result)
}
writeFileSync('.tmp-geometry-direct-'+(process.argv[2]??'baseline')+'.json',JSON.stringify(results,null,2))
