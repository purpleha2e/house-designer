import fs from 'node:fs'
import {readLocalLightInput} from './localLightIO.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
const root='docs/sunlit-bounce',data=readLocalLightInput(`${root}/reference-input.bin.gz`),ref=createSceneLightingReference(data.reference),samples=Number(process.argv[2]??262144),results=[],started=performance.now()
try{for(const point of data.points){const at=performance.now(),result=ref.evaluate(point,samples,6,20261105,6,true);results.push({...result,ms:performance.now()-at});console.log(point.name,JSON.stringify(result.solarContributions.map(s=>({name:s.name,rgb:s.cumulative[5],se:s.standardError[5]}))));fs.writeFileSync(`${root}/reference.json`,JSON.stringify({samples,results,elapsedMs:performance.now()-started},null,2))}}finally{ref.dispose()}
