import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Box3, Matrix4, Vector3 } from 'three'
import { NodeIO } from '@gltf-transform/core'
import { getImportedModelTransform } from '../src/importedModelTransform.ts'

test('front door fits the existing wall opening by its fixed frame while retaining the open leaf', async () => {
  const document = await new NodeIO().read(fileURLToPath(new URL('../src/models/assets/front_door.glb', import.meta.url)))
  const bounds = new Box3(), frame = new Box3()
  for (const node of document.getRoot().listNodes()) {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix())
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute('POSITION')!
      for (let i = 0; i < positions.getCount(); i++) {
        const vertex = new Vector3(...positions.getElement(i, [])).applyMatrix4(matrix)
        bounds.expandByPoint(vertex)
        if (node.getName() === 'Cube.003') frame.expandByPoint(vertex)
      }
    }
  }
  assert.ok(!frame.isEmpty(), 'the exported frame node exists')
  assert.ok(bounds.getSize(new Vector3()).z > frame.getSize(new Vector3()).z * 5,
    'the actual open leaf extends well beyond the fixed frame')
  const target = new Vector3(.97, 2.1, .08)
  const result = getImportedModelTransform(bounds, target, true, frame)
  assert.ok(result.placementBounds.getSize(new Vector3()).distanceTo(target) < 1e-9)
  assert.ok(Math.abs(result.placementBounds.min.y) < 1e-9, 'frame seats on the floor')
  assert.ok(Math.abs(result.placementBounds.min.x + .485) < 1e-9)
  assert.ok(Math.abs(result.placementBounds.max.x - .485) < 1e-9,
    'frame stops at the sidelight boundary instead of overlapping its face')
  assert.ok(Math.abs(result.placementBounds.min.z + .04) < 1e-9)
  assert.ok(Math.abs(result.placementBounds.max.z - .04) < 1e-9)
  const leafDepth = bounds.getSize(new Vector3()).z * result.scale.z
  assert.ok(leafDepth > .6, 'normalization retains the open door depth rather than flattening it to 8 cm')
})

test('ordinary imported assets retain their original normalization and pivot', () => {
  const bounds = new Box3(new Vector3(-1, .2, -2), new Vector3(1, 2.2, 2))
  const target = new Vector3(1, 3, .4)
  const normalized = getImportedModelTransform(bounds, target, true)
  assert.deepEqual(normalized.scale.toArray(), [.5, 1.5, .1])
  assert.deepEqual(normalized.offset.toArray(), [0, 0, 0])
  assert.ok(normalized.size.distanceTo(target) < 1e-9)
  const unchanged = getImportedModelTransform(bounds, target, false)
  assert.deepEqual(unchanged.scale.toArray(), [1, 1, 1])
  assert.deepEqual(unchanged.offset.toArray(), [0, 0, 0])
  assert.ok(unchanged.placementBounds.equals(bounds))
})
