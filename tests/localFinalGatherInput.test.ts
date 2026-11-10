import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import {readGatherInput} from './localFinalGatherInput.mjs'

async function fixture(data:Buffer,run:(file:string)=>Promise<void>){
  const dir=fs.mkdtempSync(path.resolve('tmp/local-final-gather-reader-')),file=path.join(dir,'input.bin.gz')
  try{fs.writeFileSync(file,gzipSync(data));await run(file)}finally{fs.unlinkSync(file);fs.rmdirSync(dir)}
}
function packed(header:unknown,arrays:ArrayBufferView[]){const h=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32LE(h.length);return Buffer.concat([length,h,...arrays.map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))])}
test('diagnostic reader streams selected arrays, skips images and handles empty arrays',async()=>{
  const header={geometry:{positions:{typed:'Float32Array',index:0,length:3}},empty:{typed:'Uint8Array',index:1,length:0},image:{typed:'Uint16Array',index:2,length:4},last:{typed:'Uint8Array',index:3,length:0}}
  await fixture(packed(header,[new Float32Array([1,2,3]),new Uint8Array(),new Uint16Array([4,5,6,7]),new Uint8Array()]),async file=>{
    const result=await readGatherInput(file,(key:string)=>key.startsWith('geometry.'))
    assert.deepEqual(Array.from(result.data.geometry.positions),[1,2,3]);assert.equal(result.data.image.skipped,true)
    assert.equal(result.memory.loadedBytes,12);assert.equal(result.memory.skippedBytes,8)
  })
})
test('diagnostic reader rejects a truncated typed-array payload',async()=>{
  await fixture(packed({values:{typed:'Float32Array',index:0,length:4}},[new Float32Array([1,2])]),async file=>{
    await assert.rejects(readGatherInput(file),/Truncated diagnostic/)
  })
})
test('diagnostic reader rejects unsupported array constructors and trailing bytes',async()=>{
  await fixture(packed({values:{typed:'UnsafeArray',index:0,length:0}},[]),async file=>{await assert.rejects(readGatherInput(file),/Unknown array type/)})
  await fixture(packed({values:{typed:'Uint8Array',index:0,length:1}},[new Uint8Array([1,2])]),async file=>{await assert.rejects(readGatherInput(file),/trailing array data/)})
})
