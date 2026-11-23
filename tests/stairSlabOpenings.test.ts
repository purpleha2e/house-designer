import assert from 'node:assert/strict'
import test from 'node:test'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import { createStairDesign, getStairLayout, type StairDesign } from '../src/stairDesign.ts'
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

test('the guardrail widens only the stairwell slab and follows rotation, mirroring and scaling', () => {
  const ground = floor('ground', 0), upper = floor('upper', 2.7), loft = floor('loft', 5.4)
  const design: StairDesign = { ...createStairDesign(), upperGuardrail: { side: 'right', oppositeEnd: true, setback: .15 } }
  const { bounds } = getStairLayout(design)
  const definition = { ...stairDefinition, stairDesign: design, localBounds: bounds, height: design.totalRise }
  const definitions = new Map([['stairs', definition]])
  const model: PlacedModel = { id: 'stair', modelId: 'stairs', position: { x: 10, y: 20 }, rotation: Math.PI / 2,
    scale: 2, widthScale: .75, depthScale: .5, mirrored: true, flipped: true }
  ground.models.push(model)
  const floors = [ground, upper, loft]
  const [opening] = getStairSlabOpenings(ground, upper, floors, definitions)
  const limits = (polygon: { x: number; y: number }[]) => [
    Math.min(...polygon.map(p => p.x)), Math.max(...polygon.map(p => p.x)),
    Math.min(...polygon.map(p => p.y)), Math.max(...polygon.map(p => p.y)),
  ].map(value => Number(value.toFixed(6)))
  const extension = .15 - design.postWidth / 2
  assert.deepEqual(limits(opening), [10 + bounds.minZ - extension, 10 + bounds.maxZ,
    20 + bounds.minX * 1.5, 20 + (bounds.maxX + extension) * 1.5].map(value => Number(value.toFixed(6))))
  const [loftOpening] = getStairSlabOpenings(upper, loft, floors, definitions)
  assert.deepEqual(limits(loftOpening), limits(getStairOpeningPolygon(model.position, model.rotation,
    definition.width, definition.depth, model.scale, bounds, model.widthScale, model.depthScale, model.mirrored)))
})

test('a wall keeps its slab support where it crosses a widened stairwell edge', () => {
  const ground = floor('ground', 0), upper = floor('upper', 2.7)
  const design: StairDesign = { ...createStairDesign(), upperGuardrail: { side: 'right', setback: .2 } }
  const { bounds } = getStairLayout(design)
  const definition = { ...stairDefinition, stairDesign: design, localBounds: bounds }
  ground.models.push({ id: 'stair', modelId: 'stairs', position: { x: 0, y: 0 }, rotation: 0, scale: 1 })
  const edge = bounds.maxX + .2 - design.postWidth / 2
  const wall: Wall = { id: 'partition', kind: 'internal', thickness: .12, height: 2.4,
    start: { x: edge, y: -.5 }, end: { x: edge, y: .5 } }
  ground.walls.push(wall)
  const [opening] = getStairSlabOpenings(ground, upper, [ground, upper], new Map([['stairs', definition]]))
  assert.equal(Math.max(...opening.map(p => p.x)), Number(edge.toFixed(6)))
  const insideFace = Number((edge - wall.thickness / 2).toFixed(6))
  assert.deepEqual(opening.filter(p => p.x === insideFace).map(p => p.y).sort((a, b) => a - b), [-.5, .5])
})

test('parametric L-stair openings retain the separate flight footprints under mirroring and rotation', () => {
  const ground = floor('ground', 0)
  ground.models = [{ id: 's', modelId: 'stairs', position: { x: 10, y: 20 }, rotation: Math.PI / 2,
    scale: 2, widthScale: .5, depthScale: 1.5, mirrored: true }]
  const definition = { ...stairDefinition, stairFootprint: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
    [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }],
  ] }
  const polygons = getStairSlabOpenings(ground, null, [ground], new Map([['stairs', definition]]))
  assert.equal(polygons.length, 2)
  assert.deepEqual(polygons[0].map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    [{ x: 10, y: 20 }, { x: 10, y: 19 }, { x: 4, y: 19 }, { x: 4, y: 20 }])
  assert.deepEqual(polygons[1].map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    [{ x: 7, y: 19 }, { x: 7, y: 17 }, { x: 4, y: 17 }, { x: 4, y: 19 }])
})

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

test('stair opening mirrors offset model bounds around its origin', () => {
  const polygon = getStairOpeningPolygon(
    { x: 10, y: 20 },
    0,
    2,
    4,
    2,
    { minX: 0, maxX: 2, minZ: -0.5, maxZ: 3.5 },
    1,
    1,
    true,
  )

  assert.deepEqual(polygon, [
    { x: 6, y: 19 },
    { x: 10, y: 19 },
    { x: 10, y: 27 },
    { x: 6, y: 27 },
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

test('slab openings follow a mirrored stair model with offset local bounds', () => {
  const ground = floor('ground', 0)
  const first = floor('first', 2.7)
  ground.models.push({
    id: 'stairs-1',
    mirrored: true,
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
      { x: 2.2, y: 4 },
      { x: 3.1, y: 4 },
      { x: 3.1, y: 6.6 },
      { x: 2.2, y: 6.6 },
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

test('stairs cut a top-floor horizontal ceiling without an upper storey', () => {
  const top = floor('top', 2.7)
  top.models.push({
    id: 'stairs-1',
    modelId: 'stairs',
    position: { x: 3, y: 4 },
    rotation: 0,
    scale: 1,
  })
  const definitions = new Map([['stairs', stairDefinition]])

  assert.equal(getStairSlabOpenings(top, null, [top], definitions).length, 1)
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
