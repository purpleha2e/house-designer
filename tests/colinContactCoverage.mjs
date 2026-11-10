import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {restoreIndirectVisibility} from '../src/indirectVisibility.ts'

const dir=process.argv[2]??'docs/colin-contact-fix/iteration-11'
async function scan(path){const{field}=await loadIndirectLighting(JSON.parse(readFileSync(path)),{reflections:false});try{const l=field.floorLayer,bits=new Uint8Array(l.n*l.n*l.height),floors=new Uint32Array(l.height);for(let floor=0;floor<l.height;floor++)for(let z=0;z<l.n;z++)for(let x=0;x<l.n;x++){const id=(floor*l.n+z)*l.n+x;bits[id]=l.data[((z*l.height*field.coefficientCount+floor)*l.n+x)*4+3]>0?1:0;floors[floor]+=bits[id]}return{bits,floors:Array.from(floors),n:l.n,bounds:field.bounds,elevations:field.floors.map(f=>f.elevation)}}finally{field.dispose()}}
const before=await scan('docs/gi-spatial-accuracy/baseline/field-cache.json'),after=await scan(`${dir}/field-cache.json`);assert.equal(before.n,after.n);assert.deepEqual(before.bounds,after.bounds)
const cameras=[...JSON.parse(readFileSync('docs/colin-contact-shading/verified/cameras.json')),...JSON.parse(readFileSync('docs/lighting-correctness/verified/results.json')).map(r=>r.camera)],raw=gunzipSync(readFileSync('docs/colin-contact-fix/baseline/geometry.f32.gz')),visibility=restoreIndirectVisibility({positions:new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),tree:null}),lost=[],gained=[],visible=[],p=new Vector3(),o=new Vector3(),d=new Vector3()
try{for(let i=0;i<before.bits.length;i++){if(before.bits[i]===after.bits[i])continue;if(after.bits[i]){gained.push(i);continue}lost.push(i);const floor=Math.floor(i/(before.n*before.n)),cell=i%(before.n*before.n),x=cell%before.n,z=Math.floor(cell/before.n);p.set(before.bounds.minX+x/(before.n-1)*before.bounds.size,before.elevations[floor]+.016,before.bounds.minZ+z/(before.n-1)*before.bounds.size)
 if(cameras.some(c=>{o.fromArray(c.position);d.subVectors(p,o);const length=d.length();return !visibility.occluded(o,d.divideScalar(length),length-.0002,.0001)}))visible.push(p.toArray())
}const result={baseline:before.floors,candidate:after.floors,lost:lost.length,gained:gained.length,lostVisibleFromAuditCameras:visible.length,firstVisibleLosses:visible.slice(0,50),method:'First SH slab coverage alpha at every floor texel, plus exact physical visibility from all ten retained audit camera positions. Valid black radiance retains coverage.'};writeFileSync(`${dir}/coverage.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result))}finally{visibility.dispose()}
