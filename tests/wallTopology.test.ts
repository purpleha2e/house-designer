import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { FloorLevel, Room, Wall } from '../src/types.ts'
import { buildWallTopology, preserveRoomMetadataAfterWallMove, wallEditCollapsesGeometry } from '../src/wallTopology.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id' | 'kind'>): Wall {
  return {
    height: 2.4,
    openings: undefined,
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: overrides.kind === 'external' ? 0.3 : 0.15,
    ...overrides,
  }
}

test('moving a partition keeps room metadata on the same side of the wall', () => {
  const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]
  const perimeter = corners.map((start, index) => wall({
    id: `exterior-${index}`, kind: 'external', start, end: corners[(index + 1) % corners.length],
  }))
  const partition = (x: number) => wall({ id: 'partition', kind: 'internal', start: { x, y: 0 }, end: { x, y: 6 } })
  const walls = [...perimeter, partition(2)]
  const [west, east] = buildWallTopology(walls).rooms.toSorted((a, b) =>
    Math.min(...a.polygon.map(point => point.x)) - Math.min(...b.polygon.map(point => point.x)))
  const rooms: Room[] = [
    { id: 'west', name: 'Landing', function: 'landing', signature: west.signature },
    { id: 'east', name: 'Main bedroom', function: 'bedroom', ceilingMode: 'open', signature: east.signature },
  ]
  const floor: FloorLevel = { id: 'upper', name: 'First floor', elevation: 2.7, roomHeight: 2.4,
    slabThickness: .2, walls, rooms, models: [] }
  const resized = { ...floor, walls: [...perimeter, partition(8)] }
  const [newWest, newEast] = buildWallTopology(resized.walls).rooms.toSorted((a, b) =>
    Math.min(...a.polygon.map(point => point.x)) - Math.min(...b.polygon.map(point => point.x)))

  assert.notEqual(newWest.signature, west.signature)
  assert.notEqual(newEast.signature, east.signature)
  assert.deepEqual(preserveRoomMetadataAfterWallMove(floor, resized).rooms, [
    { ...rooms[0], signature: newWest.signature }, { ...rooms[1], signature: newEast.signature },
  ])

  const opened = { ...floor, walls: [...perimeter, { ...partition(2), end: { x: 2, y: 5 } }] }
  assert.equal(buildWallTopology(opened.walls).rooms.length, 1)
  assert.equal(preserveRoomMetadataAfterWallMove(floor, opened), opened)
})

test('wall edits reject newly collapsed segments and allow edits beside old collapsed segments', () => {
  const main = wall({ id: 'main', kind: 'external' })
  const returnWall = wall({ id: 'return', kind: 'external', start: main.end, end: { x: 4.4, y: 0 } })
  const collapsed = { ...returnWall, end: { x: 4.19, y: 0 } }
  const shortPartition = wall({ id: 'partition', kind: 'internal', end: { x: .13, y: 0 } })

  assert.equal(wallEditCollapsesGeometry([main], [main, collapsed]), true)
  assert.equal(wallEditCollapsesGeometry([main, returnWall], [main, collapsed]), true)
  assert.equal(wallEditCollapsesGeometry([main, collapsed], [main, collapsed, shortPartition]), false)
  assert.equal(wallEditCollapsesGeometry([main, collapsed], [main, returnWall]), false)
})

test('room detection uses topology-snapped endpoints', () => {
  const topology = buildWallTopology([
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 4.04, y: 0.03 },
      end: { x: 4, y: 3 },
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 4, y: 3.02 },
      end: { x: 0, y: 3 },
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0.02, y: 3 },
      end: { x: 0, y: 0.04 },
    }),
  ])

  assert.equal(topology.rooms.length, 1)
  assert.ok(topology.rooms[0].area > 9.5)
})

test('internal side snap near external endpoint preserves snapped point', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
    thickness: 0.3,
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 2.925, y: 0.15 },
    end: { x: 2.925, y: 2 },
    thickness: 0.15,
  })
  const topology = buildWallTopology([external, internal])
  const renderedInternal = topology.renderedWallsById.get(internal.id)

  assert.equal(renderedInternal?.wall.start.x, internal.start.x)
  assert.equal(renderedInternal?.wall.start.y, internal.start.y)
})

