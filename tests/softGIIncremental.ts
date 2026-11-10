import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {readDoorInput} from './doorPipelineInput.mjs'
import {prepareSoftGIGraph,filterSoftGI} from './softGIFilter.ts'
const read=(name:string,C:any)=>new C(Uint8Array.from(gunzipSync(fs.readFileSync(`docs/soft-gi/original/${name}.gz`))).buffer),graph={...JSON.parse(fs.readFileSync('docs/soft-gi/original/graph.json','utf8')),a:read('a',Uint32Array),b:read('b',Uint32Array),d2:read('d2',Float32Array),valid:read('valid',Uint8Array)}
const input=readDoorInput('moved'),loaded=await loadIndirectLighting(JSON.parse(fs.readFileSync('docs/door-confidence/moved-field.json','utf8')),{reflections:false,allowLegacy:true}),field=loaded!.field,visibility=createIndirectVisibilityFromSnapshot(input.geometry),toX=(x:number)=>Math.round((x-field.bounds.minX)/graph.step),toZ=(z:number)=>Math.round((z-field.bounds.minZ)/graph.step)
// Union of old and moved door assembly bounds plus the maximum filter reach.
const bounds={floor:0,minX:toX(-.5),maxX:toX(3.4),minZ:toZ(13.1),maxZ:toZ(16)},updated=prepareSoftGIGraph(field,visibility,.2,undefined,{previous:graph,bounds}),filtered=filterSoftGI(field.floorLayer.data,updated,.1),expected=new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync('docs/soft-gi/moved/10cm.rgba16f.gz'))).buffer)
let changed=0,max=0;for(let i=0;i<expected.length;i++)if(expected[i]!==filtered.output[i]){changed++;max=Math.max(max,Math.abs(expected[i]-filtered.output[i]))}
fs.writeFileSync('docs/soft-gi/incremental-geometry.json',JSON.stringify({bounds,graph:updated.statistics,filter:filtered.statistics,changedHalfFloatWords:changed,maxWordDifference:max,note:'Old and translated assembly snapshots; retained pairs outside dirty area. Vertex support is conservatively rechecked across the whole floor. Floating-point accumulation order can differ after pair reuse.'},null,2));console.log(updated.statistics,{changed,max});visibility.dispose();field.dispose()

