import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cutRoofFacesAtDormerOpenings,
  type RoofVertex,
} from '../src/roofSolidGeometry.ts'

function projectedArea(faces: RoofVertex[][]) {
  return faces.reduce((total, face) => total + Math.abs(face.reduce((area, point, index) => {
    const next = face[(index + 1) % face.length]
    return area + point[0] * next[2] - point[2] * next[0]
  }, 0)) / 2, 0)
}

test('dormer footprints cut a real aperture through roof faces', () => {
  const roofFace: RoofVertex[] = [
    [-2, 0, -2],
    [2, 0, -2],
    [2, 0, 2],
    [-2, 0, 2],
  ]
  const cutFaces = cutRoofFacesAtDormerOpenings([roofFace], [[
    { x: -0.5, y: -1 },
    { x: 0.5, y: -1 },
    { x: 0.5, y: 1 },
    { x: -0.5, y: 1 },
  ]])

  assert.ok(cutFaces.length > 1)
  assert.ok(Math.abs(projectedArea(cutFaces) - 14) < 1e-8)
})