test('topology keeps separate internal endpoints on external end quarter points', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 3 },
    thickness: 0.3,
  })
  const leftInternal = wall({
    id: 'left-internal',
    kind: 'internal',
    start: { x: -0.075, y: 3 },
    end: { x: -1, y: 2.2 },
    thickness: 0.15,
  })
  const rightInternal = wall({
    id: 'right-internal',
    kind: 'internal',
    start: { x: 0.075, y: 3 },
    end: { x: 0.075, y: 4 },
    thickness: 0.15,
  })
  const topology = buildWallTopology([external, leftInternal, rightInternal])
  const renderedLeft = topology.renderedWallsById.get(leftInternal.id)
  const renderedRight = topology.renderedWallsById.get(rightInternal.id)

  assert.deepEqual(renderedLeft?.wall.start, leftInternal.start)
  assert.deepEqual(renderedRight?.wall.start, rightInternal.start)
})

test('room detection ignores side-attached two-wall loops', () => {
  const topology = buildWallTopology([
    wall({
      id: 'horizontal',
      kind: 'external',
      start: { x: 1.5, y: 1.5 },
      end: { x: 6.5, y: 1.5 },
      thickness: 0.3,
    }),
    wall({
      id: 'angled',
      kind: 'external',
      start: { x: 4.819, y: 4.95 },
      end: { x: 4.516, y: 1.5 },
      thickness: 0.3,
    }),
  ])

  assert.equal(topology.rooms.length, 0)
})

test('room detection ignores side-attached internal wall wrapping both wall faces', () => {
  const topology = buildWallTopology([
    wall({
      id: 'horizontal-external',
      kind: 'external',
      start: { x: 3.05, y: 4.411 },
      end: { x: 6.231, y: 4.411 },
      thickness: 0.3,
    }),
    wall({
      id: 'side-attached-internal',
      kind: 'internal',
      start: { x: 4.34, y: 9.117 },
      end: { x: 4.34, y: 4.411 },
      thickness: 0.15,
    }),
    wall({
      id: 'vertical-external',
      kind: 'external',
      start: { x: 6.231, y: 1.894 },
      end: { x: 6.231, y: 4.411 },
      thickness: 0.3,
    }),
  ])

  assert.equal(topology.rooms.length, 0)
})

test('room detection keeps adjacent rooms after rejected exploratory loops', () => {
  const topology = buildWallTopology([
    wall({
      id: 'bottom-external',
      kind: 'external',
      start: { x: 4.55, y: 2.333 },
      end: { x: 13.317, y: 2.333 },
      thickness: 0.3,
    }),
    wall({
      id: 'left-external',
      kind: 'external',
      start: { x: 4.55, y: 2.333 },
      end: { x: 4.55, y: 13.783 },
      thickness: 0.3,
    }),
    wall({
      id: 'top-external',
      kind: 'external',
      start: { x: 4.55, y: 13.783 },
      end: { x: 13.317, y: 13.783 },
      thickness: 0.3,
    }),
    wall({
      id: 'right-external',
      kind: 'external',
      start: { x: 13.317, y: 13.783 },
      end: { x: 13.317, y: 2.333 },
      thickness: 0.3,
    }),
    wall({
      id: 'horizontal-internal',
      kind: 'internal',
      start: { x: 4.55, y: 4.95 },
      end: { x: 13.317, y: 4.95 },
      thickness: 0.15,
    }),
    wall({
      id: 'left-divider',
      kind: 'internal',
      start: { x: 7.3, y: 4.95 },
      end: { x: 7.3, y: 13.783 },
      thickness: 0.15,
    }),
    wall({
      id: 'right-divider',
      kind: 'internal',
      start: { x: 10.617, y: 4.95 },
      end: { x: 10.617, y: 13.783 },
      thickness: 0.15,
    }),
  ])

  assert.equal(topology.rooms.length, 4)
})

