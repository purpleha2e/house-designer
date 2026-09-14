import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoofThickness } from '../src/roofThickness.ts'
import { getRoofCoverageUndersideFaces, resolveRoofJunctions, roofJunctionInput, roofSurfaceHeights, resolvedRoofWallSegments } from '../src/roofJunctions.ts'
import { getRoofCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'

const roofFor = (type: RoofStructure['type'], thickness?: number): RoofStructure => ({
  id: type, type, thickness, width: 4, depth: 4, supportWidth: 4, supportDepth: 4,
  position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 }, rotation: 0, pitchDegrees: 35, overhangSide: 0.3, overhangEnd: 0.3,
})
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('all roof types save thickness, preserve their top surface, and move their undersides', () => {
  for (const type of ['flat', 'hip', 'lean-to', 'up-and-over', 'bay'] as const) {
    const original = roofFor(type)
    const thick = roofFor(type, 0.24)
    const floor: FloorLevel = { id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4, slabThickness: 0.2,
      walls: [], rooms: [], models: [], roofs: [thick] }
    const loaded = normalizeFloor(JSON.parse(JSON.stringify(floor)), new Map()).roofs![0]
    close(getRoofThickness(loaded), 0.24)
    const [before] = resolveRoofJunctions([roofJunctionInput(original, 'floor', 2.4)])
    const [after] = resolveRoofJunctions([roofJunctionInput(loaded, 'floor', 2.4)])
    assert.deepEqual(after.faces, before.faces)
    const lower = getRoofCoverageUndersideFaces(after), previous = getRoofCoverageUndersideFaces(before)
    lower.forEach((face, i) => face.forEach((p, j) => close(previous[i][j][1] - p[1], 0.2)))
  }
})

test('legacy and malformed thickness values have safe defaults and bounds', () => {
  close(getRoofThickness({}), 0.04)
  close(getRoofThickness({ thickness: NaN }), 0.04)
  close(getRoofThickness({ thickness: Infinity }), 0.04)
  close(getRoofThickness({ thickness: -3 }), 0.01)
  close(getRoofThickness({ thickness: 8 }), 1)
})

test('ceiling and wall infill meet the chosen underside', () => {
  const thin = roofFor('flat', 0.04), thick = roofFor('flat', 0.24)
  const [a] = resolveRoofJunctions([roofJunctionInput(thin, 'floor', 2.4)])
  const [b] = resolveRoofJunctions([roofJunctionInput(thick, 'floor', 2.4)])
  assert.equal(getRoofCeilingCutouts([a], 2.3).length, 0)
  assert.ok(getRoofCeilingCutouts([b], 2.3).length > 0)
  const segments = resolvedRoofWallSegments(b.faces, { x: -1, y: 0 }, { x: 1, y: 0 }, 0, getRoofThickness(thick))
  segments.flat().forEach(point => close(point.topY, 2.4 - 0.24 + 0.005))
})

test('overlapping coverage keeps the thickness of the roof that owns each panel', () => {
  const low = roofFor('flat', 0.04)
  const high = { ...roofFor('flat', 0.24), id: 'high', heightOffset: 0.5, position: { x: 1, y: 0 }, supportPosition: { x: 1, y: 0 } }
  const result = resolveRoofJunctions([roofJunctionInput(low, 'floor', 2.4), roofJunctionInput(high, 'upper', 2.4)])
  const lowCoverage = result.find(r => r.roof.id === low.id)!
  const underside = roofSurfaceHeights(getRoofCoverageUndersideFaces(lowCoverage), { x: 0.5, y: 0 })
  assert.ok(underside.length > 0)
  underside.forEach(y => close(y, 2.9 - 0.24))
})
