import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPitchedRoofTopUvs,
  getRoofFaceProjectedUvs,
} from '../src/roofUv.ts'
import type { RoofStructure } from '../src/types.ts'

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`)

test('roof face UV projection preserves dimensions in metres across triangles', () => {
  const vertices: Array<[number, number, number]> = [
    [0, 0, 0], [8, 0, 0], [8, 3, 4], [0, 3, 4],
  ]
  const uvs = getRoofFaceProjectedUvs(vertices)
  close(Math.abs(uvs[1][0] - uvs[0][0]), 8)
  close(Math.abs(uvs[3][1] - uvs[0][1]), 5)
  assert.deepEqual(uvs[0], getRoofFaceProjectedUvs(vertices)[0], 'projection is stable')
})

test('pitched roof UVs keep tile courses continuous and metre-scaled to the ridge', () => {
  const roof: RoofStructure = {
    id: 'roof', type: 'up-and-over', width: 6, depth: 8,
    pitchDegrees: 45, position: { x: 0, y: 0 }, rotation: 0,
  }
  const support = { minX: -3, maxX: 3, minY: -4, maxY: 4 }
  const vertices: Array<[number, number, number]> = [
    [-3, 0, -4], [0, 3, -4], [0, 3, 4], [-3, 0, 4],
  ]
  const uvs = getPitchedRoofTopUvs(roof, support, vertices)
  close(Math.abs(uvs[3][0] - uvs[0][0]), 8)
  close(Math.abs(uvs[1][1] - uvs[0][1]), 3 * Math.SQRT2)
  close(uvs[1][1], uvs[2][1])
})
