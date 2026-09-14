import assert from 'node:assert/strict'
import test from 'node:test'

import {
  alignFloorSlabFootprintToWallFaces,
  findFloorSlabMaterialSupport,
  findFloorSlabSupportingWall,
} from '../src/floorSlabEdgeMaterial.ts'
import type { Wall } from '../src/types.ts'

const externalWall: Wall = {
  end: { x: 5, y: 2 },
  height: 2.4,
  id: 'external',
  kind: 'external',
  start: { x: 1, y: 2 },
  thickness: 0.3,
}

test('a roof-junction slab inherits the upper facade when the lower wall has no finish', () => {
  // red_house_3: the short Bay wall is found first, although the slab follows
  // the long first-floor wall. Its unpainted side must not hide the brickwork.
  const lower = findFloorSlabSupportingWall(
    { x: 1.35, y: 6.915833 }, { x: 1.35, y: 7.984318 },
    [{ ...externalWall, id: 'bay', start: { x: 1.2, y: 7.865833333333334 },
      end: { x: 1.2, y: 8.541530571415715 } }],
  )
  const upper = findFloorSlabSupportingWall(
    { x: 1.35, y: 6.915833 }, { x: 1.35, y: 7.984318 },
    [{ ...externalWall, id: 'gable', start: { x: 1.2, y: 0.9931305714157143 },
      end: { x: 1.2, y: 7.834318178330288 } }],
  )
  assert.ok(lower)
  assert.ok(upper)
  const result = findFloorSlabMaterialSupport(lower, upper,
    ({ wall, side }) => wall.id === 'gable' && side === -1 ? 'brick' : undefined)
  assert.equal(result.material, 'brick')
  assert.equal(result.support, upper)
  assert.equal(result.support.uvStart, upper.uvStart)
  assert.equal(result.support.uvEnd, upper.uvEnd)
})

test('keeps an assigned lower facade finish ahead of the upper fallback', () => {
  const lower = findFloorSlabSupportingWall(
    { x: 1, y: 2.15 }, { x: 5, y: 2.15 }, [externalWall],
  )!
  const upper = { ...lower, wall: { ...externalWall, id: 'upper' } }
  const result = findFloorSlabMaterialSupport(lower, upper,
    ({ wall }) => wall.id === 'upper' ? 'brick' : 'stone')
  assert.equal(result.material, 'stone')
  assert.equal(result.support, lower)
  assert.deepEqual(findFloorSlabMaterialSupport(lower, upper, () => undefined),
    { support: lower, material: undefined })
  assert.deepEqual(findFloorSlabMaterialSupport(null, null, () => undefined),
    { support: null, material: undefined })
})

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

test('matches a slab edge even when the midpoint spans a break in the wall run', () => {
  const firstWall: Wall = {
    ...externalWall,
    end: { x: 4, y: 2 },
    id: 'external-left',
    start: { x: 0, y: 2 },
  }
  const secondWall: Wall = {
    ...externalWall,
    end: { x: 10, y: 2 },
    id: 'external-right',
    start: { x: 6, y: 2 },
  }

  const match = findFloorSlabSupportingWall(
    { x: 0, y: 2.15 },
    { x: 10, y: 2.15 },
    [firstWall, secondWall],
  )

  assert.ok(match)
  assert.ok(['external-left', 'external-right'].includes(match.wall.id))
  assert.equal(match.side, 1)
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

test('aligns a centre-line slab loop to the exterior wall faces', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]
  const walls: Wall[] = points.map((start, index) => ({
    end: points[(index + 1) % points.length],
    height: 2.4,
    id: `wall-${index}`,
    kind: 'external',
    start,
    thickness: 0.3,
  }))

  assert.deepEqual(alignFloorSlabFootprintToWallFaces(points, walls), [
    { x: -0.15, y: -0.15 },
    { x: 4.15, y: -0.15 },
    { x: 4.15, y: 3.15 },
    { x: -0.15, y: 3.15 },
  ])
})

test('keeps an already aligned exterior slab loop on the wall faces', () => {
  const wallPoints = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]
  const walls: Wall[] = wallPoints.map((start, index) => ({
    end: wallPoints[(index + 1) % wallPoints.length],
    height: 2.4,
    id: `wall-${index}`,
    kind: 'external',
    start,
    thickness: 0.3,
  }))
  const exterior = [
    { x: -0.15, y: -0.15 },
    { x: 4.15, y: -0.15 },
    { x: 4.15, y: 3.15 },
    { x: -0.15, y: 3.15 },
  ]

  assert.deepEqual(alignFloorSlabFootprintToWallFaces(exterior, walls), exterior)
})
