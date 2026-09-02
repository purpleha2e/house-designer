import assert from 'node:assert/strict'
import test from 'node:test'
import type { FloorLevel } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import {
  getStairOpeningPolygon,
  getStairSlabOpenings,
} from '../src/stairSlabOpenings.ts'

function floor(id: string, elevation: number): FloorLevel {
  return {
    elevation,
    id,
    models: [],
    name: id,
    roomHeight: 2.4,
    rooms: [],
    slabThickness: 0.3,
    walls: [],
  }
}

const stairDefinition: ModelDefinition = {
  category: 'Stairs',
  color: '#000000',
  depth: 2.6,
  height: 2.4,
  id: 'stairs',
  name: 'Stairs',
  objectType: 'stairs',
  shape: 'box',
  width: 0.9,
}

test('stair opening follows model rotation and scale', () => {
  const polygon = getStairOpeningPolygon(
    { x: 4, y: 5 },
    Math.PI / 2,
    1,
    2,
    2,
  )

  const xs = polygon.map((point) => point.x)
  const ys = polygon.map((point) => point.y)
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 4) < 0.000001)
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 2) < 0.000001)
})

test('stair opening exactly matches the scaled model bounds', () => {
  const polygon = getStairOpeningPolygon({ x: 4, y: 5 }, 0, 0.9, 2.6, 1.5)
  const xs = polygon.map((point) => point.x)
  const ys = polygon.map((point) => point.y)

  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 1.35) < 0.000001)
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 3.9) < 0.000001)
})

test('stair opening preserves an offset model origin', () => {
  const polygon = getStairOpeningPolygon(
    { x: 10, y: 20 },
    0,
    2,
    4,
    2,
    { minX: 0, maxX: 2, minZ: -0.5, maxZ: 3.5 },
  )

  assert.deepEqual(polygon, [
    { x: 10, y: 19 },
    { x: 14, y: 19 },
    { x: 14, y: 27 },
    { x: 10, y: 27 },
  ])
})

test('slab openings use uploaded model local bounds', () => {
  const ground = floor('ground', 0)
  const first = floor('first', 2.7)
  ground.models.push({
    id: 'stairs-1',
    modelId: 'stairs',
    position: { x: 3, y: 4 },
    rotation: 0,
    scale: 1,
  })
  const definitions = new Map([
    [
      'stairs',
      {
        ...stairDefinition,
        localBounds: { minX: -0.1, maxX: 0.8, minZ: 0, maxZ: 2.6 },
      },
    ],
  ])

  assert.deepEqual(
    getStairSlabOpenings(ground, first, [ground, first], definitions)[0],
    [
      { x: 2.9, y: 4 },
      { x: 3.8, y: 4 },
      { x: 3.8, y: 6.6 },
      { x: 2.9, y: 6.6 },
    ],
  )
})

test('stairs cut the slab above their owning floor, not the slab below', () => {
  const ground = floor('ground', 0)
  const first = floor('first', 2.7)
  const second = floor('second', 5.4)
  first.models.push({
    id: 'stairs-1',
    modelId: 'stairs',
    position: { x: 3, y: 4 },
    rotation: 0,
    scale: 1,
  })
  const definitions = new Map([['stairs', stairDefinition]])
  const floors = [ground, first, second]

  assert.equal(getStairSlabOpenings(ground, first, floors, definitions).length, 0)
  assert.equal(getStairSlabOpenings(first, second, floors, definitions).length, 1)
})

test('a tall stair object cuts every slab it reaches', () => {
  const ground = floor('ground', 0)
  const first = floor('first', 2.7)
  const second = floor('second', 5.4)
  ground.models.push({
    id: 'stairs-1',
    modelId: 'stairs',
    position: { x: 3, y: 4 },
    rotation: 0,
    scale: 2.4,
  })
  const definitions = new Map([['stairs', stairDefinition]])
  const floors = [ground, first, second]

  assert.equal(getStairSlabOpenings(ground, first, floors, definitions).length, 1)
  assert.equal(getStairSlabOpenings(first, second, floors, definitions).length, 1)
})
