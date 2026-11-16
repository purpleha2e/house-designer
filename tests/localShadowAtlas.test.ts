import assert from 'node:assert/strict'
import test from 'node:test'
import { BackSide, BoxGeometry, DoubleSide, FrontSide, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createLocalShadowAtlas, localShadowAtlasLayout, localShadowCamera, type AtlasLight } from '../src/localShadowAtlas.ts'
import { indirectGeometryRanges } from '../src/indirectVisibility.ts'

const point: AtlasLight = { id: 'point', kind: 'point', position: [2, 3, 4], target: [2, 2, 4], angle: Math.PI / 4, distance: 20 }
test('shadow snapshots match native caster sidedness while leaving GI ranges unchanged', () => {
  const material = new MeshStandardMaterial(), mesh = new Mesh(new BoxGeometry(), material)
  try {
    for (const [side, expected] of [[FrontSide, BackSide], [BackSide, FrontSide], [DoubleSide, DoubleSide]] as const) {
      material.side = side
      assert.ok(indirectGeometryRanges(mesh, true).every(range => range.shadowSide === expected))
      assert.ok(indirectGeometryRanges(mesh).every(range => !('shadowSide' in range)))
    }
    material.shadowSide = BackSide
    assert.ok(indirectGeometryRanges(mesh, true).every(range => range.shadowSide === BackSide), 'explicit caster overrides are retained')
  } finally { mesh.geometry.dispose(); material.dispose() }
})
test('every installed light gets persistent padded tiles within GPU dimensions and allocation budget', () => {
  for (const maximum of [2048, 4096, 8192, 16384]) for (const count of [1, 26, 128]) {
    const layout = localShadowAtlasLayout(count * 6, maximum)
    assert.ok(layout.width <= maximum && layout.height <= maximum)
    assert.ok(layout.width * layout.height <= 48 * 1024 * 1024)
    assert.ok(layout.columns * layout.rows >= count * 6)
    assert.equal(layout.pitch - layout.tile, 2)
  }
})
test('point face projections agree with the shader face selection on every axis', () => {
  const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
  for (let face = 0; face < 6; face++) {
    const camera = localShadowCamera(point, face)
    const projected = new Vector3().fromArray(point.position).add(new Vector3().fromArray(directions[face]).multiplyScalar(3)).project(camera)
    assert.ok(Math.abs(projected.x) < 1e-6 && Math.abs(projected.y) < 1e-6)
    assert.ok(projected.z > -1 && projected.z < 1)
  }
  const spot = localShadowCamera({ ...point, kind: 'spot' }, 0)
  assert.ok(new Vector3(2, 2, 4).project(spot).length() < 1)
})
test('mixed lamp atlas stores six point projections and one spot projection without overlapping tiles', () => {
  const atlas = createLocalShadowAtlas([point, { ...point, id: 'spot', kind: 'spot' }], 4096)
  try {
    assert.equal(atlas.faceCount, 7)
    const records = atlas.metadata.image.data as Float32Array
    const locations = new Set<string>()
    for (const row of [0,1,2,3,4,5,6]) {
      const tile = records.slice(row * 32 + 16, row * 32 + 20)
      assert.ok(tile[0] >= 0 && tile[1] >= 0 && tile[0] + tile[2] <= 1 && tile[1] + tile[3] <= 1)
      locations.add(`${tile[0]},${tile[1]}`)
    }
    assert.equal(locations.size, 7)
    assert.equal(atlas.completed, 0)
  } finally { atlas.dispose() }
})
