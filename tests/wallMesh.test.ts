import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'

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
    ['bottom', 'cap', 'cap', 'side', 'side', 'top'],
  )
  assert.equal(
    faces.filter((face) => face.kind === 'side').every(
      (face) => face.materialSource.wallId === 'plain' && face.uvSource.wallId === 'plain',
    ),
    true,
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

  assert.deepEqual(horizontalCaps.map((face) => face.endpoint), ['start'])
  assert.equal(faces.some((face) => face.faceId.startsWith('join:')), false)
})

test('wall mesh builder assigns side attachment cap material and uv source', () => {
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
  const joinEndVertex = horizontalPositiveJoinSide?.vertices[1].position
  const joinTopFaceIds = faces
    .filter((face) => face.faceId.startsWith('join-top:'))
    .map((face) => face.faceId)
    .sort()

  assert.ok(bodyEndVertex)
  assert.ok(joinEndVertex)
  assert.deepEqual(
    joinTopFaceIds,
    [
      'join-top:endpoint:0:horizontal:end:-1',
      'join-top:endpoint:0:horizontal:end:1',
      'join-top:endpoint:0:vertical:start:-1',
      'join-top:endpoint:0:vertical:start:1',
    ],
  )
  assert.equal(Number(bodyEndVertex[0].toFixed(3)), 2)
  assert.equal(Number(bodyEndVertex[2].toFixed(3)), 0.1)
  assert.equal(Number(joinEndVertex[0].toFixed(3)), 2.1)
  assert.equal(Number(joinEndVertex[2].toFixed(3)), 0.1)
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
    true,
  )
  assert.equal(
    faces.some(
      (face) =>
        face.faceId === 'external-vertical:join-side:start:-1' &&
        face.kind === 'side',
    ),
    true,
  )
  assert.equal(
    faces.some((face) => face.faceId.startsWith('join-top:')),
    true,
  )
  assert.deepEqual(
    faces
      .filter((face) => face.faceId.startsWith('join-top:'))
      .map((face) => face.faceId)
      .sort(),
    [
      'join-top:endpoint:0:external-horizontal:end:-1',
      'join-top:endpoint:0:external-horizontal:end:1',
      'join-top:endpoint:0:external-vertical:start:-1',
      'join-top:endpoint:0:external-vertical:start:1',
    ],
  )
  assert.equal(
    faces.some((face) =>
      face.vertices.some((vertex) => Number.isNaN(vertex.position[0])),
    ),
    false,
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
    'opening-wall:opening:window:bottom',
    'opening-wall:opening:window:left',
    'opening-wall:opening:window:right',
    'opening-wall:opening:window:top',
  ])
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
    (face) => face.faceId === 'door-wall:opening:door:left',
  )
  const rightReveal = faces.find(
    (face) => face.faceId === 'door-wall:opening:door:right',
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

test('wall mesh builder splits subordinate crossing side faces', () => {
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

  assert.equal(subordinateSideFaces.length, 4)
  assert.deepEqual(
    subordinateSideFaces.map((face) => face.vertices[0].uv[0]),
    [0, 1.001, 0, 1.001],
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
