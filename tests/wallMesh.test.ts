import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import {
  buildWallBodyPerimeterMeshFaces,
  buildWallMeshFaces,
} from '../src/wallEngine/wallMesh.ts'

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

test('wall mesh builder creates stable faces for a plain wall', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])

  assert.deepEqual(
    faces.map((face) => face.kind).sort(),
    ['bottom', 'cap', 'cap', 'cap', 'cap', 'side', 'side', 'top'],
  )
  assert.equal(
    faces.filter((face) => face.kind === 'side').every(
      (face) => face.materialSource.wallId === 'plain' && face.uvSource.wallId === 'plain',
    ),
    true,
  )
  assert.deepEqual(
    faces
      .filter((face) => face.kind === 'cap')
      .map((face) => face.materialSource)
      .sort((first, second) => (first.side ?? 0) - (second.side ?? 0)),
    [
      { role: 'cap', side: -1, wallId: 'plain' },
      { role: 'cap', side: -1, wallId: 'plain' },
      { role: 'cap', side: 1, wallId: 'plain' },
      { role: 'cap', side: 1, wallId: 'plain' },
    ],
  )
})

test('wall mesh builder omits caps at snapped endpoint joins', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'vertical',
      start: { x: 2, y: 0 },
      end: { x: 2, y: 2 },
    }),
  ])
  const horizontalCaps = faces.filter(
    (face) => face.wallId === 'horizontal' && face.kind === 'cap',
  )

  assert.deepEqual(
    horizontalCaps.map((face) => `${face.endpoint}:${face.materialSource.side}`).sort(),
    ['start:-1', 'start:1'],
  )
  assert.equal(faces.some((face) => face.faceId.startsWith('join:')), false)
})

test('wall mesh builder assigns side attachment cap material and uv source when caps are emitted', () => {
  const faces = buildWallMeshFaces(
    [
      wall({
        id: 'target',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 4 },
      }),
      wall({
        id: 'branch',
        start: { x: 0.1, y: 2 },
        end: { x: 2, y: 2 },
      }),
    ],
    {
      omitSideAttachmentCapsForRenderedTargetWallIds: new Set(),
    },
  )
  const branchStartCap = faces.find(
    (face) =>
      face.wallId === 'branch' &&
      face.kind === 'cap' &&
      face.endpoint === 'start',
  )

  assert.deepEqual(branchStartCap?.materialSource, {
    side: -1,
    wallId: 'target',
  })
  assert.deepEqual(branchStartCap?.uvSource, {
    side: -1,
    wallId: 'target',
  })
})

test('wall mesh builder keeps side attachment caps when target wall is rendered', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'branch',
      start: { x: 0.1, y: 2 },
      end: { x: 2, y: 2 },
    }),
  ])

  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'branch' &&
        face.kind === 'cap' &&
        face.endpoint === 'start',
    ),
    true,
  )
})

test('wall mesh builder keeps diagonal side attachment caps visible', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'diagonal',
      start: { x: 0.1, y: 2 },
      end: { x: 2, y: 2.9 },
    }),
  ])
  const diagonalStartCap = faces.find(
    (face) =>
      face.wallId === 'diagonal' &&
      face.kind === 'cap' &&
      face.endpoint === 'start',
  )

  assert.ok(diagonalStartCap)
  assert.deepEqual(diagonalStartCap.materialSource, {
    side: -1,
    wallId: 'target',
  })
  assert.ok(Math.abs(diagonalStartCap.normal[0] + 1) < 0.001)
  assert.ok(Math.abs(diagonalStartCap.normal[2]) < 0.001)
})

test('wall mesh builder can omit side attachment caps covered by footprint walls', () => {
  const faces = buildWallMeshFaces(
    [
      wall({
        id: 'external',
        kind: 'external',
        start: { x: -2, y: 0 },
        end: { x: 2, y: 0 },
        thickness: 0.3,
      }),
      wall({
        id: 'branch',
        start: { x: 0, y: -1.5 },
        end: { x: 0, y: -0.15 },
        thickness: 0.2,
      }),
    ],
    {
      omitSideAttachmentCapsForTargetWallIds: new Set(['external']),
    },
  )

  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'branch' &&
        face.kind === 'cap' &&
        face.endpoint === 'end',
    ),
    false,
  )
})

