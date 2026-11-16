import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { Box3, Matrix4, Vector3 } from 'three'

const root = resolve(import.meta.dirname, '..')
const id = 'f08c2cc3a2f93b9ef8c23d1ea5f3b036'
const project = JSON.parse(await readFile(resolve(root, 'springfield_13.json'), 'utf8'))
const definition = project.modelDefinitions.find(model => model.id === `portal-model-${id}`)
const revision = 'd0a4072'
const source = 'src/models/assets/simple_floating_stairs.glb'
const bytes = execFileSync('git', ['show', `${revision}:${source}`], { cwd: root })
const doc = await new NodeIO().readBinary(new Uint8Array(bytes))
assert.equal(doc.getRoot().listTextures().length, 0, 'Recovered mesh must be self-contained')
const bounds = new Box3()
for (const node of doc.getRoot().listNodes()) {
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const positions = primitive.getAttribute('POSITION'), point = []
    for (let index = 0; index < positions.getCount(); index++) {
      positions.getElement(index, point)
      bounds.expandByPoint(new Vector3(...point).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix())))
    }
  }
}
const size = bounds.getSize(new Vector3())
assert.deepEqual([size.x, size.y, size.z], [definition.width, definition.height, definition.depth])
assert.deepEqual({ minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z }, definition.localBounds)
const directory = resolve(root, 'manufacturer-assets/house-designer/models', id)
const url = `/manufacturer-assets/house-designer/models/${id}`
await mkdir(directory) // Fail rather than overwrite an existing asset.
await mkdir(resolve(directory, 'processed'))
await writeFile(resolve(directory, 'model.glb'), bytes, { flag: 'wx' })
await writeFile(resolve(directory, 'processed/model.glb'), bytes, { flag: 'wx' })
const now = new Date().toISOString()
const file = { fieldName: 'model', contentType: 'model/gltf-binary', originalName: 'simple_floating_stairs.glb', size: bytes.length }
await writeFile(resolve(directory, 'metadata.json'), JSON.stringify({
  id, assetKind: 'model', category: definition.category, collection: '',
  manufacturer: { name: 'House Designer', slug: 'house-designer' },
  metadata: { productName: definition.name, category: definition.category, objectType: definition.objectType },
  inferredDimensions: { ...definition.localBounds, minY: bounds.min.y, maxY: bounds.max.y,
    width: size.x, height: size.y, depth: size.z },
  files: [{ ...file, url: `${url}/model.glb` }],
  processedFiles: [{ ...file, sourceUrl: `${url}/model.glb`, url: `${url}/processed/model.glb` }],
  conversion: { status: 'complete', target: 'original-self-contained-glb' },
  createdAt: now, updatedAt: now,
  recovery: { revision, source, definitionSource: 'springfield_13.json' },
}, null, 2) + '\n', { flag: 'wx' })
console.log(`Recovered ${definition.name}: original ${bytes.length}-byte mesh; dimensions and local bounds exactly match the saved definition.`)
