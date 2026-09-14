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

test('a merged cutout preserves its enclosed uncut region', () => {
  const outer = [
    { x: 0, y: 0 }, { x: 10, y: 0 },
    { x: 10, y: 10 }, { x: 0, y: 10 },
  ]
  const result = subtractPlanCutouts(outer, [{
    outline: [
      { x: 2, y: 2 }, { x: 8, y: 2 },
      { x: 8, y: 8 }, { x: 2, y: 8 },
    ],
    holes: [[
      { x: 4, y: 4 }, { x: 6, y: 4 },
      { x: 6, y: 6 }, { x: 4, y: 6 },
    ]],
  }])
  const ringArea = (ring: typeof outer) => Math.abs(ring.reduce(
    (area, point, index) => {
      const next = ring[(index + 1) % ring.length]
      return area + point.x * next.y - next.x * point.y
    },
    0,
  )) / 2
  const resultArea = result.reduce(
    (area, footprint) => area + ringArea(footprint.outline) -
      footprint.holes.reduce((holeArea, hole) => holeArea + ringArea(hole), 0),
    0,
  )

  assert.equal(result.length, 2)
  assert.equal(resultArea, 68)
})
