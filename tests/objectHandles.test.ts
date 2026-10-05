import test from 'node:test'
import assert from 'node:assert/strict'
import { resizeObjectFromHandle } from '../src/objectHandles.ts'

const bounds = { minX: -1, maxX: 1, minZ: -2, maxZ: 2 }
const start = { bounds, rotation: 0, scaleX: 1, scaleZ: 1, deltaX: 0, deltaZ: 0 }
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)

test('midpoint resize extends one axis and keeps the opposite edge fixed', () => {
  const next = resizeObjectFromHandle({ ...start, handle: { x: 1, z: 0 }, deltaX: 2, deltaZ: 3 })
  assert.equal(next.scaleX, 2)
  assert.equal(next.scaleZ, 1)
  close(next.offsetX - next.scaleX, -1)
  close(next.offsetZ, 0)
})

test('diagonal resize keeps an off-centre imported corner fixed', () => {
  const next = resizeObjectFromHandle({ ...start,
    bounds: { minX: 1, maxX: 3, minZ: -4, maxZ: -1 },
    handle: { x: -1, z: 1 }, deltaX: -2, deltaZ: 3 })
  close(next.scaleX, 2)
  close(next.scaleZ, 2)
  close(next.offsetX + 3 * next.scaleX, 3)
  close(next.offsetZ - 4 * next.scaleZ, -4)
})

test('rotated midpoint resize follows local width', () => {
  const next = resizeObjectFromHandle({ ...start, rotation: Math.PI / 2,
    handle: { x: 1, z: 0 }, deltaZ: -2 })
  close(next.scaleX, 2)
  close(next.scaleZ, 1)
  close(next.offsetX, 0)
  close(next.offsetZ, -1)
})

test('dragging through the opposite edge clamps without flipping or moving the anchor', () => {
  const next = resizeObjectFromHandle({ ...start, handle: { x: -1, z: -1 }, deltaX: 20, deltaZ: 20 })
  close(next.scaleX, 0.2)
  close(next.scaleZ, 0.2)
  close(next.offsetX + next.scaleX, 1)
  close(next.offsetZ + 2 * next.scaleZ, 2)
})

test('continuous resize follows small pointer changes without moving the fixed corner', () => {
  const rotation = 0.63
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  for (let i = 0; i < 120; i++) {
    const deltaX = i / 1000, deltaZ = i / 2000
    const next = resizeObjectFromHandle({ ...start, rotation,
      handle: { x: 1, z: 1 }, deltaX, deltaZ })
    close(next.offsetX - cos * next.scaleX - sin * 2 * next.scaleZ, -cos - sin * 2)
    close(next.offsetZ + sin * next.scaleX - cos * 2 * next.scaleZ, sin - cos * 2)
    close(next.offsetX + cos * next.scaleX + sin * 2 * next.scaleZ, cos + sin * 2 + deltaX)
    close(next.offsetZ - sin * next.scaleX + cos * 2 * next.scaleZ, -sin + cos * 2 + deltaZ)
  }
})

test('optional stepped resizing still preserves the fixed edge', () => {
  const next = resizeObjectFromHandle({ ...start, handle: { x: 1, z: 0 }, deltaX: 0.17, scaleStep: 0.1 })
  close(next.scaleX, 1.1)
  close(next.offsetX - next.scaleX, -1)
  close(next.scaleZ, 1)
})
