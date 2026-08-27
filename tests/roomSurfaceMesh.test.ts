import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology, type DetectedRoom } from '../src/wallTopology.ts'
import {
  buildRoomWallSurfaceRenderPlans,
  buildRoomWallSurfacePlans,
  buildRoomSurfaceWallFaces,
  buildRoomSurfaceFloorPolygons,
  getRoomSurfaceKey,
} from '../src/wallEngine/roomSurfaceMesh.ts'

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

function room(overrides: Partial<DetectedRoom>): DetectedRoom {
  return {
    area: 1,
    id: 'room-1',
    polygon: [],
    signature: 'room-signature',
    ...overrides,
  }
}

test('room surface mesh builder emits wall side faces from room boundary edges', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'north',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 1)
  assert.deepEqual({
    role: faces[0].materialSource.role,
    side: faces[0].materialSource.side,
    wallId: faces[0].materialSource.wallId,
  }, {
    role: 'room-surface',
    side: 1,
    wallId: 'north',
  })
  assert.equal(faces[0].materialSource.fragmentId, undefined)
  assert.deepEqual(faces[0].pickSource, {
    side: 1,
    wallId: 'north',
  })
  assert.deepEqual(faces[0].normal, [0, 0, 1])
  assert.deepEqual(
    faces[0].vertices.map((vertex) => vertex.position),
    [
      [0, 0, 0.1],
      [4, 0, 0.1],
      [4, 2.4, 0.1],
      [0, 2.4, 0.1],
    ],
  )
  assert.deepEqual(
    faces[0].vertices.map((vertex) => vertex.uv),
    [
      [0, 0],
      [4, 0],
      [4, 2.4],
      [0, 2.4],
    ],
  )
})

test('room surface mesh builder preserves UV direction for reversed room edges', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'north',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 2 },
          { x: 4, y: 2 },
          { x: 4, y: 0.1 },
          { x: 0, y: 0.1 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 1)
  assert.deepEqual(
    faces[0].vertices.map((vertex) => vertex.uv[0]),
    [0, 4, 4, 0],
  )
})

test('room surface mesh builder cuts opening walls into room-surface faces', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'door-wall',
      openings: [
        {
          bottom: 0,
          center: 2,
          height: 2,
          id: 'door-opening',
          modelId: 'door',
          width: 0.9,
        },
      ],
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 3)
  assert.deepEqual(
    faces.map((face) => face.vertices.map((vertex) => vertex.uv)),
    [
      [
        [0, 0],
        [1.55, 0],
        [1.55, 2.4],
        [0, 2.4],
      ],
      [
        [1.55, 2],
        [2.45, 2],
        [2.45, 2.4],
        [1.55, 2.4],
      ],
      [
        [2.45, 0],
        [4, 0],
        [4, 2.4],
        [2.45, 2.4],
      ],
    ],
  )
})

test('room surface mesh builder keeps opening-wall diagnostics compatible', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'door-wall',
      openings: [
        {
          bottom: 0,
          center: 2,
          height: 2,
          id: 'door-opening',
          modelId: 'door',
          width: 0.9,
        },
      ],
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    includeWallsWithOpenings: true,
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 3)
  assert.deepEqual(
    faces.map((face) => face.wallId),
    ['door-wall', 'door-wall', 'door-wall'],
  )
})

test('room surface mesh builder clips partially overlapping room edges to wall spans', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'short-wall',
      start: { x: 1, y: 0 },
      end: { x: 3, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 1)
  assert.deepEqual(
    faces[0].vertices.map((vertex) => vertex.position),
    [
      [1, 0, 0.1],
      [3, 0, 0.1],
      [3, 2.4, 0.1],
      [1, 2.4, 0.1],
    ],
  )
})

