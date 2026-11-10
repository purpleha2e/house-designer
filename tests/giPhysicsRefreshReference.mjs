import fs from 'node:fs'
import {roomReference} from './giPhysicsReference.ts'
// Refine independent-reference statistics without rerunning or changing the GPU.
for(const name of ['uniform-0','uniform-rgb','uniform-1','ceiling-source','sun-0','sun-1','sun-2','sun-away']){
 const path=`docs/gi-physics/${name}.json`,data=JSON.parse(fs.readFileSync(path))
 data.reference=data.passes[0].samples.map(r=>({name:r.name,...roomReference(r.p,r.n,data.config,1048576,6)}))
 fs.writeFileSync(path,JSON.stringify(data,null,2));console.log(name,'reference complete')
}
