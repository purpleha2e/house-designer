import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readModelMaterialNames, modelMaterialNamesFromJson } from '../server/model-material-names.mjs'

const json={asset:{version:'2.0'},materials:[{name:'hd_frame'},{name:'unused_hd_part'},{name:'fixed'},{name:'hd_frame'},{name:'hd_quilt'}],
  meshes:[{primitives:[{material:4},{material:0},{material:2},{material:3}]}]}
test('reads assigned names from GLB JSON without requiring geometry or texture decoding',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'hd-slots-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const text=JSON.stringify(json),body=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' ')),buffer=Buffer.alloc(20+body.length+8+4096)
  buffer.write('glTF');buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(body.length,12);buffer.writeUInt32LE(0x4e4f534a,16);body.copy(buffer,20)
  buffer.writeUInt32LE(4096,20+body.length);buffer.writeUInt32LE(0x004e4942,24+body.length)
  const path=join(dir,'bed.glb');await writeFile(path,buffer)
  assert.deepEqual(await readModelMaterialNames(path),['hd_frame','fixed','hd_quilt'])
  const gltf=join(dir,'bed.gltf');await writeFile(gltf,JSON.stringify(json))
  assert.deepEqual(await readModelMaterialNames(gltf),['hd_frame','fixed','hd_quilt'])
  buffer.writeUInt32LE(buffer.length*2,12);await writeFile(path,buffer)
  await assert.rejects(readModelMaterialNames(path),/Invalid GLB JSON length/)
})
test('unused and unnamed materials do not become slots',()=>{
  assert.deepEqual(modelMaterialNamesFromJson({materials:[{name:'hd_unused'},{}],meshes:[]}),[])
})