test('room wall surface planner reports unmatched room boundary gaps', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'short-wall',
      start: { x: 1, y: 0 },
      end: { x: 3, y: 0 },
    }),
  ])
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(plan.segments.length, 1)
  assert.deepEqual(
    plan.gaps
      .filter((gap) => gap.edgeIndex === 0)
      .map((gap) => ({
        end: Number(gap.edgeEndDistance.toFixed(3)),
        reason: gap.reason,
        start: Number(gap.edgeStartDistance.toFixed(3)),
      })),
    [
      {
        end: 1,
        reason: 'unmatched',
        start: 0,
      },
      {
        end: 4,
        reason: 'unmatched',
        start: 3,
      },
    ],
  )
})

test('room wall surface planner classifies tiny transition gaps as corners', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'bottom',
      start: { x: 0, y: 0 },
      end: { x: 3.9, y: 0 },
    }),
    wall({
      id: 'right',
      start: { x: 3.9, y: 0.2 },
      end: { x: 3.9, y: 2 },
    }),
  ])
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.deepEqual(
    plan.gaps
      .filter((gap) => gap.edgeIndex === 1)
      .map((gap) => ({
        end: Number(gap.edgeEndDistance.toFixed(3)),
        reason: gap.reason,
        start: Number(gap.edgeStartDistance.toFixed(3)),
      })),
    [
      {
        end: 0.1,
        reason: 'corner',
        start: 0,
      },
    ],
  )
})

test('room wall surface planner allows wall-thickness-sized endpoint corner gaps', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'bottom',
      start: { x: 0, y: 0 },
      end: { x: 3.7, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      start: { x: 3.85, y: 0.4 },
      end: { x: 3.85, y: 2 },
      thickness: 0.3,
    }),
  ])
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.15 },
          { x: 4, y: 0.15 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.deepEqual(
    plan.gaps
      .filter((gap) => gap.edgeIndex === 1)
      .map((gap) => ({
        end: Number(gap.edgeEndDistance.toFixed(3)),
        reason: gap.reason,
        start: Number(gap.edgeStartDistance.toFixed(3)),
      })),
    [
      {
        end: 0.25,
        reason: 'corner',
        start: 0,
      },
    ],
  )
})

test('room wall surface planner classifies endpoint gaps across skipped loop edges', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'left',
      start: { x: 0, y: 0 },
      end: { x: 1.85, y: 0 },
      thickness: 0.2,
    }),
    wall({
      id: 'right',
      start: { x: 2.1, y: 0.1 },
      end: { x: 2.1, y: 2 },
      thickness: 0.2,
    }),
  ])
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 2, y: 0.1 },
          { x: 2, y: 0.2 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.deepEqual(
    plan.gaps
      .filter((gap) => gap.edgeIndex === 0)
      .map((gap) => ({
        end: Number(gap.edgeEndDistance.toFixed(3)),
        reason: gap.reason,
        start: Number(gap.edgeStartDistance.toFixed(3)),
      })),
    [
      {
        end: 2,
        reason: 'corner',
        start: 1.85,
      },
    ],
  )
})

test('room wall surface planner keeps middle-of-edge gaps unmatched', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'left',
      start: { x: 0, y: 0 },
      end: { x: 1.9, y: 0 },
    }),
    wall({
      id: 'right',
      start: { x: 2.1, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.deepEqual(
    plan.gaps
      .filter((gap) => gap.edgeIndex === 0)
      .map((gap) => gap.reason),
    ['unmatched'],
  )
})

test('room wall surface planner marks repeated physical gaps as duplicates', () => {
  const [plan] = buildRoomWallSurfacePlans({
    renderedWalls: [],
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0 },
          { x: 0.15, y: 0 },
          { x: 0, y: 0.01 },
        ],
      }),
    ],
  })
  const repeatedGapReasons = plan.gaps
    .filter(
      (gap) =>
        Math.hypot(
          gap.endPoint.x - gap.startPoint.x,
          gap.endPoint.y - gap.startPoint.y,
        ) > 0.1,
    )
    .map((gap) => gap.reason)

  assert.deepEqual(repeatedGapReasons, ['unmatched', 'duplicate'])
})

