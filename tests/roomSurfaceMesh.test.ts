import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import type { DetectedRoom } from '../src/wallTopology.ts'
import {
  buildRoomWallSurfaceRenderPlans,
  buildRoomWallSurfacePlans,
  buildRoomSurfaceWallFaces,
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
  assert.deepEqual(faces[0].materialSource, {
    role: 'room-surface',
    side: 1,
    wallId: 'north',
  })
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
  assert.deepEqual(facesByWallId.get('bottom')?.materialSource, {
    role: 'room-surface',
    side: 1,
    wallId: 'bottom',
  })
  assert.deepEqual(facesByWallId.get('right')?.materialSource, {
    role: 'room-surface',
    side: 1,
    wallId: 'right',
  })
  assert.deepEqual(facesByWallId.get('top')?.materialSource, {
    role: 'room-surface',
    side: 1,
    wallId: 'top',
  })
  assert.deepEqual(facesByWallId.get('left')?.materialSource, {
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
