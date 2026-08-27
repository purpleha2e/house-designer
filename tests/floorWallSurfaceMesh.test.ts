import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id'>): Wall {
  return {
    height: 2.4,
    id: overrides.id,
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    thickness: 0.2,
    ...overrides,
  }
}

test('floor wall surface mesh keeps angled side attachment caps and clips target surfaces', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5.3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 5.3, y: 0 },
      end: { x: 5.3, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 5.3, y: 8.17 },
      end: { x: 0, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 8.17 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'external',
      start: { x: 0.15, y: 5.45 },
      end: { x: 5.15, y: 3.95 },
      thickness: 0.3,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildFloorWallSurfaceFaces({
    externalFootprintWallIds: new Set(['right']),
    renderedWalls,
    rooms: topology.rooms,
  })
  const diagonalEndCap = faces.find(
    (face) =>
      face.wallId === 'diagonal' &&
      face.kind === 'cap' &&
      face.endpoint === 'end',
  )
  const lowerRightSurface = faces.find(
    (face) =>
      face.wallId === 'right' &&
      face.kind === 'side' &&
      face.materialSource.role === 'room-surface' &&
      face.vertices.some(
        (vertex) =>
          Math.abs(vertex.position[2] - 3.7933954023663423) < 0.001,
      ),
  )

  assert.ok(diagonalEndCap)
  assert.ok(lowerRightSurface)
})

test('floor wall surface mesh uses composed room sides for diagonal side attachments', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5.3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 5.3, y: 0 },
      end: { x: 5.3, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 5.3, y: 8.17 },
      end: { x: 0, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 8.17 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'external',
      start: { x: 0.15, y: 5.45 },
      end: { x: 5.15, y: 3.95 },
      thickness: 0.3,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildFloorWallSurfaceFaces({
    externalFootprintWallIds: new Set(['left', 'right']),
    renderedWalls,
    rooms: topology.rooms,
  })
  const diagonalSideFaces = faces.filter(
    (face) => face.wallId === 'diagonal' && face.kind === 'side',
  )

  assert.equal(diagonalSideFaces.length, 2)
  assert.deepEqual(
    diagonalSideFaces.map((face) => face.materialSource).sort((first, second) =>
      (first.side ?? 0) - (second.side ?? 0),
    ),
    [
      { role: 'room-surface', side: -1, wallId: 'diagonal' },
      { role: 'room-surface', side: 1, wallId: 'diagonal' },
    ],
  )
})

test('floor wall surface mesh omits external footprint-covered endpoint join strips', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5.3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 5.3, y: 0 },
      end: { x: 5.3, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 5.3, y: 8.17 },
      end: { x: 0, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 8.17 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'external',
      start: { x: 0.15, y: 5.45 },
      end: { x: 5.15, y: 3.95 },
      thickness: 0.3,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildFloorWallSurfaceFaces({
    externalFootprintWallIds: new Set(['diagonal']),
    renderedWalls,
    rooms: topology.rooms,
  })
  const diagonalJoinStrips = faces.filter(
    (face) =>
      face.wallId === 'diagonal' && face.faceId.includes(':join-side:'),
  )

  assert.equal(diagonalJoinStrips.length, 0)
})

test('floor wall surface mesh composes internal side attachments inside external rooms', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5.3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 5.3, y: 0 },
      end: { x: 5.3, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 5.3, y: 8.17 },
      end: { x: 0, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 8.17 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'internal',
      start: { x: 0.15, y: 5.45 },
      end: { x: 5.15, y: 3.95 },
      thickness: 0.2,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildFloorWallSurfaceFaces({
    externalFootprintWallIds: new Set(['left', 'right']),
    renderedWalls,
    rooms: topology.rooms,
  })
  const diagonalSideFaces = faces.filter(
    (face) => face.wallId === 'diagonal' && face.kind === 'side',
  )
  const diagonalCaps = faces.filter(
    (face) => face.wallId === 'diagonal' && face.kind === 'cap',
  )

  assert.equal(topology.rooms.length, 2)
  assert.equal(diagonalSideFaces.length, 2)
  assert.equal(
    diagonalSideFaces.every(
      (face) => face.materialSource.role === 'room-surface',
    ),
    true,
  )
  assert.equal(diagonalCaps.length, 2)
})

test('floor wall surface mesh uses external context for engine-only internal walls', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 5.3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 5.3, y: 0 },
      end: { x: 5.3, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 5.3, y: 8.17 },
      end: { x: 0, y: 8.17 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 8.17 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'internal',
      start: { x: 0.15, y: 5.45 },
      end: { x: 5.15, y: 3.95 },
      thickness: 0.2,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const diagonalRenderedWalls = renderedWalls.filter(
    (renderedWall) => renderedWall.wall.id === 'diagonal',
  )
  const faces = buildFloorWallSurfaceFaces({
    contextRenderedWalls: renderedWalls,
    externalFootprintWallIds: new Set(['left', 'right', 'top', 'bottom']),
    renderedWalls: diagonalRenderedWalls,
    rooms: topology.rooms,
  })
  const diagonalFaces = faces.filter((face) => face.wallId === 'diagonal')

  assert.equal(
    faces.every(
      (face) =>
        face.materialSource.role === 'room-surface' || face.wallId === 'diagonal',
    ),
    true,
  )
  assert.equal(
    diagonalFaces.some((face) => face.kind === 'cap'),
    true,
  )
  assert.equal(
    diagonalFaces.filter(
      (face) =>
        face.kind === 'side' && face.materialSource.role === 'room-surface',
    ).length,
    2,
  )
})

test('floor wall surface mesh omits caps covered by composed room surfaces', () => {
  const walls = [
    wall({
      id: 'target',
      kind: 'internal',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      thickness: 0.2,
    }),
    wall({
      id: 'left',
      kind: 'internal',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 3 },
      thickness: 0.2,
    }),
    wall({
      id: 'top',
      kind: 'internal',
      start: { x: 0, y: 3 },
      end: { x: 4, y: 3 },
      thickness: 0.2,
    }),
    wall({
      id: 'right',
      kind: 'internal',
      start: { x: 4, y: 3 },
      end: { x: 4, y: 0 },
      thickness: 0.2,
    }),
    wall({
      id: 'branch',
      kind: 'internal',
      start: { x: 2, y: -1.5 },
      end: { x: 2, y: -0.1 },
      thickness: 0.2,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildFloorWallSurfaceFaces({
    renderedWalls,
    rooms: topology.rooms,
  })
  const branchStartCap = faces.find(
    (face) =>
      face.wallId === 'branch' &&
      face.kind === 'cap' &&
      face.endpoint === 'end',
  )

  assert.equal(branchStartCap, undefined)
})
