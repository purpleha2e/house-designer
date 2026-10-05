import test from 'node:test'
import assert from 'node:assert/strict'
import { getModelTransformValues, updateModelTransformField } from '../src/modelTransformFields.ts'
import type { PlacedModel } from '../src/types.ts'
import { getModelOpenings, normalizeFloor } from '../src/modelPlacement.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const model: PlacedModel = { id: 'box', modelId: 'box', position: { x: 3, y: 4 }, rotation: 0.4,
  scale: 2, widthScale: 1.5, depthScale: 0.5 }
const bounds = { minX: -1, maxX: 1, minZ: -2, maxZ: 2 }
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)

test('typing width changes only X and preserves the centre', () => {
  const next = { ...model, ...updateModelTransformField(model, bounds, 'width', 7) }
  const values = getModelTransformValues(next, bounds)
  close(values.width, 7)
  close(values.length, 4)
  close(values.scaleY, 2)
  assert.deepEqual(next.position, model.position)
})

test('typing Y scale preserves independent X/Z scales and footprint dimensions', () => {
  const next = { ...model, ...updateModelTransformField(model, bounds, 'scaleY', 3) }
  const values = getModelTransformValues(next, bounds)
  close(values.scaleX, 3)
  close(values.scaleY, 3)
  close(values.scaleZ, 1)
  close(values.width, 6)
  close(values.length, 4)
})

test('window height changes the model and wall opening without changing width, depth or sill', () => {
  const definition: ModelDefinition = { id: 'large-window', name: 'Large window', category: 'Windows',
    shape: 'box', color: '#fff', width: 1.8, height: 2, depth: 0.08, wallMount: 'window' }
  const definitions = new Map([[definition.id, definition]])
  const source: PlacedModel = { id: 'window', modelId: definition.id, position: { x: 2.5, y: 0 },
    rotation: 0, scale: 1, wallOpeningBottom: 0.3, wallAttachment: { wallId: 'wall', offset: 2.5 } }
  const windowBounds = { minX: -0.9, maxX: 0.9, minZ: 0.00018126, maxZ: 0.08018126 }
  const next = { ...source, ...updateModelTransformField(source, windowBounds, 'height', 1.4, definition.height) }
  close(next.scale, 0.7)
  close(next.scale * next.widthScale!, 1)
  close(next.scale * next.depthScale!, 1)
  assert.deepEqual(next.position, source.position)
  assert.deepEqual(next.wallAttachment, source.wallAttachment)
  assert.equal(next.wallOpeningBottom, 0.3)
  close(getModelTransformValues(next, windowBounds, definition.height).height, 1.4)
  const floor = normalizeFloor(JSON.parse(JSON.stringify({ id: 'floor', name: 'Floor', elevation: 0,
    roomHeight: 2.4, rooms: [], models: [next], walls: [{ id: 'wall', kind: 'external',
      start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.3, height: 2.4 }] })), definitions)
  const opening = getModelOpenings(floor.models[0], floor.walls[0], definitions)[0]
  close(opening.height, 1.4)
  close(opening.width, 1.8)
  close(opening.bottom, 0.3)
})

test('exact X/Z scales and length update the corresponding dimension', () => {
  for (const [field, value, width, length] of [
    ['scaleX', 1.25, 2.5, 4], ['scaleZ', 1.25, 6, 5], ['length', 2.5, 6, 2.5],
  ] as const) {
    const next = { ...model, ...updateModelTransformField(model, bounds, field, value) }
    const values = getModelTransformValues(next, bounds)
    close(values.width, width)
    close(values.length, length)
  }
})

test('typed rotation preserves an off-centre mirrored model centre', () => {
  const offCenter = { minX: 0, maxX: 2, minZ: 1, maxZ: 3 }
  const source = { ...model, mirrored: true, flipped: true }
  const next = { ...source, ...updateModelTransformField(source, offCenter, 'rotation', -90) }
  const center = (item: PlacedModel) => {
    const values = getModelTransformValues(item, offCenter)
    return {
      x: item.position.x + Math.cos(item.rotation) * values.scaleX + Math.sin(item.rotation) * 2 * values.scaleZ,
      y: item.position.y + Math.sin(item.rotation) * values.scaleX - Math.cos(item.rotation) * 2 * values.scaleZ,
    }
  }
  close(center(source).x, center(next).x)
  close(center(source).y, center(next).y)
  close(next.rotation, -Math.PI / 2)
})

test('invalid input does not create zero, negative or nonfinite scales', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => updateModelTransformField(model, bounds, 'scaleX', value))
  }
  assert.throws(() => updateModelTransformField(model, bounds, 'rotation', NaN))
})
