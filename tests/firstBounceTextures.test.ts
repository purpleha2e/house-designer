import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import {DataUtils} from 'three'
import {readFirstBounceInput} from './firstBounceTextures.mjs'
test('linear texture readbacks stream to disk and both estimator and reference read identical texels',async()=>{
 const root=fs.mkdtempSync(path.resolve('tmp/first-bounce-texture-test-')),input=path.join(root,'input.bin.gz'),staging=path.join(root,'staged')
 const values=new Uint16Array([.25,.5,.75,1,1,.5,.25,1].map(DataUtils.toHalfFloat)),header=Buffer.from(JSON.stringify({reference:{textures:[{width:2,height:1,pixels:{typed:'Uint16Array',index:0,length:8}}]}})),size=Buffer.alloc(4);size.writeUInt32LE(header.length)
 fs.writeFileSync(input,gzipSync(Buffer.concat([size,header,Buffer.from(values.buffer)])))
 let loaded:Awaited<ReturnType<typeof readFirstBounceInput>>|undefined
 try{loaded=await readFirstBounceInput(input,staging);assert.deepEqual(loaded.textures[0].pixel(0,0),[.25,.5,.75,1]);assert.equal(loaded.referenceTextures[0].pixels[0],values[0]);assert.equal(loaded.memory.loadedBytes,0);assert.equal(loaded.memory.skippedBytes,16);loaded.close();loaded.close();assert.equal(fs.existsSync(staging),false)}finally{loaded?.close();fs.unlinkSync(input);fs.rmdirSync(root)}
})
