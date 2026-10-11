import assert from 'node:assert/strict'
import test from 'node:test'
import { NodeIO } from '@gltf-transform/core'
import { documentBounds } from '../scripts/generate-u-winder-stairs.mjs'
import { getStairLandingPosition } from '../src/stairLandings.ts'
import { getViewerStairTransitions } from '../src/viewer/viewerNavigation.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel, PlacedModel } from '../src/types.ts'

const definition = {
  id: 'u-winder-stairs-right-157cm', objectType: 'stairs', width: 1.57, depth: 2.4, height: 3.6,
  stairLandings: { lower: { x: 0.415, y: 1.2 }, upper: { x: -0.415, y: 1.2 } },
} as ModelDefinition
const model = { id: 'stair', modelId: definition.id, position: { x: 0, y: 0 }, rotation: 0, scale: 1 } as PlacedModel
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

test('shipped U-winder stair has a 157cm footprint and 270cm walking rise', async () => {
  const document = await new NodeIO().read('src/models/assets/u_winder_stairs_right_157cm.glb')
  const bounds = documentBounds(document)
  close(bounds.max[0] - bounds.min[0], 1.57)
  close(bounds.max[2] - bounds.min[2], 2.4)
  close(bounds.min[1], 0)
  close(bounds.max[1], 3.6) // Includes the 90cm handrail above the upper landing.
  const treads = document.getRoot().listNodes().filter(node => /^(lower|winder|upper)_\d+_tread$/.test(node.getName()))
  assert.equal(treads.length, 18)
  assert.equal(treads.filter(node => node.getName().startsWith('winder_')).length, 6)
  for (let index = 0; index < treads.length; index++) {
    const primitive = treads[index].getMesh()!.listPrimitives()[0]
    close(treads[index].getTranslation()[1] + primitive.getAttribute('POSITION')!.getMax([])[1], (index + 1) * 0.15)
    assert.ok(primitive.getAttribute('TEXCOORD_0'), 'treads support applied material textures')
    assert.equal(primitive.getMaterial()!.getName(), 'stairs_steps')
  }
  assert.ok(treads[0].getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getMin([])[0] > 0, 'lower flight is on the right')
  assert.ok(treads.at(-1)!.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getMax([])[0] < 0, 'upper flight returns on the left')
  // Sum upward triangle areas: the six winders tile the complete square U bend.
  let area = 0
  for (const node of treads.filter(node => node.getName().startsWith('winder_'))) {
    const primitive = node.getMesh()!.listPrimitives()[0]
    const positions = primitive.getAttribute('POSITION')!.getArray()!
    const normals = primitive.getAttribute('NORMAL')!.getArray()!
    for (let offset = 0; offset < positions.length; offset += 9) {
      if (normals[offset + 1] < 0.99) continue
      const ax = positions[offset], az = positions[offset + 2]
      const bx = positions[offset + 3], bz = positions[offset + 5]
      const cx = positions[offset + 6], cz = positions[offset + 8]
      area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2
    }
  }
  close(area, 2 * (0.785 ** 2 - 0.045 ** 2))
})

test('U-stair landings remain on their respective front flights when mirrored, scaled and rotated', () => {
  assert.deepEqual(getStairLandingPosition(model, definition, 'lower'), { x: 0.415, y: 1.2 })
  assert.deepEqual(getStairLandingPosition(model, definition, 'upper'), { x: -0.415, y: 1.2 })
  assert.deepEqual(getStairLandingPosition(model, definition, 'lower', 0.2), { x: 0.415, y: 1 })
  const transformed = { ...model, position: { x: 10, y: 20 }, rotation: Math.PI / 2,
    scale: 2, widthScale: 0.5, depthScale: 1.5, mirrored: true }
  const lower = getStairLandingPosition(transformed, definition, 'lower', 0.2)
  close(lower.x, 6.6); close(lower.y, 19.585)
  const upper = getStairLandingPosition(transformed, definition, 'upper')
  close(upper.x, 6.4); close(upper.y, 20.415)
})

test('tour buttons ascend on the right and descend on the left of a U stair', () => {
  const ground = { id: 'ground', name: 'Ground', elevation: 0, models: [model] } as FloorLevel
  const first = { id: 'first', name: 'First', elevation: 2.7, models: [] } as unknown as FloorLevel
  const definitions = new Map([[definition.id, definition]])
  const [up] = getViewerStairTransitions(ground, [ground, first], definitions)
  const [down] = getViewerStairTransitions(first, [ground, first], definitions)
  assert.deepEqual(up.from, { x: 0.415, y: 1.2 })
  assert.deepEqual(up.to, { x: -0.415, y: 1.2 })
  assert.deepEqual(down.from, up.to)
  assert.deepEqual(down.to, up.from)
})