test('wall mesh builder keeps diagonal side attachment caps against footprint walls', () => {
  const faces = buildWallMeshFaces(
    [
      wall({
        id: 'external',
        kind: 'external',
        start: { x: -2, y: 0 },
        end: { x: 2, y: 0 },
        thickness: 0.3,
      }),
      wall({
        id: 'diagonal',
        start: { x: -0.7, y: -1.5 },
        end: { x: 0, y: -0.15 },
        thickness: 0.2,
      }),
    ],
    {
      omitSideAttachmentCapsForTargetWallIds: new Set(['external']),
    },
  )

  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'diagonal' &&
        face.kind === 'cap' &&
        face.endpoint === 'end',
    ),
    true,
  )
})

test('wall mesh builder trims side attachments to the target wall face', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: -2, y: 0 },
      end: { x: 2, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'branch',
      start: { x: 0, y: -1.5 },
      end: { x: 0, y: -0.15 },
      thickness: 0.2,
    }),
  ])
  const branchTop = faces.find(
    (face) => face.wallId === 'branch' && face.faceId === 'branch:top',
  )
  const maxZ = Math.max(
    ...(branchTop?.vertices.map((vertex) => vertex.position[2]) ?? []),
  )

  assert.equal(Number(maxZ.toFixed(3)), -0.15)
})

test('wall mesh builder cuts angled side attachments along the target wall face', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: -2, y: 0 },
      end: { x: 2, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'branch',
      start: { x: -0.8, y: -1.5 },
      end: { x: 0, y: -0.15 },
      thickness: 0.2,
    }),
  ])
  const branchTop = faces.find(
    (face) => face.wallId === 'branch' && face.faceId === 'branch:top',
  )
  const attachmentEdgeZValues =
    branchTop?.vertices
      .slice(1, 3)
      .map((vertex) => Number(vertex.position[2].toFixed(3))) ?? []

  assert.deepEqual(attachmentEdgeZValues, [-0.15, -0.15])
})

test('wall mesh builder converges snapped endpoint joins on the wall body', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'vertical',
      start: { x: 2, y: 0 },
      end: { x: 2, y: 2 },
    }),
  ])
  const horizontalPositiveBodySide = faces.find(
    (face) =>
      face.wallId === 'horizontal' &&
      face.kind === 'side' &&
      face.materialSource.side === 1,
  )
  const horizontalPositiveJoinSide = faces.find(
    (face) =>
      face.wallId === 'horizontal' &&
      face.kind === 'side' &&
      face.faceId === 'horizontal:join-side:end:1',
  )
  const bodyEndVertex = horizontalPositiveBodySide?.vertices[1].position
  const joinTopFaceIds = faces
    .filter((face) => face.faceId.startsWith('join-top:'))
    .map((face) => face.faceId)
    .sort()

  assert.ok(bodyEndVertex)
  assert.equal(horizontalPositiveJoinSide, undefined)
  assert.deepEqual(joinTopFaceIds, [])
  assert.equal(Number(bodyEndVertex[0].toFixed(3)), 2)
  assert.equal(Number(bodyEndVertex[2].toFixed(3)), 0.1)
})

test('wall mesh builder supports external snapped endpoint joins', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'external-horizontal',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'external-vertical',
      kind: 'external',
      start: { x: 3, y: 0 },
      end: { x: 3, y: 3 },
      thickness: 0.3,
    }),
  ])

  assert.equal(
    faces.some(
      (face) =>
        face.faceId === 'external-horizontal:join-side:end:1' &&
        face.kind === 'side',
    ),
    false,
  )
  assert.equal(
    faces.some(
      (face) =>
        face.faceId === 'external-vertical:join-side:start:-1' &&
        face.kind === 'side',
    ),
    false,
  )
  assert.equal(
    faces.some((face) => face.faceId.startsWith('join-top:')),
    false,
  )
  assert.deepEqual(
    faces
      .filter((face) => face.faceId.startsWith('join-top:'))
      .map((face) => face.faceId)
      .sort(),
    [],
  )
  assert.equal(
    faces.some((face) =>
      face.vertices.some((vertex) => Number.isNaN(vertex.position[0])),
    ),
    false,
  )
})

