import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { getFloorEnvelopeWalls } from '../src/floorEnvelope.ts'

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  kind: Wall['kind'],
): Wall {
  return {
    end: { x: end[0], y: end[1] },
    height: 2.4,
    id,
    kind,
    start: { x: start[0], y: start[1] },
    thickness: kind === 'external' ? 0.3 : 0.15,
  }
}

test('finds the geometric envelope even when one boundary wall is labelled internal', () => {
  const walls = [
    wall('bottom', [0, 0], [4, 0], 'external'),
    wall('right', [4, 0], [4, 4], 'external'),
    wall('top', [4, 4], [0, 4], 'internal'),
    wall('left', [0, 4], [0, 0], 'external'),
    wall('divider', [2, 0], [2, 4], 'internal'),
  ]

  assert.deepEqual(
    getFloorEnvelopeWalls(walls).map((entry) => entry.id).sort(),
    ['bottom', 'left', 'right', 'top'],
  )
})

test('falls back to explicitly external walls when there is no enclosed room', () => {
  const walls = [
    wall('external', [0, 0], [4, 0], 'external'),
    wall('internal', [0, 1], [4, 1], 'internal'),
  ]

  assert.deepEqual(
    getFloorEnvelopeWalls(walls).map((entry) => entry.id),
    ['external'],
  )
})
