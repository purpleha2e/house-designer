import fs from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {roomReference} from '../giPhysicsReference.ts'
const b=await lightingBrowser(),out='docs/gi-physics'
fs.mkdirSync(out,{recursive:true})
try{
 const navigation=await b.call('Page.navigate',{url:'http://localhost:5181/tests/browser/giPhysics.html'});if(navigation.errorText)throw Error(navigation.errorText)
 await b.wait('!!window.giPhysics')
 if(!process.argv.includes('--rooms-only')){const units=await b.evaluate('giPhysics.units()');fs.writeFileSync(`${out}/units-transfer.json`,JSON.stringify(units,null,2));console.log('unit and two-surface checks complete')}
 if(!process.argv.includes('--units-only'))for(const config of [
  {name:'uniform-0',rho:[0,0,0],emission:'all',window:false,sun:0,direction:[0,1,0]},
  {name:'uniform-rgb',rho:[.2,.5,.8],emission:'all',window:false,sun:0,direction:[0,1,0]},
  {name:'uniform-1',rho:[1,1,1],emission:'all',window:false,sun:0,direction:[0,1,0]},
  {name:'ceiling-source',rho:[.5,.5,.5],emission:'ceiling',window:false,sun:0,direction:[0,1,0]},
  ...[0,1,2].map(sun=>({name:`sun-${sun}`,rho:[.5,.5,.5],emission:'none',window:true,sun,direction:[0,.6,-1]})),
  {name:'sun-away',rho:[.5,.5,.5],emission:'none',window:true,sun:1,direction:[0,.6,1]},
 ]){
  if(process.argv.includes('--uniform-only')&&!config.name.startsWith('uniform'))continue
  const result=await b.evaluate(`giPhysics.room(${JSON.stringify(config)})`)
  result.reference=result.passes[0].samples.map(r=>({name:r.name,...roomReference(r.p,r.n,config,1048576,6)}))
  fs.writeFileSync(`${out}/${config.name}.json`,JSON.stringify(result,null,2));console.log('room',config.name,result.elapsedMs,'ms',JSON.stringify(result.passes.at(-1).samples.map(s=>({name:s.name,rgb:s.rgb}))))
 }
 fs.writeFileSync(`${out}/browser-errors.json`,JSON.stringify(b.errors,null,2));if(b.errors.length)throw Error(b.errors.join('\n'))
}catch(error){fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),errors:b.errors},null,2));throw error}finally{b.close()}
