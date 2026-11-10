import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
export function readLocalLightInput(path){
 const packed=gunzipSync(fs.readFileSync(path)),length=packed.readUInt32LE(0),header=packed.subarray(4,4+length).toString('utf8'),descriptors=[]
 JSON.parse(header,(_,v)=>{if(v?.typed)descriptors[v.index]=v;return v})
 let offset=4+length
 const arrays=descriptors.map(d=>{if(!['Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Uint8ClampedArray'].includes(d.typed))throw Error('Unknown typed array');const C=globalThis[d.typed],n=d.length*C.BYTES_PER_ELEMENT,b=Uint8Array.from(packed.subarray(offset,offset+n));offset+=n;return new C(b.buffer)})
 if(offset!==packed.length)throw Error('Input length mismatch')
 return JSON.parse(header,(_,v)=>v?.typed?arrays[v.index]:v)
}
