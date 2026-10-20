import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
import { conformWallRenderEdges } from '../src/wallEngine/wallRenderEdges.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'

function facade(id: string, points: number[][]): WallMeshFace {
  return { faceId: id, wallId: 'rear-facade', kind: 'side', normal: [1, 0, 0],
    roofSurfaceRegion: 'roof-exposed',
    materialSource: { wallId: 'rear-facade', side: 1, fragmentId: id },
    pickSource: { wallId: 'rear-facade', side: 1 },
    uvSource: { wallId: 'rear-facade', side: 1 },
    vertices: points.map(([y, z]) => ({ position: [8.252178207, y, z], uv: [z * 2, y + 2.7] })) as WallMeshFace['vertices'] }
}

test('rear lean-to material partitions share exact render edges and retain paint and UVs', () => {
  const seam = 5.907441620938566, height = .3195870662037755
  const left = facade('left', [[0, seam], [1.008304406138053, seam], [1.008304406138053, seam - 1], [0, seam - 1]])
  const bottom = facade('bottom', [[0, seam + 1], [height, seam + 1], [height, seam], [0, seam]])
  const top = facade('top', [[height, seam + 1], [1.008304406138053, seam + 1], [1.008304406138053, seam], [height, seam]])
  const faces = [left, bottom, top], before = structuredClone(faces)
  const conformed = conformWallRenderEdges(faces)
  const split = conformed.get(left)!.find(v => v.position[1] === height && v.position[2] === seam)!
  assert.ok(split, 'the long edge must split at the neighbouring roof-region vertex')
  assert.deepEqual(split.uv, [seam * 2, height + 2.7])
  const payload = buildWallBufferGeometryPayload(faces, { floorId: 'upper', groupBy: 'face' })
  const positions = new Float32Array(payload.positions), counts = new Map<string, number>()
  for (let i = 0; i < positions.length; i += 9) for (let j = 0; j < 3; j++) {
    const a = [...positions.slice(i + j * 3, i + j * 3 + 3)]
    const k = (j + 1) % 3, b = [...positions.slice(i + k * 3, i + k * 3 + 3)]
    if (a[2] !== Math.fround(seam) || b[2] !== Math.fround(seam) || a[1] === b[1]) continue
    const key = [a[1], b[1]].sort((a, b) => a - b).join(':')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  assert.equal(counts.size, 2, 'the seam consists of two matching edge segments')
  assert.ok([...counts.values()].every(count => count === 2))
  assert.deepEqual(payload.groups.map(group => group.faceIds), [['left'], ['bottom'], ['top']])
  assert.equal(payload.pickTargets.size, 3)
  assert.deepEqual(faces, before, 'saved face identities and source geometry are unchanged')
})
