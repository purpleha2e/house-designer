import assert from 'node:assert/strict'
import test from 'node:test'
import { getSpatialDragDelta, getTransformDragDelta, getTransformRotation } from '../src/transformModifiers.ts'
import { resizeObjectFromHandle } from '../src/objectHandles.ts'

test('Shift direction constraint is independent of Ctrl and optional tool step snapping', () => {
  const fine = { ctrlKey: true, shiftKey: true }
  assert.deepEqual(getTransformDragDelta({ x: 0.137, y: 0.123 }, fine, 0.1), { x: 0.13, y: 0.13 })
  assert.deepEqual(getTransformDragDelta({ x: 0.137, y: 0.123 }, { ...fine, ctrlKey: false }), { x: 0.13, y: 0.13 })
  assert.equal(getTransformDragDelta({ x: 0.137, y: 0.012 }, fine).y, 0)
})

test('3D axis and diagonal constraints work on all three gizmo planes without rounding fine movement', () => {
  const modifiers = { ctrlKey: true, shiftKey: true }
  assert.deepEqual(getSpatialDragDelta({ x: 0.137, y: 0.123, z: 0 }, modifiers), { x: 0.13, y: 0.13, z: 0 })
  assert.deepEqual(getSpatialDragDelta({ x: 0, y: 0.137, z: 0.123 }, modifiers), { x: 0, y: 0.13, z: 0.13 })
  assert.deepEqual(getSpatialDragDelta({ x: 0.137, y: 0, z: 0.123 }, modifiers), { x: 0.13, y: 0, z: 0.13 })
  const raw = { x: 0.137, y: 0.025, z: 0.018 }
  assert.deepEqual(getSpatialDragDelta(raw, { ctrlKey: true, shiftKey: false }), raw)
  assert.deepEqual(getSpatialDragDelta(raw, modifiers), { x: 0.137, y: 0, z: 0 })
})

test('Ctrl does not cancel the Shift rotation constraint', () => {
  const angle = Math.PI / 3
  assert.equal(getTransformRotation(angle, { ctrlKey: true, shiftKey: false }), angle)
  assert.equal(getTransformRotation(angle, { ctrlKey: false, shiftKey: true }), Math.PI / 4)
  assert.equal(getTransformRotation(angle, { ctrlKey: true, shiftKey: true }), Math.PI / 4)
})

test('proportional corner resize stays continuous and keeps the opposite anchor fixed', () => {
  const bounds = { minX: 0, maxX: 2, minZ: 0, maxZ: 1 }
  const result = resizeObjectFromHandle({ bounds, handle: { x: -1, z: -1 }, rotation: 0,
    scaleX: 1.3, scaleZ: 0.8, deltaX: -0.137, deltaZ: -0.052, keepRatio: true })
  assert.ok(Math.abs(result.scaleX / result.scaleZ - 1.3 / 0.8) < 1e-12)
  assert.ok(Math.abs(result.offsetX + 2 * result.scaleX - 2.6) < 1e-12)
  assert.ok(Math.abs(result.offsetZ + result.scaleZ - 0.8) < 1e-12)
  assert.ok(Math.abs(result.scaleX * 10 - Math.round(result.scaleX * 10)) > 0.001)
})
