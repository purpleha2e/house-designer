import fs from 'node:fs'
import {createGunzip} from 'node:zlib'

/** Read selected arrays directly from the existing diagnostic binary format.
 * Unneeded material images are streamed past, not expanded into memory. */
export async function readGatherInput(path,select=(_path,_descriptor)=>true,onArrayData){
  const input=fs.createReadStream(path,{highWaterMark:64*1024}),stream=input.pipe(createGunzip())
  let prefix=Buffer.alloc(4),filled=0,header,descriptors=[],arrays=[],arrayIndex=0,arrayBytes=0,loadedBytes=0,skippedBytes=0,totalExpected=0
  try{
    for await(const chunk of stream){let offset=0
      while(offset<chunk.length){
        if(!header){
          const count=Math.min(prefix.length-filled,chunk.length-offset);chunk.copy(prefix,filled,offset,offset+count);filled+=count;offset+=count
          if(filled<prefix.length)continue
          if(prefix.length===4){const size=prefix.readUInt32LE();if(size<2||size>32*1024*1024)throw Error('Invalid diagnostic header');prefix=Buffer.alloc(size);filled=0;continue}
          header=JSON.parse(prefix.toString('utf8'))
          const visit=(v,path)=>{if(v?.typed){if(!Number.isInteger(v.index)||v.index<0||!Number.isInteger(v.length)||v.length<0)throw Error('Invalid array descriptor');descriptors[v.index]={...v,path,selected:select(path,v)};return}if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))visit(x,path?path+'.'+k:k)};visit(header,'')
          arrays=descriptors.map(d=>{if(!['Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Uint8ClampedArray'].includes(d.typed))throw Error('Unknown array type');const bytes=globalThis[d.typed].BYTES_PER_ELEMENT*d.length;totalExpected+=bytes;if(d.selected){loadedBytes+=bytes;return new globalThis[d.typed](d.length)}skippedBytes+=bytes;return undefined})
        }else{
          if(arrayIndex>=descriptors.length)throw Error('Unexpected trailing array data')
          const d=descriptors[arrayIndex],bytes=d.length*globalThis[d.typed].BYTES_PER_ELEMENT,count=Math.min(bytes-arrayBytes,chunk.length-offset),target=arrays[arrayIndex]
          if(target)new Uint8Array(target.buffer).set(chunk.subarray(offset,offset+count),arrayBytes)
          if(onArrayData)onArrayData(d.path,d,arrayBytes,chunk.subarray(offset,offset+count))
          offset+=count;arrayBytes+=count
          if(arrayBytes===bytes){arrayIndex++;arrayBytes=0}
        }
      }
    }
    // Trailing zero-length arrays have no bytes to consume.
    while(arrayIndex<descriptors.length&&descriptors[arrayIndex].length===0)arrayIndex++
    if(!header||arrayIndex!==descriptors.length||arrayBytes)throw Error('Truncated diagnostic input')
    const revive=v=>{if(v?.typed)return arrays[v.index]??{...v,skipped:true};if(Array.isArray(v))return v.map(revive);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)]));return v}
    return {data:revive(header),memory:{loadedBytes,skippedBytes,totalExpected}}
  }finally{input.destroy();stream.destroy()}
}
