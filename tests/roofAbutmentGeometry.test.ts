import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { clipRoofGeometryAtAbuttingWalls, clipRoofGeometryByVolumes, getRoofAbutmentPlanes, wallOverlapsRoofHeight } from '../src/roofAbutmentGeometry.ts'
import { readFileSync } from 'node:fs'
import type { FloorLevel } from '../src/types.ts'
import { buildRoofProfileFaces } from '../src/roofProfile.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { clipWallFacesToRoofUndersides } from '../src/wallEngine/wallRoofClip.ts'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import type { Wall } from '../src/types.ts'

const wall: Wall = { id: 'facade', kind: 'external', start: { x: 0, y: -1 }, end: { x: 0, y: 1 }, thickness: 0.3, height: 2.4 }

test('untextured loft trim is clipped below a sloping roof underside', () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 5.23, 0, 2, 5.23, 0, 2, 5.32, 0,
    0, 5.23, 0, 2, 5.32, 0, 0, 5.32, 0,
  ], 3))
  geometry.computeVertexNormals()
  const planes = roofFacePlanes([[0, 5.4, -1], [2, 5.2, -1], [2, 5.2, 1], [0, 5.4, 1]])
  const clipped = clipRoofGeometryByVolumes(geometry, [planes], point => point)
  const positions = clipped.getAttribute('position')
  assert.ok(positions.count > 0, 'trim inside the loft remains')
  for (let i = 0; i < positions.count; i++) {
    assert.ok(positions.getY(i) <= 5.4 - 0.1 * positions.getX(i) + 1e-6,
      'trim must not project through the enclosing roof')
  }
  geometry.dispose()
  clipped.dispose()
})

test('Springfield ground-floor wall cannot trim the first-floor gable roof above it', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/springfield_13.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roof = floors[1].roofs!.find((roof) => roof.id === '03233f9a-f497-49c7-ac08-cc12e288c142')!
  const support = { minX: -roof.supportWidth! / 2, maxX: roof.supportWidth! / 2, minY: -roof.supportDepth! / 2, maxY: roof.supportDepth! / 2 }
  const extents = { minX: support.minX - roof.overhangSideNegative!, maxX: support.maxX + roof.overhangSidePositive!, minY: support.minY - roof.overhangEnd!, maxY: support.maxY + roof.overhangEnd! }
  const heights = buildRoofProfileFaces(roof, extents, support).flatMap((face) => face.map(([, y]) => floors[1].elevation + floors[1].roomHeight + y))
  const lowerWall = floors[0].walls.find((wall) => wall.id === 'ad6be6e9-bee5-462e-afd3-bfa7ca58a686')!
  assert.equal(wallOverlapsRoofHeight({ wall: lowerWall, elevation: floors[0].elevation }, Math.min(...heights) - 0.04, Math.max(...heights)), false)
  assert.equal(wallOverlapsRoofHeight({ wall: lowerWall, elevation: floors[1].elevation }, Math.min(...heights) - 0.04, Math.max(...heights)), true)
})

test('roof and overhang stop at the facade across openings, above the ground-floor wall', () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([-0.4, 5, -3, 2, 5, -3, 2, 5, 3], 3))
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  geometry.setAttribute('uv', new Float32BufferAttribute([-0.4, -3, 2, -3, 2, 3], 2))
  const clipped = clipRoofGeometryAtAbuttingWalls(geometry, [{ wall, elevation: 0 }], (point) => point, { x: 2, y: 0 })
  const position = clipped.getAttribute('position')
  const uv = clipped.getAttribute('uv')
  assert.ok(position.count > 0)
  for (let i = 0; i < position.count; i++) {
    assert.ok(position.getX(i) >= 0.15 - 1e-7)
    assert.ok(Math.abs(uv.getX(i) - position.getX(i)) < 1e-7)
    assert.ok(Math.abs(uv.getY(i) - position.getZ(i)) < 1e-7)
  }
  assert.equal(Math.max(...Array.from({ length: position.count }, (_, i) => position.getX(i))), 2)
  geometry.dispose()
  clipped.dispose()
})

test('roof cuts use world coordinates for rotated roofs', () => {
  const planes = getRoofAbutmentPlanes([{ wall: { ...wall, start: { x: -1, y: 2 }, end: { x: 1, y: 2 } }, elevation: 0 }], { x: 0, y: 4 })
  assert.ok(planes[0]([0, 8, 2]) > 0)
  assert.ok(planes[0]([0, 8, 2.3]) < 0)
})

test('a roof can close behind the far wall face so the facade owns the junction', () => {
  const [plane] = getRoofAbutmentPlanes([{ wall, elevation: 0 }], { x: 2, y: 0 }, 'far')
  assert.ok(plane([-0.16, 5, 0]) > 0)
  assert.ok(plane([0, 5, 0]) < 0)
  assert.ok(plane([2, 5, 0]) < 0)
})

test('an embedded roof boundary sits just behind the visible facade', () => {
  const [near] = getRoofAbutmentPlanes([{ wall, elevation: 0 }], { x: 2, y: 0 })
  const [embedded] = getRoofAbutmentPlanes([{ wall, elevation: 0 }], { x: 2, y: 0 }, 'embedded')
  assert.ok(near([0.145, 5, 0]) > 0)
  assert.ok(embedded([0.145, 5, 0]) < 0)
  assert.ok(embedded([0.14, 5, 0]) > 0)
})

test('a wall behind the trimmed roof boundary keeps its geometry', () => {
  const crossing: Wall = { ...wall, id: 'crossing', start: { x: -1, y: 0 }, end: { x: 2, y: 0 } }
  const face: WallMeshFace = {
    faceId: 'crossing:side', wallId: crossing.id, kind: 'side', normal: [0, 0, 1],
    materialSource: { wallId: crossing.id }, pickSource: { wallId: crossing.id }, uvSource: { wallId: crossing.id },
    vertices: [
      { position: [-0.2, 0, 0], uv: [0, 0] }, { position: [0.14, 0, 0], uv: [1, 0] },
      { position: [0.14, 2.4, 0], uv: [1, 2.4] }, { position: [-0.2, 2.4, 0], uv: [0, 2.4] },
    ],
  }
  const options = createWallRoofClipOptions({ floorId: 'upper', floorElevation: 2.7, walls: [crossing], roofs: [{
    floorId: 'ground', supportPolygon: [{ x: 0, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 2 }, { x: 0, y: 2 }],
    undersideFaces: [[[-0.4, 3, -3], [3, 3, -3], [3, 3, 3], [-0.4, 3, 3]]],
    abutmentPlanes: getRoofAbutmentPlanes([{ wall, elevation: 0 }], { x: 2, y: 0 }),
  }] })
  assert.deepEqual(clipWallFacesToRoofUndersides([face], options), [face])
})
