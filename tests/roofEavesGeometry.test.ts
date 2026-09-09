import assert from 'node:assert/strict'
import test from 'node:test'
import { createUpAndOverEavesGeometry } from '../src/roofEavesGeometry.ts'
import { getPitchedRoofHeightAtX, type RoofProfileVertex } from '../src/roofProfile.ts'
import type { RoofStructure } from '../src/types.ts'

const roof: RoofStructure = {
  id: 'roof', type: 'up-and-over', width: 7.3, depth: 9, pitchDegrees: 37,
  overhangPitchDegrees: 22, position: { x: 0, y: 0 }, rotation: 0,
}
const support = { minX: -3, maxX: 3, minY: -4, maxY: 4 }
const extents = { minX: -3.5, maxX: 3.8, minY: -4.5, maxY: 4.5 }
function face(minX: number, maxX: number, minZ = -4.5, maxZ = 4.5): RoofProfileVertex[] {
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map(([x, z]) => [x, getPitchedRoofHeightAtX(roof, support, x), z])
}

test('builds asymmetric eaves with soffits, fascias, end caps and wall-facing rear panels', () => {
  const geometry = createUpAndOverEavesGeometry(roof, support, extents,
    [face(-3.5, -3), face(-3, 0), face(0, 3), face(3, 3.8)], 0.04)!
  assert.ok(geometry)
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  let soffitArea = 0
  let fasciaArea = 0
  let rearArea = 0
  let endCapArea = 0
  for (let i = 0; i < positions.count; i += 3) {
    const xs = [0, 1, 2].map((n) => positions.getX(i + n))
    const ys = [0, 1, 2].map((n) => positions.getY(i + n))
    const zs = [0, 1, 2].map((n) => positions.getZ(i + n))
    assert.ok(xs.every((x) => x <= -3 + 0.00001) || xs.every((x) => x >= 3 - 0.00001))
    if (Math.max(...ys) - Math.min(...ys) < 0.00001) {
      assert.ok(normals.getY(i) < -0.99, 'soffit normals must face down for shadow bias')
      soffitArea += Math.abs((xs[1] - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (zs[1] - zs[0])) / 2
    }
    if (
      Math.max(...ys) - Math.min(...ys) > 0.00001 &&
      Math.max(...xs) - Math.min(...xs) > 0.00001
    ) {
      assert.ok(
        Math.max(...zs) - Math.min(...zs) < 0.00001,
        'end caps must lie on the ends of the roof run',
      )
      const ab = [xs[1] - xs[0], ys[1] - ys[0]]
      const ac = [xs[2] - xs[0], ys[2] - ys[0]]
      endCapArea += Math.abs(ab[0] * ac[1] - ab[1] * ac[0]) / 2
    }
    if (Math.max(...xs) - Math.min(...xs) < 0.00001) {
      const area = Math.abs((ys[1] - ys[0]) * (zs[2] - zs[0]) - (ys[2] - ys[0]) * (zs[1] - zs[0])) / 2
      const isRear = Math.abs(Math.abs(xs[0]) - 3.01) < 0.00001
      if (isRear) {
        assert.ok(normals.getX(i) * Math.sign(xs[0]) < -0.99, 'rear faces must point back toward the wall')
        rearArea += area
      } else {
        assert.ok(normals.getX(i) * Math.sign(xs[0]) > 0.99, 'fascia normals must face out for shadow bias')
        fasciaArea += area
      }
    }
  }
  assert.ok(Math.abs(soffitArea - 1.28 * 9) < 0.00001)
  assert.ok(Math.abs(fasciaArea - 2 * 9 * 0.16) < 0.00001)
  const expectedRearArea = 9 * (0.32 + 1.3 * Math.tan(22 * Math.PI / 180))
  assert.ok(Math.abs(rearArea - expectedRearArea) < 0.00001)
  assert.ok(endCapArea > 0, 'both eaves must have visible end-cap geometry')
  geometry.dispose()
})

test('no side overhang creates no soffit across the gable or interior', () => {
  assert.equal(createUpAndOverEavesGeometry(roof, support, { ...extents, minX: -3, maxX: 3 }, [face(-3, 0), face(0, 3)], 0.04), null)
})

test('eaves follow trimmed roof faces at an intersecting roof', () => {
  const geometry = createUpAndOverEavesGeometry(roof, support, extents, [face(-3.5, -3, 1, 4.5)], 0.04)!
  assert.ok(geometry)
  assert.equal(geometry.boundingBox!.min.z, 1)
  assert.ok(Math.abs(geometry.boundingBox!.max.x + 3.01) < 0.00001)
  geometry.dispose()
})
