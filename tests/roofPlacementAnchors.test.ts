import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildRoofAttachmentContext, getClosestExternalWallPoint, getRoofPlacementSnapPoints } from '../src/roofPlacementAnchors.ts'
import type { FloorLevel, Wall } from '../src/types.ts'

function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: Wall['kind'] = 'external',
): Wall {
  return { end, height: 2.4, id, kind, start, thickness: 0.3 }
}

test('offers roof anchors at 100 mm stations along external walls', () => {
  const walls = [wall('horizontal', { x: 0, y: 0 }, { x: 5, y: 0 })]

  assert.deepEqual(
    getClosestExternalWallPoint({ x: 2.36, y: 0.05 }, walls),
    { x: 2.4, y: 0 },
  )
})

test('offers roof anchors beyond both ends of an isolated external wall', () => {
  const walls = [wall('horizontal', { x: 0, y: 0 }, { x: 5, y: 0 })]

  assert.deepEqual(
    getClosestExternalWallPoint({ x: 6.24, y: 0.04 }, walls),
    { x: 6.2, y: 0 },
  )
  assert.deepEqual(
    getClosestExternalWallPoint({ x: -1.24, y: -0.04 }, walls),
    { x: -1.2, y: 0 },
  )
})

test('projects an external wall through the footprint to create an aligned roof anchor', () => {
  const walls = [
    wall('top', { x: 0.03, y: 0 }, { x: 5.03, y: 0 }),
    wall('bottom', { x: 0, y: 4 }, { x: 5, y: 4 }),
    wall('projecting', { x: 2.36, y: 4 }, { x: 2.36, y: 7 }),
  ]

  assert.ok(getRoofPlacementSnapPoints(walls).some((point) =>
    Math.hypot(point.x - 2.36, point.y) < 0.000001))
  assert.deepEqual(
    getClosestExternalWallPoint({ x: 2.37, y: 0.03 }, walls),
    { x: 2.36, y: 0 },
  )
})

test('projects a wall which terminates at the face of a thick external wall', () => {
  const walls = [
    wall('top', { x: 0.03, y: 0 }, { x: 5.03, y: 0 }),
    wall('bottom', { x: 0, y: 4 }, { x: 5, y: 4 }),
    wall('projecting', { x: 2.36, y: 4.15 }, { x: 2.36, y: 7 }),
  ]

  assert.ok(getRoofPlacementSnapPoints(walls).some((point) =>
    Math.hypot(point.x - 2.36, point.y) < 0.000001))
})

test('shows the centreline join between an external wall and an internal wall', () => {
  const walls = [
    wall('external', { x: 0, y: 0 }, { x: 5, y: 0 }),
    wall('internal', { x: 2.36, y: 0.15 }, { x: 2.36, y: 3 }, 'internal'),
  ]

  assert.ok(getRoofPlacementSnapPoints(walls).some((point) =>
    Math.hypot(point.x - 2.36, point.y) < 0.000001))
})

test('hover snapping uses the exact marker at a wall endpoint', () => {
  const walls = [
    wall('horizontal', { x: 0, y: 0 }, { x: 5, y: 0 }),
    wall('vertical', { x: 5, y: 0 }, { x: 5, y: 4 }),
  ]

  assert.deepEqual(
    getClosestExternalWallPoint({ x: 4.89, y: 0.015 }, walls),
    { x: 5, y: 0 },
  )
})

test('100 mm roof stations remain exactly on an angled wall', () => {
  const angled = wall('angled', { x: 0.03, y: 0.02 }, { x: 4.03, y: 1.02 })
  const anchor = getClosestExternalWallPoint({ x: 2.35, y: 0.61 }, [angled])
  assert.ok(anchor)
  const crossProduct =
    (anchor.x - angled.start.x) * (angled.end.y - angled.start.y) -
    (anchor.y - angled.start.y) * (angled.end.x - angled.start.x)
  assert.ok(Math.abs(crossProduct) < 0.00001)
})

test('does not offer roof anchors on internal walls', () => {
  const walls = [wall(
    'internal',
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    'internal',
  )]

  assert.equal(getClosestExternalWallPoint({ x: 2, y: 0 }, walls), null)
})

test('selecting the red-house ground-floor roof keeps stacked storeys out of the same room union', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const before = JSON.stringify(floors)
  const context = buildRoofAttachmentContext(floors, floors[0].elevation)
  assert.ok(context.rooms.length > 0)
  assert.ok(context.rooms.every((room) => Number.isFinite(room.area) && room.area > 0))
  for (const floor of floors) assert.ok(floor.walls.every((wall) => context.walls.includes(wall)))
  const upperContext = buildRoofAttachmentContext(floors, floors[1].elevation)
  assert.ok(upperContext.walls.every((wall) => floors[1].walls.includes(wall)))
  assert.equal(JSON.stringify(floors), before)
})

test('overlapping rooms on different storeys remain separate roof-placement regions', () => {
  const floors: FloorLevel[] = [0, 2.6].map((elevation, index) => ({
    id: `floor-${index}`, name: `Floor ${index}`, elevation, roomHeight: 2.4,
    slabThickness: 0.2, models: [], rooms: [], walls: [
      wall(`${index}:a`, { x: 0, y: 0 }, { x: 4, y: 0 }),
      wall(`${index}:b`, { x: 4, y: 0 }, { x: 4, y: 3 }),
      wall(`${index}:c`, { x: 4, y: 3 }, { x: 0, y: 3 }),
      wall(`${index}:d`, { x: 0, y: 3 }, { x: 0, y: 0 }),
    ],
  }))
  const context = buildRoofAttachmentContext(floors, 0)
  assert.equal(context.rooms.length, 2)
  assert.ok(context.rooms.every((room) => Math.abs(room.area - 9.99) < 1e-8))
  assert.equal(buildRoofAttachmentContext(floors, 2.6).rooms.length, 1)
})
