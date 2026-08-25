import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
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

test('wall buffer adapter emits expanded triangle attributes and groups', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })

  assert.equal(payload.groups.length, payload.materialSlots.length)
  assert.equal(payload.positions.length, faces.length * 6 * 3)
  assert.equal(payload.normals.length, faces.length * 6 * 3)
  assert.equal(payload.uvs.length, faces.length * 6 * 2)
  assert.equal(
    payload.groups.reduce((total, group) => total + group.count, 0),
    faces.length * 6,
  )
  assert.deepEqual(
    payload.groups.map((group) => ({
      count: group.count,
      materialIndex: group.materialIndex,
    })),
    [
      { count: 6, materialIndex: 0 },
      { count: 6, materialIndex: 1 },
      { count: 24, materialIndex: 2 },
    ],
  )
})

test('wall buffer adapter reuses material slots by material source', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })

  assert.deepEqual(payload.materialSlots, [
    {
      index: 0,
      source: {
        side: 1,
        wallId: 'plain',
      },
    },
    {
      index: 1,
      source: {
        side: -1,
        wallId: 'plain',
      },
    },
    {
      index: 2,
      source: {
        wallId: 'plain',
      },
    },
  ])
})

test('wall buffer adapter emits triangle winding that matches face normals', () => {
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
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })

  for (
    let vertexOffset = 0;
    vertexOffset < payload.positions.length / 3;
    vertexOffset += 3
  ) {
    const expectedNormal = payload.normals.slice(
      vertexOffset * 3,
      vertexOffset * 3 + 3,
    )
    const triangleStart = vertexOffset * 3
    const first = payload.positions.slice(triangleStart, triangleStart + 3)
    const second = payload.positions.slice(triangleStart + 3, triangleStart + 6)
    const third = payload.positions.slice(triangleStart + 6, triangleStart + 9)
    const firstEdge = [
      second[0] - first[0],
      second[1] - first[1],
      second[2] - first[2],
    ]
    const secondEdge = [
      third[0] - first[0],
      third[1] - first[1],
      third[2] - first[2],
    ]
    const triangleNormal = [
      firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
      firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
      firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
    ]
    const normalDot =
      triangleNormal[0] * expectedNormal[0] +
      triangleNormal[1] * expectedNormal[1] +
      triangleNormal[2] * expectedNormal[2]

    assert.ok(
      normalDot >= 0,
      `triangle at vertex offset ${vertexOffset} should match its face normal`,
    )
  }
})

test('wall buffer adapter maps side material slots to wall-face pick targets', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })

  assert.deepEqual(payload.pickTargets.get(0), {
    floorId: 'floor-1',
    side: 1,
    type: 'wall-face',
    wallId: 'plain',
  })
  assert.deepEqual(payload.pickTargets.get(1), {
    floorId: 'floor-1',
    side: -1,
    type: 'wall-face',
    wallId: 'plain',
  })
  assert.equal(payload.pickTargets.has(2), false)
})

test('wall buffer adapter gives side attachment caps the adjoining material slot', () => {
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
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })
  const inheritedCap = faces.find(
    (face) =>
      face.wallId === 'branch' &&
      face.kind === 'cap' &&
      face.endpoint === 'start',
  )
  const inheritedCapGroup = payload.groups.find((group) =>
    group.faceIds.includes(inheritedCap?.faceId ?? ''),
  )
  const inheritedSlot = payload.materialSlots.find(
    (slot) => slot.index === inheritedCapGroup?.materialIndex,
  )

  assert.deepEqual(inheritedSlot?.source, {
    side: -1,
    wallId: 'target',
  })
})
