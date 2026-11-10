// node tests/doorConfidenceReplay.mjs original [reuse-reference]
import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {build} from 'vite'
const name=process.argv[2]??'original',directory='docs/door-confidence/'
if(!/^[a-z0-9_-]+$/.test(name))throw Error('Invalid configuration')
const packed=gunzipSync(fs.readFileSync(`${directory}${name}-input.bin.gz`)),length=packed.readUInt32LE(0)
const header=packed.subarray(4,4+length).toString('utf8'),descriptors=[]
JSON.parse(header,(_,v)=>{if(v?.typed)descriptors[v.index]=v;return v})
let offset=4+length
const arrays=descriptors.map(d=>{const C=globalThis[d.typed];if(!['Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Uint8ClampedArray'].includes(d.typed))throw Error('Unknown typed array');const n=d.length*C.BYTES_PER_ELEMENT;const b=Uint8Array.from(packed.subarray(offset,offset+n));offset+=n;return new C(b.buffer)})
const input=JSON.parse(header,(_,v)=>v?.typed?arrays[v.index]:v)
if(process.argv.includes('refine-grid')){
 input.samples=6144
 const refined=JSON.parse(fs.readFileSync(`${directory}${name}-notch-refined-results.json`,'utf8'))
 for(const p of input.points){const r=refined.points.find(r=>r.name===p.name);if(r)p.reference=r.reference}
}
if(process.argv.includes('refine-notch')){
 input.points=input.points.filter(p=>['trace-3','trace-4','trace-5','trace-6'].includes(p.name))
 for(const p of input.points)delete p.reference
 input.samples=65536;input.configuration=name+'-notch-refined'
}
if(process.argv.includes('reuse-reference')){
 const previous=JSON.parse(fs.readFileSync(`${directory}${name}-results.json`,'utf8'))
 for(const point of input.points)point.reference=previous.points.find(p=>p.name===point.name).reference
}
const fixed=process.argv.find(a=>a.startsWith('fixed-field='))?.slice('fixed-field='.length)
if(fixed){
 if(!/^[a-z0-9_-]+$/.test(fixed))throw Error('Invalid fixed field')
 const {loadIndirectLighting}=await import('../src/indirectLightingPersistence.ts')
 const {serializeIndirectField}=await import('../src/indirectLighting.ts')
 const cache=JSON.parse(fs.readFileSync(`${directory}${fixed}-field.json`,'utf8'))
 const loaded=await loadIndirectLighting(cache,{reflections:false,allowLegacy:true})
 input.field=serializeIndirectField(loaded.field);input.coefficients=loaded.field.coefficients
 input.configuration=`${name}-fixed-${fixed}`
}
await build({configFile:false,publicDir:false,logLevel:'warn',build:{emptyOutDir:false,outDir:'tmp/door-confidence',lib:{entry:'tests/browser/doorConfidence.worker.ts',name:'DoorConfidence',formats:['iife'],fileName:()=> 'worker.js'},minify:false}})
globalThis.self={postMessage(data){
 if(data.ok===undefined){if(data.progress%25===0)console.log(data);return}
 data.replayMemory=process.memoryUsage()
 fs.writeFileSync(`${directory}${input.configuration}-results.json`,JSON.stringify(data))
 console.log({ok:data.ok,error:data.error,elapsedMs:data.elapsedMs,memory:data.replayMemory})
}}
await import('../tmp/door-confidence/worker.js')
self.onmessage({data:input})
