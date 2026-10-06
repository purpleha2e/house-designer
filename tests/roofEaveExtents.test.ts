import test from 'node:test'
import assert from 'node:assert/strict'
import { alignRoofEaveExtents } from '../src/roofEaveExtents.ts'
import { buildRoofProfileFaces } from '../src/roofProfile.ts'
import { roofJunctionInput, roofFaceHeight, roofToWorld } from '../src/roofJunctions.ts'
import type { RoofStructure } from '../src/types.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const make = (id: string, updates: Partial<RoofStructure> = {}) => roofJunctionInput({
  id, type: 'up-and-over', position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 },
  width: 4.4, depth: 6.4, supportWidth: 4, supportDepth: 6, rotation: 0,
  pitchDegrees: 45, overhangSide: 0.2, overhangEnd: 0.2, ...updates,
}, 'floor', 3)

test('chamfer and side tile edges meet without changing ridge, supports or any roof plane', () => {
  for (const end of [-1, 1]) {
    const field = end < 0 ? 'ridgeStartChamfer' : 'ridgeEndChamfer'
    const input = make('roof', { [field]: { angleDegrees: 30, distance: 2.16 / Math.tan(Math.PI / 6) } })
    const saved = JSON.stringify(input), [aligned] = alignRoofEaveExtents([input])
    assert.equal(JSON.stringify(input), saved)
    assert.deepEqual(aligned.support, input.support)
    const edge = end < 0 ? 'minY' : 'maxY'
    near(Math.abs(aligned.extents[edge] - input.extents[edge]), 0.04 / Math.tan(Math.PI / 6))
    const originalPlanes = buildRoofProfileFaces(input.roof, input.extents, input.support).map(f => roofFaceHeight(f)!)
    const faces = buildRoofProfileFaces(aligned.roof, aligned.extents, aligned.support)
    for (const face of faces) assert.ok(originalPlanes.some(height => face.every(([x, y, z]) => Math.abs(height({ x, y: z }) - y) < 1e-7)),
      'whole panels remain on their original planes, including their overhangs')
    near(Math.max(...faces.flat().map(p => p[1])), 2)
    const endVertices = faces.flat().filter(p => Math.abs(p[2] - aligned.extents[edge]) < 1e-7)
    assert.ok(endVertices.length > 0)
    endVertices.forEach(p => near(p[1], -0.2))
    assert.deepEqual(alignRoofEaveExtents([aligned]), [aligned])
  }
})

test('neighboring eaves align independently of input order and rotation', () => {
  for (const angle of [0, 0.7]) {
    const a = make('a', { rotation: angle })
    const offset = roofToWorld(a.roof, 0, [0, 0, 6.4])
    const b = make('b', { rotation: angle, pitchDegrees: 30,
      position: { x: offset[0], y: offset[2] }, supportPosition: { x: offset[0], y: offset[2] } })
    const aligned = alignRoofEaveExtents([a, b])
    assert.deepEqual(alignRoofEaveExtents([b, a]).reverse(), aligned)
    near(aligned[1].extents.minX, -2 - 0.2 / Math.tan(Math.PI / 6))
    near(aligned[1].extents.maxX, 2 + 0.2 / Math.tan(Math.PI / 6))
    assert.deepEqual(aligned[0].extents, a.extents)
  }
})

test('distant eaves, other floors, and excessive extensions stay authored', () => {
  const a = make('a')
  for (const b of [make('b', { position: { x: 0, y: 8 }, supportPosition: { x: 0, y: 8 }, pitchDegrees: 30 }),
    { ...make('b', { pitchDegrees: 30 }), floorId: 'other' }, make('b', { pitchDegrees: 1 })]) {
    assert.deepEqual(alignRoofEaveExtents([a, b]), [a, b])
  }
})