test('room wall surface render planner orders segments and corner transitions', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'bottom',
      start: { x: 0, y: 0 },
      end: { x: 1.9, y: 0 },
    }),
    wall({
      id: 'right',
      start: { x: 2.1, y: 0.2 },
      end: { x: 2.1, y: 2 },
    }),
    wall({
      id: 'top',
      start: { x: 2, y: 2.1 },
      end: { x: 0, y: 2.1 },
    }),
    wall({
      id: 'left',
      start: { x: 0.1, y: 2 },
      end: { x: 0.1, y: 0 },
    }),
  ])
  const [plan] = buildRoomWallSurfaceRenderPlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 2, y: 0.1 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(plan.problems.length, 0)
  assert.equal(plan.suppressedDuplicates.length, 0)
  assert.equal(
    plan.entries.filter((entry) => entry.type === 'segment').length,
    4,
  )
  assert.equal(
    plan.entries.filter((entry) => entry.type === 'corner').length,
    2,
  )
  assert.deepEqual(
    plan.entries.map((entry) => ({
      edge: entry.edgeIndex,
      end: Number(entry.edgeEndDistance.toFixed(3)),
      start: Number(entry.edgeStartDistance.toFixed(3)),
      type: entry.type,
    })),
    [
      { edge: 0, end: 1.9, start: 0, type: 'segment' },
      { edge: 0, end: 2, start: 1.9, type: 'corner' },
      { edge: 1, end: 0.1, start: 0, type: 'corner' },
      { edge: 1, end: 1.9, start: 0.1, type: 'segment' },
      { edge: 2, end: 2, start: 0, type: 'segment' },
      { edge: 3, end: 1.9, start: 0, type: 'segment' },
    ],
  )
})

test('room wall surface render planner suppresses duplicate bookkeeping gaps', () => {
  const [plan] = buildRoomWallSurfaceRenderPlans({
    renderedWalls: [],
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0 },
          { x: 0.15, y: 0 },
          { x: 0, y: 0.01 },
        ],
      }),
    ],
  })

  assert.equal(plan.entries.length, 0)
  assert.equal(plan.problems.length, 1)
  assert.equal(plan.suppressedDuplicates.length, 1)
})

test('room wall surface render planner emits one-sided duplicate endpoint transitions', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'side',
      start: { x: 0.3, y: -0.15 },
      end: { x: 1, y: -0.15 },
      thickness: 0.3,
    }),
  ])
  const [plan] = buildRoomWallSurfaceRenderPlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0 },
          { x: 0.3, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      }),
    ],
  })
  const duplicateTransition = plan.entries.find(
    (entry) =>
      entry.type === 'corner' &&
      entry.gap.reason === 'duplicate' &&
      entry.materialSegment.wall.id === 'side',
  )

  assert.ok(duplicateTransition)
  assert.equal(plan.suppressedDuplicates.length, 0)
})