test('wall mesh builder keeps convergence strips for angled endpoint joins', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'angled',
      start: { x: 2, y: 0 },
      end: { x: 3, y: 1 },
    }),
  ])

  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'horizontal' &&
        face.kind === 'side' &&
        face.faceId.startsWith('horizontal:join-side:end:'),
    ),
    true,
  )
})

test('wall mesh builder cuts wall side faces around openings', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'opening-wall',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      openings: [
        {
          bottom: 0.8,
          center: 2,
          height: 1,
          id: 'window',
          modelId: 'window-model',
          width: 1,
        },
      ],
    }),
  ])
  const sideFaces = faces.filter(
    (face) => face.wallId === 'opening-wall' && face.kind === 'side',
  )
  const revealFaceIds = faces
    .filter((face) => face.faceId.startsWith('opening-wall:opening:window:'))
    .map((face) => face.faceId)
    .sort()

  assert.equal(
    sideFaces.some((face) => {
      const xs = face.vertices.map((vertex) => vertex.position[0])
      const ys = face.vertices.map((vertex) => vertex.position[1])

      return (
        Math.min(...xs) < 2 &&
        Math.max(...xs) > 2 &&
        Math.min(...ys) < 1.2 &&
        Math.max(...ys) > 1.2
      )
    }),
    false,
  )
  assert.deepEqual(revealFaceIds, [
    'opening-wall:opening:window:bottom:-1',
    'opening-wall:opening:window:bottom:1',
    'opening-wall:opening:window:left:-1',
    'opening-wall:opening:window:left:1',
    'opening-wall:opening:window:right:-1',
    'opening-wall:opening:window:right:1',
    'opening-wall:opening:window:top:-1',
    'opening-wall:opening:window:top:1',
  ])
  assert.equal(
    faces
      .filter((face) => face.faceId.startsWith('opening-wall:opening:window:'))
      .every((face) => typeof face.materialSource.side === 'number'),
    true,
  )
})

test('wall mesh builder cuts floor-level doorways out of the bottom face', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'door-wall',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      openings: [
        {
          bottom: 0,
          center: 2,
          height: 2.1,
          id: 'door',
          modelId: 'door-model',
          width: 1,
        },
      ],
    }),
  ])
  const bottomFaces = faces.filter(
    (face) => face.wallId === 'door-wall' && face.kind === 'bottom',
  )
  const openingBottomReveal = faces.find(
    (face) => face.faceId === 'door-wall:opening:door:bottom',
  )

  assert.equal(openingBottomReveal, undefined)
  assert.equal(bottomFaces.length, 2)
  assert.equal(
    bottomFaces.some((face) => {
      const xs = face.vertices.map((vertex) => vertex.position[0])

      return Math.min(...xs) < 2 && Math.max(...xs) > 2
    }),
    false,
  )
})

test('wall mesh builder merges overlapping opening reveals', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'overlap-wall',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 },
      openings: [
        {
          bottom: 0,
          center: 2,
          height: 2,
          id: 'patio-door',
          modelId: 'patio-door-model',
          width: 2,
        },
        {
          bottom: 0.9,
          center: 3,
          height: 1.2,
          id: 'window',
          modelId: 'window-model',
          width: 1.5,
        },
      ],
      thickness: 0.3,
    }),
  ])
  const revealFaces = faces.filter(
    (face) => face.wallId === 'overlap-wall' && face.kind === 'cap',
  )
  const hasInternalSharedReveal = revealFaces.some((face) => {
    const xs = face.vertices.map((vertex) => vertex.position[0])
    const ys = face.vertices.map((vertex) => vertex.position[1])
    const isVerticalAtDoorRight = xs.every((x) => Math.abs(x - 3) < 0.0001)
    const isVerticalAtWindowLeft = xs.every((x) => Math.abs(x - 2.25) < 0.0001)
    const spansOverlapHeight =
      Math.min(...ys) < 1.95 && Math.max(...ys) > 0.95

    return (isVerticalAtDoorRight || isVerticalAtWindowLeft) && spansOverlapHeight
  })

  assert.equal(hasInternalSharedReveal, false)
})

