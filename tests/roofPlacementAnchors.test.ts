import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { alignRoofPlacementPoint, buildRoofAttachmentContext, getClosestExternalWallPoint, getLeanToRotationFromMountingWall, getRoofPlacementSnapPoints } from '../src/roofPlacementAnchors.ts'
import type { FloorLevel, Wall } from '../src/types.ts'

function wall(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  kind: Wall['kind'] = 'external',
): Wall {
  return { end, height: 2.4, id, kind, start, thickness: 0.3 }
}

test('roof guides independently align to the nearest selected horizontal and vertical coordinates', () => {
  const anchors = [{ x: 1.23, y: 2 }, { x: 4, y: 5.67 }]
  assert.deepEqual(alignRoofPlacementPoint({ x: 1.27, y: 5.62 }, anchors, 0.1),
    { point: { x: 1.23, y: 5.67 }, vertical: 1.23, horizontal: 5.67 })
  assert.deepEqual(alignRoofPlacementPoint({ x: 3, y: 2.06 }, anchors, 0.1),
    { point: { x: 3, y: 2 }, vertical: undefined, horizontal: 2 })
  assert.deepEqual(alignRoofPlacementPoint({ x: 3, y: 3 }, anchors, 0.1),
    { point: { x: 3, y: 3 }, vertical: undefined, horizontal: undefined })
  assert.equal(alignRoofPlacementPoint({ x: 1.04, y: 10 }, [{ x: 1, y: 0 }, { x: 1.05, y: 0 }], 0.1).point.x, 1.05)
  assert.deepEqual(alignRoofPlacementPoint({ x: 3, y: 3 }, [], 0.1).point, { x: 3, y: 3 })
})

test('roof alignment capture remains eight screen pixels as the plan zooms', () => {
  for (const zoom of [0.5, 1, 3]) {
    const tolerance = 8 / (60 * zoom)
    const anchors = [{ x: 2.37, y: 4.28 }]
    assert.equal(alignRoofPlacementPoint({ x: 2.37 + tolerance * 0.9, y: 8 }, anchors, tolerance).point.x, 2.37)
    assert.equal(alignRoofPlacementPoint({ x: 2.37 + tolerance * 1.1, y: 8 }, anchors, tolerance).vertical, undefined)
  }
})

test('lean-to slopes away from its mounting wall even when stacked rooms suggest the opposite side', () => {
  for (const angle of [0, 0.6, Math.PI / 2, Math.PI]) for (const reverse of [false, true]) for (const side of [-1, 1]) {
    const transform = (point: {x:number;y:number}) => ({
      x: 3 + point.x * Math.cos(angle) - point.y * Math.sin(angle),
      y: 7 + point.x * Math.sin(angle) + point.y * Math.cos(angle),
    })
    const start=transform({x:0,y:0}),end=transform({x:0,y:5}),low=transform({x:side*2,y:0})
    const mounting=wall('upper-facade',reverse?end:start,reverse?start:end)
    // Deliberately give room detection the wrong side; the footprint owns it.
    const fallbackSide = (reverse ? -side : side) as -1 | 1
    const rotation=getLeanToRotationFromMountingWall(mounting,[start,end,low],fallbackSide)!
    const lowX=(low.x-start.x)*Math.cos(rotation)-(low.y-start.y)*Math.sin(rotation)
    assert.ok(lowX < -1.99, 'local X must rise from the outer eave towards the selected mounting wall')
    assert.equal(getLeanToRotationFromMountingWall(mounting,[end,low,start],fallbackSide),rotation,
      'selection order cannot reverse the slope')
  }
})

test('lean-to direction retains its room-side fallback until a point defines the roof footprint', () => {
  const mounting=wall('facade',{x:0,y:0},{x:0,y:5})
  assert.ok(Math.abs(getLeanToRotationFromMountingWall(mounting,[mounting.start,mounting.end],1)!) < 1e-8)
  assert.ok(Math.abs(Math.abs(getLeanToRotationFromMountingWall(mounting,[mounting.start,mounting.end],-1)!) - Math.PI) < 1e-8)
  assert.equal(getLeanToRotationFromMountingWall(wall('zero',{x:0,y:0},{x:0,y:0}),[],1),null)
})

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

test('permanent roof markers omit distant projections while hover still snaps to them', () => {
  const walls = [
    wall('top', { x: 0, y: 0 }, { x: 5, y: 0 }),
    wall('bottom', { x: 0, y: 4 }, { x: 5, y: 4 }),
    wall('projecting', { x: 2.36, y: 4 }, { x: 2.36, y: 7 }),
    wall('partition', { x: 1.2, y: 0.15 }, { x: 1.2, y: 2 }, 'internal'),
  ]
  const points = getRoofPlacementSnapPoints(walls, { includeProjected: false })
  const includes = (x: number, y: number) => points.some(p => Math.hypot(p.x - x, p.y - y) < 1e-6)
  assert.ok(!includes(2.36, 0), 'remote wall alignment must not create a permanent dot')
  assert.ok(includes(2.36, 4), 'actual T junction stays visible')
  assert.ok(includes(1.2, 0), 'a partition ending at the wall face keeps its join marker')
  assert.ok(includes(0, 0) && includes(5, 0), 'wall endpoints stay visible')
  assert.deepEqual(getClosestExternalWallPoint({ x: 2.37, y: 0.03 }, walls), { x: 2.36, y: 0 })
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
  for (const floor of floors) assert.ok(floor.walls.every((wall) => context.walls.some(candidate => candidate.id === wall.id)))
  const upperContext = buildRoofAttachmentContext(floors, floors[1].elevation)
  assert.ok(upperContext.walls.every((wall) => floors[1].walls.some(candidate => candidate.id === wall.id)))
  assert.equal(JSON.stringify(floors), before)
})

test('roof anchors and hover use one rendered corner for the offset floor_test endpoints', () => {
  const corner = { x: 1.5060660171779825, y: 6.960698687856296 }
  const oldEndpoint = { x: 1.4, y: 7.066764705034278 }
  const floor: FloorLevel = {
    id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.2, models: [], rooms: [],
    walls: [
      wall('upright', { x: 1.5, y: 1.5 }, corner),
      wall('diagonal-right', oldEndpoint, { x: 3.9, y: 9.566764705034279 }),
      wall('diagonal-left', oldEndpoint, { x: -1.4184177797666426, y: 9.885182484800922 }),
    ],
  }
  const before = JSON.stringify(floor)
  const context = buildRoofAttachmentContext([floor], 0)
  const markers = getRoofPlacementSnapPoints(context.walls, { includeProjected: false })
    .filter(point => Math.hypot(point.x - corner.x, point.y - corner.y) < 0.3)
  assert.equal(markers.length, 1, 'one joined corner must have one marker')
  assert.ok(Math.hypot(markers[0].x - corner.x, markers[0].y - corner.y) < 1e-6)
  assert.deepEqual(getClosestExternalWallPoint({ x: corner.x - 0.02, y: corner.y + 0.02 }, context.walls), corner)
  assert.equal(JSON.stringify(floor), before, 'snapping must not rewrite saved wall positions')
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
