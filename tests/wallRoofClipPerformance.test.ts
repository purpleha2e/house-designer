import assert from 'node:assert/strict'
import test from 'node:test'
import { clipWallFacesToRoofUndersides, roofFacePlanes, type ClipPlane } from '../src/wallEngine/wallRoofClip.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'

test('overlapping roof cutters resolve cap ownership once and stop cutting empty caps', () => {
  // Many fitted roof panels can share a boundary across many wall tops.
  // Count plane evaluations instead of imposing a machine-dependent timeout.
  const faces: WallMeshFace[] = Array.from({ length: 24 }, (_, index) => ({
    faceId: `wall-${index}:top`, wallId: `wall-${index}`, kind: 'top', normal: [0, 1, 0],
    materialSource: { wallId: `wall-${index}` }, pickSource: { wallId: `wall-${index}` },
    uvSource: { wallId: `wall-${index}` },
    vertices: [[0, 3, index], [2, 3, index], [2, 3, index + 0.2], [0, 3, index + 0.2]]
      .map(position => ({ position, uv: [position[0], position[2]] })) as WallMeshFace['vertices'],
  }))
  let evaluations = 0
  const volumes = Array.from({ length: 40 }, () => {
    const planes = roofFacePlanes([[1, 1, -1], [3, 1, -1], [3, 1, 25], [1, 1, 25]])
      .map((plane): ClipPlane => point => { evaluations++; return plane(point) })
    return { planes, surfacePlane: planes.at(-1), protectedFootprints: [],
      excludedWallIds: new Set<string>(), clipSides: true }
  })
  const expected = clipWallFacesToRoofUndersides(faces, { floorElevation: 0, volumes: volumes.slice(0, 1) })
  evaluations = 0
  const actual = clipWallFacesToRoofUndersides(faces, { floorElevation: 0, volumes })
  assert.deepEqual(actual, expected, 'overlapping panels must retain exactly one closure, with identical UVs and ownership')
  assert.ok(evaluations < 400_000, `redundant cap work: ${evaluations} plane evaluations`)
})
