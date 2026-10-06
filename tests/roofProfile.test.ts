import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHipRoofProfileFaces, buildRoofProfileFaces, getHipRoofProfileHeight, getPitchedRoofHeightAtX, getPitchedRoofSurfaceDistance, getPitchedRoofBreaks, getGableChamferLimits } from '../src/roofProfile.ts'
import type { RoofStructure } from '../src/types.ts'

const roof: RoofStructure = {
  id: 'roof', type: 'up-and-over', width: 7, depth: 9, pitchDegrees: 37,
  position: { x: 0, y: 0 }, rotation: 0, overhangSide: 0.5, overhangEnd: 0.5,
}
const support = { minX: -3, maxX: 3, minY: -4, maxY: 4 }
const extents = { minX: -3.5, maxX: 3.5, minY: -4.5, maxY: 4.5 }
const slope = (degrees: number) => Math.tan(degrees * Math.PI / 180)
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`)

test('overhang follows pitch until overridden, and can be linked again', () => {
  close(getPitchedRoofHeightAtX(roof, support, -3.5), -0.5 * slope(37))
  close(getPitchedRoofHeightAtX({ ...roof, pitchDegrees: 45 }, support, -3.5), -0.5)
  close(getPitchedRoofHeightAtX({ ...roof, pitchDegrees: 45, overhangPitchDegrees: 22 }, support, -3.5), -0.5 * slope(22))
  close(getPitchedRoofHeightAtX({ ...roof, pitchDegrees: 45, overhangPitchDegrees: undefined }, support, -3.5), -0.5)
})

test('37 degree roof with 22 degree eaves preserves ridge and both wall junctions', () => {
  const adjusted = { ...roof, overhangPitchDegrees: 22 }
  close(getPitchedRoofHeightAtX(adjusted, support, 0), 3 * slope(37))
  for (const side of [-1, 1]) {
    close(getPitchedRoofHeightAtX(adjusted, support, 3 * side), 0)
    close(getPitchedRoofHeightAtX(adjusted, support, 3.5 * side), -0.5 * slope(22))
  }
  assert.deepEqual(getPitchedRoofBreaks(adjusted, support), [-3, 0, 3])
})

test('lean-to overhang slopes below the low wall and supports a horizontal overhang', () => {
  const adjusted: RoofStructure = { ...roof, type: 'lean-to', overhangPitchDegrees: 22 }
  close(getPitchedRoofHeightAtX(adjusted, support, -3.5), -0.5 * slope(22))
  close(getPitchedRoofHeightAtX(adjusted, support, 3), 6 * slope(37))
  close(getPitchedRoofHeightAtX({ ...adjusted, overhangPitchDegrees: 0 }, support, -3.5), 0)
})

test('tile distance remains continuous and uses the overhang slope outside the wall', () => {
  const adjusted = { ...roof, overhangPitchDegrees: 22 }
  const atWall = getPitchedRoofSurfaceDistance(adjusted, support, 3)
  close(atWall, 3 / Math.cos(37 * Math.PI / 180))
  close(getPitchedRoofSurfaceDistance(adjusted, support, 3.5) - atWall, 0.5 / Math.cos(22 * Math.PI / 180))
  close(getPitchedRoofSurfaceDistance(adjusted, support, -3.5), getPitchedRoofSurfaceDistance(adjusted, support, 3.5))
})

test('hip overhang changes all four eaves without moving the main ridge', () => {
  const adjusted: RoofStructure = { ...roof, type: 'hip', overhangPitchDegrees: 22 }
  close(getHipRoofProfileHeight(adjusted, extents, support, { x: 0, y: 0 }), 3.5 * slope(37))
  for (const point of [{ x: -3.5, y: 0 }, { x: 3.5, y: 0 }, { x: 0, y: -4.5 }, { x: 0, y: 4.5 }]) {
    close(getHipRoofProfileHeight(adjusted, extents, support, point), 0.5 * (slope(37) - slope(22)))
  }
})

test('hip profile polygons cover the footprint once, including flat and asymmetric eaves', () => {
  for (const angle of [0, 22, 37, 60]) {
    for (const bounds of [support, { ...support, minX: -3.2, maxY: 4.3 }]) {
      const adjusted: RoofStructure = { ...roof, type: 'hip', overhangPitchDegrees: angle }
      const faces = buildHipRoofProfileFaces(adjusted, extents, bounds)
      const area = faces.reduce((sum, face) => sum + Math.abs(face.reduce((a, p, i) => {
        const next = face[(i + 1) % face.length]
        return a + p[0] * next[2] - next[0] * p[2]
      }, 0)) / 2, 0)
      close(area, 63)
      for (const face of faces) for (const [x, y, z] of face) {
        close(y, getHipRoofProfileHeight(adjusted, extents, bounds, { x, y: z }))
      }
    }
  }
})

test('gable end chamfers replace the ridge ends with independently pitched planes', () => {
  const adjusted: RoofStructure = {
    ...roof,
    ridgeStartChamfer: { angleDegrees: 37, distance: 2 },
    ridgeEndChamfer: { angleDegrees: 22, distance: 1.5 },
  }
  const faces = buildRoofProfileFaces(adjusted, extents, support)
  const area = faces.reduce((sum, face) => sum + Math.abs(face.reduce((value, point, index) => {
    const next = face[(index + 1) % face.length]
    return value + point[0] * next[2] - next[0] * point[2]
  }, 0)) / 2, 0)
  close(area, 63)

  const ridgeHeight = 3 * slope(37)
  for (const face of faces) for (const [x, y, z] of face) {
    const mainHeight = getPitchedRoofHeightAtX(adjusted, support, x)
    const startHeight = z <= -2.5 ? ridgeHeight - (-2.5 - z) * slope(37) : Number.POSITIVE_INFINITY
    const endHeight = z >= 3 ? ridgeHeight - (z - 3) * slope(22) : Number.POSITIVE_INFINITY
    close(y, Math.min(mainHeight, startHeight, endHeight))
  }

  assert.ok(faces.some((face) => face.every(([, y, z]) =>
    z <= -2.5 + 0.000001 && Math.abs(y - (ridgeHeight - (-2.5 - z) * slope(37))) < 0.000001)))
  assert.ok(faces.some((face) => face.every(([, y, z]) =>
    z >= 3 - 0.000001 && Math.abs(y - (ridgeHeight - (z - 3) * slope(22))) < 0.000001)))
})

test('deep chamfers lower side eaves without changing their pitch or the authored setback', () => {
  for (const ridgeOffset of [-0.8, 0.8]) for (const angleDegrees of [15, 28, 60]) {
    const adjusted: RoofStructure = { ...roof, asymmetricSides: true, ridgeOffset,
      ridgeHeight: 1.8, pitchDegrees: 28, overhangPitchDegrees: 28,
      ridgeEndChamfer: { angleDegrees, distance: 8 } }
    const before = JSON.stringify(adjusted)
    const limits = getGableChamferLimits(adjusted, extents)
    close(limits.ridgeEndChamfer.distance, 8)
    close(limits.ridgeEndChamfer.maximum, 9)
    const faces = buildRoofProfileFaces(adjusted, extents, support)
    let loweredEnds = 0
    for (const x of [extents.minX, extents.maxX]) {
      const perimeter = faces.flat().filter(p => Math.abs(p[0] - x) < 1e-8)
      assert.ok(perimeter.length)
      for (const [, y, z] of perimeter) close(y, Math.min(getPitchedRoofHeightAtX(adjusted, support, x),
        z >= -3.5 ? 1.8 - (z + 3.5) * slope(angleDegrees) : Infinity))
      const end = perimeter.filter(p => Math.abs(p[2] - extents.maxY) < 1e-8)
      if (end.some(p => p[1] < getPitchedRoofHeightAtX(adjusted, support, x) - 1e-8)) loweredEnds++
    }
    assert.ok(loweredEnds > 0, 'a deep chamfer can descend below the higher side eave')
    assert.equal(JSON.stringify(adjusted), before)
  }
})

test('opposing chamfers can meet as a hip without crossing or lowering the ridge', () => {
  const shallow: RoofStructure = { ...roof, depth: 2,
    ridgeStartChamfer: { angleDegrees: 10, distance: 100 },
    ridgeEndChamfer: { angleDegrees: 10, distance: 100 } }
  const shortExtents = { ...extents, minY: -1, maxY: 1 }
  const limits = getGableChamferLimits(shallow, shortExtents)
  close(limits.ridgeStartChamfer.distance + limits.ridgeEndChamfer.distance, 2)
  const faces = buildRoofProfileFaces(shallow, shortExtents, support)
  close(Math.max(...faces.flat().map(p => p[1])), 3 * slope(37))
  close(faces.reduce((area, face) => area + Math.abs(face.reduce((sum, p, i) => {
    const q = face[(i + 1) % face.length]
    return sum + p[0] * q[2] - q[0] * p[2]
  }, 0)) / 2, 0), 14)
})
