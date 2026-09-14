import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoofCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { resolveRoofJunctions, roofJunctionInput } from '../src/roofJunctions.ts'
import type { RoofStructure } from '../src/types.ts'

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
