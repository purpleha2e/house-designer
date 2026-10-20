import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMaterialFolderTree, filterMaterialFolderTree, mergeMaterialFolders } from '../src/materials/materialFolders.ts'
import { normalizeMaterialFolder } from '../src/materials/materialFolderPath.ts'
import { indirectAssetIdentity } from '../src/indirectLightingPersistence.ts'
import { validateLocalMaterial } from '../src/materials/localMaterials.ts'
import type { SurfaceMaterialProduct } from '../src/types.ts'

const material = (id: string, folder?: string): SurfaceMaterialProduct => ({
  id: `local-material-${id}`, folder, manufacturer: 'My materials', category: 'wall-covering', productName: id, pbr: { roughness: .7 },
})

test('material hierarchy combines nested personal folders, loose legacy materials and catalogue groups without duplicating case variants', () => {
  const red = material('Reclaimed brick', 'Bricks/Red'), legacy = material('Old material')
  const chrome = material('Polished chrome', 'metals/Chrome')
  const catalogue: SurfaceMaterialProduct = { ...material('Factory brick'), id: 'factory-brick',
    folder: undefined, materialType: 'brick', manufacturer: 'Acme', collection: 'Traditional' }
  const tree = buildMaterialFolderTree([legacy, red, chrome, catalogue], ['Metals/Chrome', 'Bricks', 'Empty'])
  assert.deepEqual(tree.map(node => node.name), ['My materials', 'Catalogue'])
  assert.deepEqual(tree[0].materials, [legacy])
  assert.deepEqual(tree[0].folders.find(node => node.name === 'Bricks')!.folders[0].materials, [red])
  assert.equal(tree[0].folders.filter(node => node.name.toLowerCase() === 'metals').length, 1)
  assert.deepEqual(tree[0].folders.find(node => node.name === 'Metals')!.folders[0].materials, [chrome])
  assert.equal(tree[1].folders[0].name, 'Bricks')
  assert.deepEqual(tree[1].folders[0].folders[0].folders[0].materials, [catalogue])
  assert.ok(tree[0].folders.some(node => node.name === 'Empty'))
  const result = filterMaterialFolderTree(tree, 'reclaimed')
  assert.equal(result.length, 1)
  assert.equal(result[0].folders.length, 1)
  assert.equal(result[0].folders[0].folders[0].materials[0].id, red.id)
  assert.deepEqual(filterMaterialFolderTree(tree, 'nothing matches'), [])
})

test('folder paths travel with material files and do not invalidate saved lighting', () => {
  const before = material('Bricks', 'Bricks/Red')
  const after = JSON.parse(JSON.stringify({ ...before, folder: 'Walls/Reclaimed' }))
  validateLocalMaterial(after)
  assert.equal(after.folder, 'Walls/Reclaimed')
  assert.deepEqual(indirectAssetIdentity(before), indirectAssetIdentity(after))
  assert.equal(normalizeMaterialFolder(' Bricks // Red / '), 'Bricks/Red')
  assert.deepEqual(mergeMaterialFolders(['Metals/Chrome', 'metals/Brushed']), ['Metals', 'Metals/Brushed', 'Metals/Chrome'])
  assert.throws(() => normalizeMaterialFolder('Bricks/../Paint'), /folder levels/)
  assert.throws(() => validateLocalMaterial({ ...before, folder: 1 }), /folder/)
})