test('room detection ignores dangling internal walls', () => {
  const topology = buildWallTopology([
    wall({
      id: 'bottom-external',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right-external',
      kind: 'external',
      start: { x: 5, y: 0 },
      end: { x: 5, y: 4 },
      thickness: 0.3,
    }),
    wall({
      id: 'top-external',
      kind: 'external',
      start: { x: 5, y: 4 },
      end: { x: 0, y: 4 },
      thickness: 0.3,
    }),
    wall({
      id: 'left-external',
      kind: 'external',
      start: { x: 0, y: 4 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'floating-internal',
      kind: 'internal',
      start: { x: 1, y: 1 },
      end: { x: 3, y: 2 },
      thickness: 0.1,
    }),
  ])

  assert.equal(topology.rooms.length, 1)
  assert.ok(topology.rooms[0].area > 15)
})

test('room detection separates rooms with a divider trimmed to adjoining wall faces', () => {
  const topology = buildWallTopology([
    wall({ id: 'bottom', kind: 'external', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }),
    wall({ id: 'right', kind: 'external', start: { x: 5, y: 0 }, end: { x: 5, y: 5 } }),
    wall({ id: 'top', kind: 'external', start: { x: 5, y: 5 }, end: { x: 0, y: 5 } }),
    wall({ id: 'left', kind: 'external', start: { x: 0, y: 5 }, end: { x: 0, y: 0 } }),
    wall({
      id: 'vertical-divider',
      kind: 'internal',
      start: { x: 3, y: 0.15 },
      end: { x: 3, y: 5 },
    }),
    wall({
      id: 'face-attached-divider',
      kind: 'internal',
      start: { x: 0.15, y: 3 },
      end: { x: 2.925, y: 3 },
    }),
  ])

  assert.equal(topology.rooms.length, 3)
})

test('room detection separates consecutive dividers despite floating-point wall joins', () => {
  const walls = [
    wall({ id: 'top', kind: 'external', start: { x: 1.5, y: 1.5 }, end: { x: 6.5, y: 1.5 } }),
    wall({ id: 'left', kind: 'external', start: { x: 1.5, y: 1.5 }, end: { x: 1.5000000000000004, y: 7.166764705034278 } }),
    wall({ id: 'bottom', kind: 'external', start: { x: 1.5000000000000004, y: 7.166764705034278 }, end: { x: 6.5, y: 7.166764705034278 } }),
    wall({ id: 'right', kind: 'external', start: { x: 6.5, y: 7.166764705034278 }, end: { x: 6.5, y: 1.5 } }),
    wall({ id: 'lower-divider', kind: 'external', start: { x: 1.5, y: 6.216666666666665 }, end: { x: 6.5, y: 6.216666666666666 } }),
    wall({ id: 'upper-divider', kind: 'external', start: { x: 1.5000000000000002, y: 4.383333333333333 }, end: { x: 6.5, y: 4.383333333333333 } }),
  ]

  const rooms = buildWallTopology(walls).rooms

  assert.equal(rooms.length, 3)
  assert.ok(rooms[1].polygon.every((point) => point.y <= 6.066667))
  assert.ok(rooms[2].polygon.every((point) => point.y >= 6.366666))
})

test('recreating the red house upper external wall restores both rooms', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_3.json', import.meta.url), 'utf8')) as {
    floors: Array<{ walls: Wall[] }>
  }
  const walls = project.floors[1].walls
  const removedWall = walls.find((candidate) =>
    candidate.id === '3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e')
  assert.ok(removedWall)

  const replacement = {
    ...removedWall,
    id: 'replacement-wall',
    openings: [],
    end: { ...removedWall.end, x: 1.2000000000000004 },
  }
  const rooms = buildWallTopology([
    ...walls.filter((candidate) => candidate.id !== removedWall.id),
    replacement,
  ]).rooms

  assert.equal(rooms.length, 2)
  assert.ok(Math.abs(rooms[0].area - 69.98894) < 0.001)
  assert.ok(Math.abs(rooms[1].area - 16.93411) < 0.001)
})
