import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMaterialFolderTree, filterMaterialFolderTree, mergeMaterialFolders } from '../src/materials/materialFolders.ts'
import { normalizeMaterialFolder } from '../src/materials/materialFolderPath.ts'
import { changeMaterialCatalogue, emptyMaterialCatalogue, getCatalogueFolderPaths, getMaterialCatalogueFolder } from '../src/materials/materialCatalogueLayout.ts'
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

test('public folders move their contents and removals only affect catalogue browsing', () => {
  const oak: SurfaceMaterialProduct = { ...material('Oak'), id: 'oak', catalogueFolder: 'Wood/Timber' }
  const pine: SurfaceMaterialProduct = { ...material('Pine'), id: 'pine', catalogueFolder: 'Wood/Timber/Light' }
  const materials = [oak, pine]
  let layout = emptyMaterialCatalogue
  const change = (operation: Parameters<typeof changeMaterialCatalogue>[2]) => changeMaterialCatalogue(layout, materials, operation)
  layout = change({ action: 'create-folder', path: 'Wood/Empty' })
  layout = change({ action: 'set-removed', id: pine.id, removed: true })
  assert.throws(() => change({ action: 'delete-folder', path: 'Wood' }), /Move or remove/)
  assert.throws(() => change({ action: 'move-folder', from: 'Wood', to: 'Wood/Empty/Deeper' }), /outside/)
  assert.throws(() => change({ action: 'create-folder', path: 'wood/empty' }), /already exists/)

  layout = change({ action: 'move-folder', from: 'wood', to: 'Finishes/Wood' })
  assert.deepEqual(getCatalogueFolderPaths(layout, materials), ['Finishes', 'Finishes/Wood', 'Finishes/Wood/Empty', 'Finishes/Wood/Timber'])
  assert.deepEqual(layout.entries[pine.id], { folder: 'Finishes/Wood/Timber/Light', removed: true })
  const visible = buildMaterialFolderTree(materials, [], layout)
  const admin = buildMaterialFolderTree(materials, [], layout, true)
  assert.deepEqual(filterMaterialFolderTree(visible, 'Pine'), [])
  assert.equal(filterMaterialFolderTree(admin, 'Pine').length, 1)
  assert.equal(oak.catalogueFolder, 'Wood/Timber')

  layout = change({ action: 'move-material', id: oak.id, folder: '' })
  assert.equal(getMaterialCatalogueFolder(oak, layout), '')
  assert.deepEqual(buildMaterialFolderTree(materials, [], layout).find(folder => folder.name === 'Catalogue')?.materials, [oak])
  layout = change({ action: 'delete-folder', path: 'Finishes/Wood' })
  assert.deepEqual(getCatalogueFolderPaths(layout, materials), [])
  layout = change({ action: 'set-removed', id: pine.id, removed: false })
  assert.equal(getMaterialCatalogueFolder(pine, layout), 'Finishes/Wood/Timber/Light')
  assert.equal(filterMaterialFolderTree(buildMaterialFolderTree(materials, [], layout), 'Pine').length, 1)
})