test('wall mesh builder keeps opening distances stable on side-attached walls', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'target',
      start: { x: 0, y: -2 },
      end: { x: 0, y: 2 },
      thickness: 0.3,
    }),
    wall({
      id: 'door-wall',
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      openings: [
        {
          bottom: 0,
          center: 1,
          height: 2.1,
          id: 'door',
          modelId: 'door-model',
          width: 0.8,
        },
      ],
      thickness: 0.2,
    }),
  ])
  const sideFaces = faces.filter(
    (face) =>
      face.wallId === 'door-wall' &&
      face.kind === 'side' &&
      face.materialSource.side === 1,
  )
  const leftReveal = faces.find(
    (face) => face.faceId === 'door-wall:opening:door:left:1',
  )
  const rightReveal = faces.find(
    (face) => face.faceId === 'door-wall:opening:door:right:1',
  )

  assert.equal(
    sideFaces.some((face) => {
      const xs = face.vertices.map((vertex) => vertex.position[0])
      const ys = face.vertices.map((vertex) => vertex.position[1])

      return (
        Math.min(...xs) < 1 &&
        Math.max(...xs) > 1 &&
        Math.min(...ys) < 1 &&
        Math.max(...ys) > 1
      )
    }),
    false,
  )
  assert.deepEqual(
    leftReveal?.vertices.map((vertex) => Number(vertex.position[0].toFixed(3))),
    [0.6, 0.6, 0.6, 0.6],
  )
  assert.deepEqual(
    rightReveal?.vertices.map((vertex) => Number(vertex.position[0].toFixed(3))),
    [1.4, 1.4, 1.4, 1.4],
  )
})

test('wall mesh builder fills top caps for three-way external endpoint joins', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'left',
      kind: 'external',
      start: { x: -1.2, y: -1.1 },
      end: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 0.65, y: -1.8 },
      thickness: 0.3,
    }),
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 1.7, y: 1 },
      thickness: 0.3,
    }),
  ])
  const joinTopFaces = faces.filter((face) => face.faceId.startsWith('join-top:'))

  assert.equal(joinTopFaces.length > 0, true)
  assert.equal(
    joinTopFaces.every((face) => face.kind === 'top'),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':left:end:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':right:start:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':bottom:start:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) =>
      face.vertices.some((vertex) => Number.isNaN(vertex.position[0])),
    ),
    false,
  )
})

test('wall mesh builder fills top caps for three-way internal endpoint joins', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 2.67, y: 0 },
      thickness: 0.15,
    }),
    wall({
      id: 'diagonal',
      start: { x: -1.8, y: 1.8 },
      end: { x: 0, y: 0 },
      thickness: 0.15,
    }),
    wall({
      id: 'verticalish',
      start: { x: 0, y: 0 },
      end: { x: 0.5, y: -2.6 },
      thickness: 0.15,
    }),
  ])
  const joinTopFaces = faces.filter((face) => face.faceId.startsWith('join-top:'))

  assert.equal(joinTopFaces.length, 6)
  assert.equal(
    joinTopFaces.every((face) => face.kind === 'top'),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':horizontal:start:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':diagonal:end:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) => face.faceId.includes(':verticalish:start:')),
    true,
  )
  assert.equal(
    joinTopFaces.some((face) =>
      face.vertices.some((vertex) => Number.isNaN(vertex.position[0])),
    ),
    false,
  )
})

