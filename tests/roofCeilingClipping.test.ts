import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoofCeilingCutouts, getRoomCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { resolveRoofJunctions, roofJunctionInput } from '../src/roofJunctions.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'

test('a lower roof consumed by a passive enclosure cannot cut the room ceiling', () => {
  const polygon = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
  const base: RoofStructure = { id: 'low', type: 'flat', width: 6, depth: 6, position: { x: 0, y: 0 },
    rotation: 0, pitchDegrees: 0, heightOffset: -.3 }
  const floor: FloorLevel = { id: 'room', name: 'Room', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    models: [], rooms: [], roofs: [base, { ...base, id: 'enclosure', heightOffset: 1, clipsGeometry: false }],
    walls: polygon.map((start, i) => ({ id: `w${i}`, start, end: polygon[(i + 1) % 4],
      kind: 'external', thickness: .2, height: 2.4 })) }
  const roofs = resolveBuildingRoofs([floor])
  assert.ok(getRoofCeilingCutouts(roofs.map(roof => roof.resolved), 2.38, floor.id).length,
    'a roof-only cutout leaves a hole for the discarded low roof')
  const volumes = buildBuildingRoomVolumes([floor], roofs)
  assert.deepEqual(getRoomCeilingCutouts(volumes.cuts, floor.id, 2.38), [],
    'the higher room enclosure keeps the horizontal ceiling complete')
})

test('cuts a horizontal upstairs ceiling where it rises through a lower gable roof', () => {
  const roof: RoofStructure = {
    id: 'ground-roof',
    type: 'up-and-over',
    position: { x: 0, y: 0 },
    supportPosition: { x: 0, y: 0 },
    width: 4,
    depth: 6,
    supportWidth: 4,
    supportDepth: 6,
    pitchDegrees: 45,
    rotation: 0,
  }
  const resolved = resolveRoofJunctions([
    roofJunctionInput(roof, 'ground', 2.4),
  ])
  const cutouts = getRoofCeilingCutouts(resolved, 3.4)

  assert.equal(cutouts.length, 2)
  assert.ok(cutouts.some(({ outline }) =>
    Math.max(...outline.map(({ x }) => x)) > 1.9))
  assert.ok(cutouts.some(({ outline }) =>
    Math.min(...outline.map(({ x }) => x)) < -1.9))
  assert.ok(cutouts.every(({ outline }) =>
    outline.every(({ x }) => Math.abs(x) >= 0.95 - 1e-7)))
})

test('does not cut a ceiling that remains below the roof underside', () => {
  const roof: RoofStructure = {
    id: 'roof', type: 'flat', position: { x: 0, y: 0 },
    width: 4, depth: 4, pitchDegrees: 0, rotation: 0,
  }
  const resolved = resolveRoofJunctions([
    roofJunctionInput(roof, 'upper', 5),
  ])
  assert.deepEqual(getRoofCeilingCutouts(resolved, 4.9), [])
})

test('clips a slab at the roof shell through an exposed overhang', () => {
  const roof: RoofStructure = {
    id: 'roof', type: 'flat', position: { x: 0, y: 0 },
    supportPosition: { x: 0, y: 0 }, supportWidth: 4, supportDepth: 4,
    width: 5, depth: 5, overhangSide: 0.5, overhangEnd: 0.5,
    pitchDegrees: 0, rotation: 0,
  }
  const resolved = resolveRoofJunctions([roofJunctionInput(roof, 'ground', 5)])
  const cutouts = getRoofCeilingCutouts(resolved, 5.02)
  assert.ok(cutouts.some(({ outline }) =>
    Math.max(...outline.map(({ x }) => x)) > 2.49))
  assert.ok(cutouts.some(({ outline }) =>
    Math.max(...outline.map(({ y }) => y)) > 2.49))
})

test('a hidden lower panel does not cut the slab beneath a winning roof', () => {
  const lower: RoofStructure = {
    id: 'lower', type: 'flat', position: { x: 0, y: 0 },
    width: 4, depth: 4, pitchDegrees: 0, rotation: 0,
  }
  const upper: RoofStructure = {
    id: 'upper', type: 'flat', position: { x: 0, y: 0 },
    width: 4, depth: 4, pitchDegrees: 0, rotation: 0,
  }
  const resolved = resolveRoofJunctions([
    roofJunctionInput(lower, 'ground', 2.5),
    roofJunctionInput(upper, 'upper', 5),
  ])

  assert.equal(resolved[0].faces.length, 0)
  const cutouts = getRoofCeilingCutouts(resolved, 2.7)
  assert.deepEqual(cutouts, [])

  // The lower roof still cuts outside the receiving building.
  upper.width = 2
  const partlyHidden = resolveRoofJunctions([
    roofJunctionInput(lower, 'ground', 2.5), roofJunctionInput(upper, 'upper', 5),
  ])
  const remaining = getRoofCeilingCutouts(partlyHidden, 2.7)
  assert.equal(remaining.length, 2)
  assert.ok(remaining.every(({ outline }) => outline.every(({ x }) => Math.abs(x) >= 1 - 1e-7)))
})
