import assert from 'node:assert/strict'
import test from 'node:test'
import { getWallDragDelta } from '../src/wallDragModifiers.ts'

test('Ctrl keeps fine movement on both axes without rounding', () => {
  assert.deepEqual(getWallDragDelta({ x: 0.137, y: -0.063 }, { ctrlKey: true, shiftKey: false }, 0.1), { x: 0.137, y: -0.063 })
})

test('Ctrl+Shift keeps sub-step motion while locking horizontal, vertical and all diagonals', () => {
  const modifiers = { ctrlKey: true, shiftKey: true }
  assert.deepEqual(getWallDragDelta({ x: 0.137, y: 0.012 }, modifiers, 0.1), { x: 0.137, y: 0 })
  assert.deepEqual(getWallDragDelta({ x: 0.012, y: 0.137 }, modifiers, 0.1), { x: 0, y: 0.137 })
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const delta = getWallDragDelta({ x: x * 0.137, y: y * 0.129 }, modifiers, 0.1)
    assert.ok(Math.abs(delta.x - x * 0.133) < 1e-12)
    assert.ok(Math.abs(delta.y - y * 0.133) < 1e-12)
  }
})

test('Shift also constrains stepped movement, and releasing it restores free movement', () => {
  assert.deepEqual(getWallDragDelta({ x: 0.137, y: 0.129 }, { ctrlKey: false, shiftKey: true }, 0.1), { x: 0.1, y: 0.1 })
  assert.deepEqual(getWallDragDelta({ x: 0.137, y: 0.063 }, { ctrlKey: false, shiftKey: false }, 0.1), { x: 0.1, y: 0.1 })
  assert.deepEqual(getWallDragDelta({ x: 0, y: 0 }, { ctrlKey: true, shiftKey: true }, 0.1), { x: 0, y: 0 })
})