test('room wall surface render planner keeps true gaps as problems', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'left',
      start: { x: 0, y: 0 },
      end: { x: 1.9, y: 0 },
    }),
    wall({
      id: 'right',
      start: { x: 2.1, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const [plan] = buildRoomWallSurfaceRenderPlans({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.deepEqual(
    plan.problems
      .filter((gap) => gap.edgeIndex === 0)
      .map((gap) => ({
        end: Number(gap.edgeEndDistance.toFixed(3)),
        start: Number(gap.edgeStartDistance.toFixed(3)),
      })),
    [{ end: 2.1, start: 1.9 }],
  )
})

test('room surface mesh builder merges coplanar render plan entries into selectable faces', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'bottom',
      start: { x: 0, y: 0 },
      end: { x: 1.9, y: 0 },
    }),
    wall({
      id: 'right',
      start: { x: 2.1, y: 0.2 },
      end: { x: 2.1, y: 2 },
    }),
    wall({
      id: 'top',
      start: { x: 2, y: 2.1 },
      end: { x: 0, y: 2.1 },
    }),
    wall({
      id: 'left',
      start: { x: 0.1, y: 2 },
      end: { x: 0.1, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 2, y: 0.1 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(faces.length, 4)
  const facesByWallId = new Map(faces.map((face) => [face.wallId, face]))

  assert.deepEqual(
    [...facesByWallId.keys()].sort(),
    ['bottom', 'left', 'right', 'top'],
  )
  assert.deepEqual({
    role: facesByWallId.get('bottom')?.materialSource.role,
    side: facesByWallId.get('bottom')?.materialSource.side,
    wallId: facesByWallId.get('bottom')?.materialSource.wallId,
  }, {
    role: 'room-surface',
    side: 1,
    wallId: 'bottom',
  })
  assert.equal(facesByWallId.get('bottom')?.materialSource.fragmentId, undefined)
  assert.deepEqual({
    role: facesByWallId.get('right')?.materialSource.role,
    side: facesByWallId.get('right')?.materialSource.side,
    wallId: facesByWallId.get('right')?.materialSource.wallId,
  }, {
    role: 'room-surface',
    side: 1,
    wallId: 'right',
  })
  assert.deepEqual({
    role: facesByWallId.get('top')?.materialSource.role,
    side: facesByWallId.get('top')?.materialSource.side,
    wallId: facesByWallId.get('top')?.materialSource.wallId,
  }, {
    role: 'room-surface',
    side: 1,
    wallId: 'top',
  })
  assert.deepEqual({
    role: facesByWallId.get('left')?.materialSource.role,
    side: facesByWallId.get('left')?.materialSource.side,
    wallId: facesByWallId.get('left')?.materialSource.wallId,
  }, {
    role: 'room-surface',
    side: -1,
    wallId: 'left',
  })
  assert.deepEqual(facesByWallId.get('bottom')?.pickSource, {
    side: 1,
    wallId: 'bottom',
  })
  assert.deepEqual(facesByWallId.get('right')?.pickSource, {
    side: 1,
    wallId: 'right',
  })
  assert.deepEqual(facesByWallId.get('top')?.pickSource, {
    side: 1,
    wallId: 'top',
  })
  assert.deepEqual(facesByWallId.get('left')?.pickSource, {
    side: -1,
    wallId: 'left',
  })
  const verticesByWallId = new Map(
    faces.map((face) => [
      face.wallId,
      face.vertices.map((vertex) => [
        Number(vertex.position[0].toFixed(3)),
        Number(vertex.position[2].toFixed(3)),
      ]),
    ]),
  )

  assert.deepEqual(verticesByWallId.get('bottom'), [
    [0, 0.1],
    [2, 0.1],
    [2, 0.1],
    [0, 0.1],
  ])
  assert.deepEqual(verticesByWallId.get('right'), [
    [2, 0.1],
    [2, 2],
    [2, 2],
    [2, 0.1],
  ])
  assert.deepEqual(verticesByWallId.get('top'), [
    [2, 2],
    [0, 2],
    [0, 2],
    [2, 2],
  ])
  assert.deepEqual(verticesByWallId.get('left'), [
    [0, 2],
    [0, 0.1],
    [0, 0.1],
    [0, 2],
  ])
})

test('room surface mesh builder unions overlapping coplanar spans across rooms', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'shared',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        id: 'room-a',
        polygon: [
          { x: 0, y: 0.1 },
          { x: 3, y: 0.1 },
          { x: 3, y: 2 },
          { x: 0, y: 2 },
        ],
        signature: 'room-a',
      }),
      room({
        id: 'room-b',
        polygon: [
          { x: 1, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 1, y: 2 },
        ],
        signature: 'room-b',
      }),
    ],
  })

  assert.equal(faces.length, 1)
  assert.deepEqual(
    faces[0].vertices.map((vertex) => [
      Number(vertex.position[0].toFixed(3)),
      Number(vertex.position[2].toFixed(3)),
    ]),
    [
      [0, 0.1],
      [4, 0.1],
      [4, 0.1],
      [0, 0.1],
    ],
  )
})