test('wall mesh builder keeps the wall body rectangular when both endpoints are joined', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 6, y: 0 },
    }),
    wall({
      id: 'left-angled',
      start: { x: 0, y: 0 },
      end: { x: 1, y: -0.8 },
    }),
    wall({
      id: 'right-angled',
      start: { x: 6, y: 0 },
      end: { x: 5.4, y: -1 },
    }),
  ])
  const horizontalBodyTop = faces.find(
    (face) =>
      face.wallId === 'horizontal' &&
      face.kind === 'top' &&
      face.faceId === 'horizontal:top',
  )
  const horizontalBodySide = faces.find(
    (face) =>
      face.wallId === 'horizontal' &&
      face.kind === 'side' &&
      face.materialSource.side === -1 &&
      !face.faceId.includes(':join-side:'),
  )
  const xs = horizontalBodyTop?.vertices.map((vertex) => vertex.position[0]) ?? []
  const sideXs = horizontalBodySide?.vertices.map((vertex) => vertex.position[0]) ?? []

  assert.deepEqual(xs.map((value) => Number(value.toFixed(3))), [0, 6, 6, 0])
  assert.deepEqual(sideXs.map((value) => Number(value.toFixed(3))), [0, 6, 6, 0])
  assert.equal(
    faces.filter(
      (face) =>
        face.wallId === 'horizontal' &&
        face.faceId.includes(':join-side:'),
    ).length,
    4,
  )
  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'horizontal' &&
        (face.faceId.includes(':top-join:') ||
          face.faceId.includes(':bottom-join:')),
    ),
    false,
  )
})

test('wall mesh builder keeps crossing walls unsplit because editing disallows crossings', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'leader',
      kind: 'external',
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'subordinate',
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
    }),
  ])
  const subordinateSideFaces = faces.filter(
    (face) => face.wallId === 'subordinate' && face.kind === 'side',
  )

  assert.equal(subordinateSideFaces.length, 2)
  assert.deepEqual(
    subordinateSideFaces.map((face) => face.vertices[0].uv[0]),
    [0, 0],
  )
})

test('wall mesh builder does not emit endpoint join strips for wall-thickness-scale walls', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'host',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
    }),
    wall({
      id: 'short',
      start: { x: 1, y: 0 },
      end: { x: 1.08, y: -0.1 },
    }),
  ])

  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'short' && face.faceId.includes(':join-side:'),
    ),
    false,
  )
  assert.equal(
    faces.some(
      (face) =>
        face.wallId === 'short' &&
        face.kind === 'side' &&
        face.vertices.some((vertex) => Math.abs(vertex.position[0]) > 2),
    ),
    false,
  )
})

test('wall mesh builder does not render chamfer-limit endpoint joins as long side strips', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'horizontal',
      start: { x: 2.419, y: 4.05 },
      end: { x: 7.29, y: 4.05 },
      thickness: 0.15,
    }),
    wall({
      id: 'angled',
      start: { x: 7.29, y: 4.05 },
      end: { x: 2.419, y: 6.366 },
      thickness: 0.15,
    }),
  ])
  const joinSideFaceIds = faces
    .filter((face) => face.faceId.includes(':join-side:'))
    .map((face) => face.faceId)

  assert.deepEqual(joinSideFaceIds.sort(), [
    'angled:join-side:start:1',
    'horizontal:join-side:end:1',
  ])
  assert.equal(
    faces.some((face) =>
      face.vertices.some((vertex) => vertex.position[0] > 8),
    ),
    false,
  )
  assert.equal(
    faces.some((face) => face.faceId.includes(':top-join:')),
    false,
  )
  assert.equal(
    faces
      .filter((face) => face.faceId.startsWith('join-top:'))
      .every((face) =>
        face.vertices.every((vertex) => vertex.position[0] < 8),
      ),
    true,
  )
})

test('wall body perimeter mesh extrudes the composed perimeter outline', () => {
  const faces = buildWallBodyPerimeterMeshFaces([
    wall({
      id: 'horizontal',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'diagonal',
      kind: 'external',
      start: { x: 2, y: 0 },
      end: { x: 3, y: 1 },
      thickness: 0.3,
    }),
  ])
  const topFaces = faces.filter((face) => face.kind === 'top')
  const bottomFaces = faces.filter((face) => face.kind === 'bottom')
  const sideFaces = faces.filter((face) => face.kind === 'side')

  assert.ok(topFaces.length > 0)
  assert.equal(bottomFaces.length, topFaces.length)
  assert.ok(sideFaces.length >= 4)
  assert.equal(
    faces.every((face) =>
      face.vertices.every((vertex) =>
        vertex.position.every((coordinate) => Number.isFinite(coordinate)),
      ),
    ),
    true,
  )
  assert.equal(
    sideFaces.some((face) => face.materialSource.wallId === 'diagonal'),
    true,
  )
  assert.equal(
    sideFaces.some((face) => face.materialSource.role === 'cap'),
    true,
  )
})

