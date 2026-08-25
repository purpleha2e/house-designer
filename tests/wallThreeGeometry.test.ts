import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
import { buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { createWallBufferGeometry } from '../src/wallEngine/wallThreeGeometry.ts'

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

test('wall three adapter creates buffer geometry attributes and groups', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })
  const geometry = createWallBufferGeometry(payload)

  assert.equal(geometry.getAttribute('position').count, faces.length * 6)
  assert.equal(geometry.getAttribute('normal').count, faces.length * 6)
  assert.equal(geometry.getAttribute('uv').count, faces.length * 6)
  assert.deepEqual(
    geometry.groups.map((group) => ({
      count: group.count,
      materialIndex: group.materialIndex,
      start: group.start,
    })),
    payload.groups.map((group) => ({
      count: group.count,
      materialIndex: group.materialIndex,
      start: group.start,
    })),
  )

  geometry.dispose()
})

test('wall three adapter computes bounds for wall geometry', () => {
  const faces = buildWallMeshFaces([
    wall({
      id: 'plain',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
  ])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'floor-1' })
  const geometry = createWallBufferGeometry(payload)

  assert.equal(geometry.boundingBox?.min.x, 0)
  assert.equal(geometry.boundingBox?.max.x, 2)
  assert.equal(Number(geometry.boundingBox?.min.z.toFixed(3)), -0.1)
  assert.equal(Number(geometry.boundingBox?.max.z.toFixed(3)), 0.1)
  assert.equal(Number(geometry.boundingBox?.max.y.toFixed(3)), 2.4)

  geometry.dispose()
})