test('room surface mesh builder keeps UVs continuous across split wall ids', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'left-part',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'right-part',
      start: { x: 2, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })
  const facesByWallId = new Map(faces.map((face) => [face.wallId, face]))

  assert.deepEqual(facesByWallId.get('left-part')?.vertices.map((vertex) => vertex.uv[0]), [
    0,
    2,
    2,
    0,
  ])
  assert.deepEqual(
    facesByWallId.get('right-part')?.vertices.map((vertex) => vertex.uv[0]),
    [2, 4, 4, 2],
  )
  assert.deepEqual(facesByWallId.get('left-part')?.pickSource, {
    side: 1,
    wallId: 'left-part',
  })
  assert.deepEqual(facesByWallId.get('right-part')?.pickSource, {
    side: 1,
    wallId: 'right-part',
  })
})

test('room surface mesh builder splits visible wall faces at side attachments', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
    wall({
      id: 'branch',
      start: { x: 2, y: 0.1 },
      end: { x: 2, y: 2 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })
  const targetFaces = faces
    .filter((face) => face.wallId === 'target')
    .sort((first, second) => first.vertices[0].position[0] - second.vertices[0].position[0])

  assert.equal(targetFaces.length, 2)
  assert.deepEqual(
    targetFaces.map((face) => face.materialSource.fragmentId),
    [undefined, undefined],
  )
  assert.deepEqual(
    targetFaces.map((face) => face.pickSource),
    [
      { side: 1, wallId: 'target' },
      { side: 1, wallId: 'target' },
    ],
  )
  assert.deepEqual(
    targetFaces.map((face) =>
      face.vertices.map((vertex) => [
        Number(vertex.position[0].toFixed(3)),
        Number(vertex.position[2].toFixed(3)),
      ]),
    ),
    [
      [
        [0, 0.1],
        [2, 0.1],
        [2, 0.1],
        [0, 0.1],
      ],
      [
        [2, 0.1],
        [4, 0.1],
        [4, 0.1],
        [2, 0.1],
      ],
    ],
  )
  assert.deepEqual(
    targetFaces.map((face) => face.vertices.map((vertex) => vertex.uv[0])),
    [
      [0, 2, 2, 0],
      [2, 4, 4, 2],
    ],
  )
})

test('room surface mesh builder splits visible wall faces at wall endpoints on the same side line', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
    wall({
      id: 'branch',
      start: { x: 2, y: 0.1 },
      end: { x: 2, y: 1.7 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })
  const targetFaces = faces.filter((face) => face.wallId === 'target')

  assert.equal(targetFaces.length, 2)
})

test('room surface mesh builder splits visible wall faces where another wall crosses the side line', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
    wall({
      id: 'crossing-branch',
      start: { x: 2, y: -0.3 },
      end: { x: 2, y: 1.7 },
    }),
  ])
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })
  const targetFaces = faces.filter((face) => face.wallId === 'target')

  assert.equal(targetFaces.length, 2)
})

test('room surface mesh builder keeps diagonal side-attached walls clean', () => {
  ;(['external', 'internal'] as const).forEach((kind) => {
    const thickness = kind === 'external' ? 0.3 : 0.2
    const inset = thickness / 2
    const walls = [
      wall({
        id: `${kind}-bottom`,
        kind,
        start: { x: 0, y: 0 },
        end: { x: 5.3, y: 0 },
        thickness,
      }),
      wall({
        id: `${kind}-right`,
        kind,
        start: { x: 5.3, y: 0 },
        end: { x: 5.3, y: 8.17 },
        thickness,
      }),
      wall({
        id: `${kind}-top`,
        kind,
        start: { x: 5.3, y: 8.17 },
        end: { x: 0, y: 8.17 },
        thickness,
      }),
      wall({
        id: `${kind}-left`,
        kind,
        start: { x: 0, y: 8.17 },
        end: { x: 0, y: 0 },
        thickness,
      }),
      wall({
        id: `${kind}-diagonal`,
        kind,
        start: { x: inset, y: 5.45 },
        end: { x: 5.3 - inset, y: 3.95 },
        thickness,
      }),
    ]
    const renderedWalls = getRenderedWalls(walls)
    const topology = buildWallTopology(walls)
    const plans = buildRoomWallSurfaceRenderPlans({
      renderedWalls,
      rooms: topology.rooms,
    })
    const faces = buildRoomSurfaceWallFaces({
      renderedWalls,
      rooms: topology.rooms,
    })
    const diagonalFaces = faces.filter((face) => face.wallId === `${kind}-diagonal`)
    const veryNarrowFaces = faces.filter((face) => {
      const xs = face.vertices.map((vertex) => vertex.position[0])
      const ys = face.vertices.map((vertex) => vertex.position[2])
      const width = Math.max(...xs) - Math.min(...xs)
      const depth = Math.max(...ys) - Math.min(...ys)

      return Math.min(width, depth) > 0 && Math.min(width, depth) < 0.05
    })

    assert.equal(topology.rooms.length, 2)
    assert.equal(plans.flatMap((plan) => plan.problems).length, 0)
    assert.equal(diagonalFaces.length, 2)
    assert.equal(veryNarrowFaces.length, 0)
  })
})

