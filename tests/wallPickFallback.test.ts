import assert from 'node:assert/strict'
import test from 'node:test'
import { findClosestWallFace } from '../src/wallPickFallback.ts'
import type { Wall } from '../src/types.ts'

const wall = (id: string, start: [number, number], end: [number, number]): Wall => ({
  end: { x: end[0], y: end[1] }, height: 2.4, id, kind: 'external', openings: [],
  start: { x: start[0], y: start[1] }, thickness: 0.3,
})

test('resolves the nearest finite wall and its positive side', () => {
  const result = findClosestWallFace({ x: 4, y: 0.2 }, [
    wall('horizontal', [0, 0], [5, 0]),
    wall('remote', [10, 0], [10, 5]),
  ])
  assert.deepEqual(result, { side: 1, wallId: 'horizontal' })
})

test('resolves the opposite side of a wall', () => {
  assert.deepEqual(
    findClosestWallFace({ x: 2, y: -0.2 }, [wall('wall', [0, 0], [5, 0])]),
    { side: -1, wallId: 'wall' },
  )
})

test('uses distance to the finite segment rather than its infinite line', () => {
  const result = findClosestWallFace({ x: 6, y: 0.1 }, [
    wall('short', [0, 0], [1, 0]),
    wall('near-end', [5, 1], [6, 1]),
  ])
  assert.equal(result?.wallId, 'near-end')
})

test('returns null when there are no usable walls', () => {
  assert.equal(findClosestWallFace({ x: 0, y: 0 }, []), null)
})
