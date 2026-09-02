import assert from 'node:assert/strict'
import test from 'node:test'
import { subtractPlanCutouts } from '../src/planarCutouts.ts'

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
]

test('subtracting an enclosed stair opening creates a floor footprint hole', () => {
  const result = subtractPlanCutouts(square, [
    [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ],
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].holes.length, 1)
})

test('a stair opening crossing a slab edge clips the slab outline cleanly', () => {
  const result = subtractPlanCutouts(square, [
    [
      { x: 3, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 3 },
      { x: 3, y: 3 },
    ],
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].holes.length, 0)
  assert.ok(result[0].outline.some((point) => point.x === 3 && point.y === 1))
})