test('wall body perimeter mesh preserves individual heights in a mixed-height join', () => {
  const faces = buildWallBodyPerimeterMeshFaces([
    wall({
      end: { x: 2, y: 0 },
      height: 1.2,
      id: 'short',
      start: { x: 0, y: 0 },
    }),
    wall({
      end: { x: 2, y: 2 },
      height: 2.4,
      id: 'tall',
      start: { x: 2, y: 0 },
    }),
  ])
  const shortFaces = faces.filter((face) => face.wallId === 'short')
  const tallFaces = faces.filter((face) => face.wallId === 'tall')

  assert.ok(shortFaces.length > 0)
  assert.ok(tallFaces.length > 0)
  assert.ok(faces.every((face) => face.faceId.startsWith('perimeter:')))
  assert.equal(
    Math.max(...shortFaces.flatMap((face) => face.vertices.map((vertex) => vertex.position[1]))),
    1.2,
  )
  assert.equal(
    Math.max(...tallFaces.flatMap((face) => face.vertices.map((vertex) => vertex.position[1]))),
    2.4,
  )
  assert.ok(
    faces.some((face) => {
      const heights = face.vertices.map((vertex) => vertex.position[1])
      return (
        face.kind === 'side' &&
        Math.min(...heights) === 1.2 &&
        Math.max(...heights) === 2.4
      )
    }),
  )
  const intermediateTopFaces = faces.filter(
    (face) =>
      face.kind === 'top' &&
      face.vertices.every((vertex) => vertex.position[1] === 1.2),
  )

  assert.ok(intermediateTopFaces.length > 0)
  assert.equal(
    intermediateTopFaces.some((face) =>
      face.vertices.some((vertex) => vertex.position[2] > 0.2),
    ),
    false,
  )
})

test('wall body perimeter mesh preserves holes while extruding rings', () => {
  const faces = buildWallBodyPerimeterMeshFaces([
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      thickness: 0.2,
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 4, y: 0 },
      end: { x: 4, y: 4 },
      thickness: 0.2,
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 4, y: 4 },
      end: { x: 0, y: 4 },
      thickness: 0.2,
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0, y: 4 },
      end: { x: 0, y: 0 },
      thickness: 0.2,
    }),
  ])

  assert.ok(faces.some((face) => face.faceId.includes(':hole:0:side:')))
  assert.ok(faces.some((face) => face.kind === 'top'))
  assert.ok(faces.some((face) => face.kind === 'bottom'))
})

test('wall body perimeter mesh cuts side faces around openings', () => {
  const faces = buildWallBodyPerimeterMeshFaces([
    wall({
      id: 'opening-wall',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      thickness: 0.3,
      openings: [
        {
          bottom: 0,
          center: 2,
          height: 2.1,
          id: 'door',
          modelId: 'door-model',
          width: 0.9,
        },
      ],
    }),
  ])
  const openingSideFaces = faces.filter(
    (face) =>
      face.kind === 'side' &&
      face.materialSource.wallId === 'opening-wall' &&
      face.vertices.some(
        (vertex) =>
          vertex.position[0] > 1.55 &&
          vertex.position[0] < 2.45 &&
          vertex.position[1] > 0.1 &&
          vertex.position[1] < 2,
      ),
  )
  const revealFaceIds = faces
    .filter((face) => face.faceId.startsWith('opening-wall:opening:door:'))
    .map((face) => face.faceId)
    .sort()

  assert.deepEqual(openingSideFaces, [])
  assert.deepEqual(revealFaceIds, [
    'opening-wall:opening:door:left:-1',
    'opening-wall:opening:door:left:1',
    'opening-wall:opening:door:right:-1',
    'opening-wall:opening:door:right:1',
    'opening-wall:opening:door:top:-1',
    'opening-wall:opening:door:top:1',
  ])
})