test('room surface floor polygons follow composed diagonal side attachments', () => {
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
  const floorPolygons = buildRoomSurfaceFloorPolygons({
    renderedWalls,
    rooms: topology.rooms,
  })
  const polygons = topology.rooms.map((room) =>
    floorPolygons.get(room.signature) ?? [],
  )

  assert.equal(polygons.length, 2)
  assert.equal(polygons.every((polygon) => polygon.length === 4), true)
  assert.ok(
    polygons.some((polygon) =>
      polygon.some(
        (point) =>
          Math.abs(point.x - 0.15) < 0.001 &&
          Math.abs(point.y - 5.346) < 0.001,
      ),
    ),
  )
  assert.ok(
    polygons.some((polygon) =>
      polygon.some(
        (point) =>
          Math.abs(point.x - 5.15) < 0.001 &&
          Math.abs(point.y - 4.054) < 0.001,
      ),
    ),
  )
})

test('room surface mesh extends side-attached spans to wall plan side endpoints', () => {
  const walls = [
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 1.5, y: 1.5 },
      end: { x: 10.65, y: 1.5 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 10.65, y: 1.5 },
      end: { x: 10.65, y: 11.517 },
      thickness: 0.3,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 10.65, y: 11.517 },
      end: { x: 1.5, y: 11.517 },
      thickness: 0.3,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 1.5, y: 11.517 },
      end: { x: 1.5, y: 1.5 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'internal',
      start: { x: 1.5, y: 4.05 },
      end: { x: 10.65, y: 8.983 },
      thickness: 0.15,
    }),
  ]
  const renderedWalls = getRenderedWalls(walls)
  const topology = buildWallTopology(walls)
  const faces = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: topology.rooms,
  })
  const diagonalFaces = faces.filter((face) => face.wallId === 'diagonal')
  const startFace = diagonalFaces.find(
    (face) => face.materialSource.side === -1,
  )
  const endFace = diagonalFaces.find(
    (face) => face.materialSource.side === 1,
  )

  assert.ok(startFace)
  assert.ok(endFace)
  assert.deepEqual(
    startFace.vertices[0].position
      .filter((_, index) => index !== 1)
      .map((value) => Number(value.toFixed(3))),
    [1.65, 4.046],
  )
  assert.deepEqual(
    endFace.vertices[1].position
      .filter((_, index) => index !== 1)
      .map((value) => Number(value.toFixed(3))),
    [10.5, 8.987],
  )
})

test('room surface mesh keys identify replaceable wall sides', () => {
  const renderedWalls = getRenderedWalls([
    wall({
      id: 'north',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ])
  const [face] = buildRoomSurfaceWallFaces({
    renderedWalls,
    rooms: [
      room({
        polygon: [
          { x: 0, y: 0.1 },
          { x: 4, y: 0.1 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    ],
  })

  assert.equal(getRoomSurfaceKey(face), 'north:1')
})
