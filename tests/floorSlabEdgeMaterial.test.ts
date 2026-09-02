import assert from 'node:assert/strict'
import test from 'node:test'

import { findFloorSlabSupportingWall } from '../src/floorSlabEdgeMaterial.ts'
import type { Wall } from '../src/types.ts'

const externalWall: Wall = {
  end: { x: 5, y: 2 },
  height: 2.4,
  id: 'external',
  kind: 'external',
  start: { x: 1, y: 2 },
  thickness: 0.3,
}

test('matches an outer slab edge to the supporting external wall side', () => {
  const match = findFloorSlabSupportingWall(
    { x: 1, y: 2.15 },
    { x: 5, y: 2.15 },
    [externalWall],
  )

  assert.equal(match?.wall.id, externalWall.id)
  assert.equal(match?.side, 1)
  assert.equal(match?.normalSign, 1)
  assert.equal(match?.uvStart, 1)
  assert.equal(match?.uvEnd, 5)
})

test('preserves reversed UV direction around the slab perimeter', () => {
  const match = findFloorSlabSupportingWall(
    { x: 5, y: 1.85 },
    { x: 1, y: 1.85 },
    [externalWall],
  )

  assert.equal(match?.side, -1)
  assert.equal(match?.normalSign, 1)
  assert.equal(match?.uvStart, 5)
  assert.equal(match?.uvEnd, 1)
})

test('matches a slab outline clipped to an external wall centre line', () => {
  const match = findFloorSlabSupportingWall(
    { x: 1, y: 2 },
    { x: 5, y: 2 },
    [externalWall],
  )

  assert.equal(match?.wall.id, externalWall.id)
})

test('does not inherit from internal or unrelated walls', () => {
  const internalWall: Wall = { ...externalWall, id: 'internal', kind: 'internal' }

  assert.equal(
    findFloorSlabSupportingWall(
      { x: 1, y: 2.15 },
      { x: 5, y: 2.15 },
      [internalWall],
    ),
    null,
  )
  assert.equal(
    findFloorSlabSupportingWall(
      { x: 1, y: 3 },
      { x: 5, y: 3 },
      [externalWall],
    ),
    null,
  )
})
