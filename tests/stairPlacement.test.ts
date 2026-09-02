import assert from 'node:assert/strict'
import test from 'node:test'
import { snapStairApertureToWalls } from '../src/stairPlacement.ts'
import type { Wall } from '../src/types.ts'

const horizontalWall: Wall = {
  end: { x: 8, y: 0 },
  height: 2.4,
  id: 'wall',
  kind: 'external',
  start: { x: 0, y: 0 },
  thickness: 0.3,
}

function snap(position: { x: number; y: number }, walls = [horizontalWall]) {
  return snapStairApertureToWalls({
    depth: 1,
    position,
    rotation: 0,
    scale: 1,
    walls,
    width: 1,
  })
}

test('snaps a stair aperture edge to a nearby wall face', () => {
  const result = snap({ x: 3, y: 0.8 })

  assert.ok(result)
  assert.equal(result.wallId, 'wall')
  assert.ok(Math.abs(result.position.y - 0.65) < 0.000001)
})

test('does not snap across a gap larger than 20cm', () => {
  assert.equal(snap({ x: 3, y: 0.86 }), null)
})

test('pushes an overlapping aperture out to the nearest wall face', () => {
  const result = snap({ x: 3, y: 0.4 })

  assert.ok(result)
  assert.ok(Math.abs(result.position.y - 0.65) < 0.000001)
})

test('ignores walls outside the longitudinal extent of the aperture', () => {
  assert.equal(snap({ x: 10, y: 0.4 }), null)
})

test('can snap against a wall supplied by an adjoining floor', () => {
  const upperWall = {
    ...horizontalWall,
    id: 'upper-wall',
  }
  const result = snap({ x: 3, y: 0.8 }, [upperWall])

  assert.equal(result?.wallId, 'upper-wall')
})

test('snaps using offset local bounds instead of a centred footprint', () => {
  const result = snapStairApertureToWalls({
    depth: 1,
    localBounds: { minX: -0.5, maxX: 0.5, minZ: 0, maxZ: 1 },
    position: { x: 3, y: 0.3 },
    rotation: 0,
    scale: 1,
    walls: [horizontalWall],
    width: 1,
  })

  assert.ok(result)
  assert.ok(Math.abs(result.position.y - 0.15) < 0.000001)
})
