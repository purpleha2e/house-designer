import assert from 'node:assert/strict'
import test from 'node:test'
import { isWallFragmentExposedAboveAdjacentRoof } from '../src/wallAdjoiningSurfaces.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'

const roofs = [{ roofId: 'vault', supportPolygon: [
  { x: 1.05, y: 1.65 }, { x: 5.9, y: 1.65 }, { x: 5.9, y: 7.75 }, { x: 1.05, y: 7.75 },
] }]

function face(x: number, z: number, normal: [number, number, number]): WallMeshFace {
  const tangent = [-normal[2], normal[0]]
  return {
    faceId: 'wall:roof-region:/vault:0:above', roofSurfaceRegion: 'roof-exposed', wallId: 'wall', kind: 'side', normal,
    materialSource: { wallId: 'wall', side: 1 }, pickSource: { wallId: 'wall', side: 1 }, uvSource: { wallId: 'wall', side: 1 },
    vertices: [[-0.1, 0], [0.1, 0], [0.1, 2.4], [-0.1, 2.4]].map(([t, y]) => ({
      position: [x + tangent[0] * t, y, z + tangent[1] * t], uv: [t, y],
    })) as WallMeshFace['vertices'],
  }
}

test('Red House window interior remains a room face where a junction extends beyond roof support', () => {
  const interior = face(0.37, 7.684, [0, 0, -1])
  assert.equal(isWallFragmentExposedAboveAdjacentRoof(interior, roofs), false)
  // The real exposed facade facing the vault still stays outside the room group.
  assert.equal(isWallFragmentExposedAboveAdjacentRoof(face(1.35, 6.4, [1, 0, 0]), roofs), true)
})

test('only the roof that generated the exposed partition can override room classification', () => {
  const exterior = face(1.35, 6.4, [1, 0, 0])
  assert.equal(isWallFragmentExposedAboveAdjacentRoof(exterior, [{ ...roofs[0], roofId: 'unrelated' }]), false)
  assert.equal(isWallFragmentExposedAboveAdjacentRoof({ ...exterior, roofSurfaceRegion: 'vault:below' }, roofs), false)
  assert.equal(isWallFragmentExposedAboveAdjacentRoof({ ...exterior, roomSignature: 'room' }, roofs), false)
  assert.equal(isWallFragmentExposedAboveAdjacentRoof({ ...exterior, faceId: 'wall:roof-region:/vault:0:after' }, roofs), false)
})

test('room classification uses the facing side of the wall, not just the wall centreline', () => {
  const supports = [{ roofId: 'vault', supportPolygon: [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 },
  ] }]
  assert.equal(isWallFragmentExposedAboveAdjacentRoof(face(0, 1.5, [1, 0, 0]), supports), true)
  assert.equal(isWallFragmentExposedAboveAdjacentRoof(face(0, 1.5, [-1, 0, 0]), supports), false)
})
