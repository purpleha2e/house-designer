// Blender interchange copy: core glTF + embedded PNG, without runtime KTX2.
// Run after generating the island: node scripts/export-waterfall-island-blender.mjs
import { NodeIO } from '@gltf-transform/core'
import { KHRTextureBasisu } from '@gltf-transform/extensions'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

export async function exportBlenderIsland(png) {
  const io=new NodeIO().registerExtensions([KHRTextureBasisu])
  const doc=await io.read('src/models/assets/waterfall_shaker_island.glb')
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0])
  const textures=doc.getRoot().listTextures()
  assert.equal(textures.length,1)
  textures[0].setImage(png).setMimeType('image/png')
  for(const extension of doc.getRoot().listExtensionsUsed())extension.dispose()
  const output='exports/waterfall_shaker_island_blender.glb'
  await mkdir('exports',{recursive:true})
  await new NodeIO().write(output,doc)
  // Read without any extension registration, exactly as a core glTF client.
  const verified=await new NodeIO().read(output)
  assert.equal(verified.getRoot().listExtensionsRequired().length,0)
  assert.equal(verified.getRoot().listTextures()[0].getMimeType(),'image/png')
  assert.deepEqual(verified.getRoot().listMaterials().map(m=>m.getName()),doc.getRoot().listMaterials().map(m=>m.getName()))
  console.log(JSON.stringify({output,bytes:(await stat(output)).size,materials:verified.getRoot().listMaterials().map(m=>m.getName()),requiredExtensions:[]},null,2))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await exportBlenderIsland(new Uint8Array(await readFile('tmp/waterfall-island/stone.png')))
