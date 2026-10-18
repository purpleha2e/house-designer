import assert from 'node:assert/strict'
import test from 'node:test'
import { clipSkirtingAtOpenings } from '../src/skirtingOpenings.ts'
import { createLightPortalTexture } from '../src/roomLightPortals.ts'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
test('skirting stops across a wall-adjacent stair void and resumes beyond it', () => {
  const segments = clipSkirtingAtOpenings([{ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }], [rectangle(1, 0, 2, 2)], { x: 0, y: 1 })
  assert.equal(segments.length, 2)
  assert.deepEqual(segments.map(s => [s.start.x, s.end.x]), [[0, 1], [3, 5]])
  assert.equal(segments[0].chamferEnd, true); assert.equal(segments[1].chamferStart, true)
  assert.equal(clipSkirtingAtOpenings([{ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }], [rectangle(-1, 0, 7, 2)], { x: 0, y: 1 }).length, 0)
})
test('internal stair holes preserve unrelated skirting and adjacent cuts do not create tiny pieces', () => {
  const segment = { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }
  assert.deepEqual(clipSkirtingAtOpenings([segment], [rectangle(1, 1, 2, 2)], { x: 0, y: 1 }).map(s => [s.start.x, s.end.x]), [[0, 5]])
  assert.deepEqual(clipSkirtingAtOpenings([segment], [rectangle(1, 0, 1, 2), rectangle(2, 0, 1, 2)], { x: 0, y: 1 }).map(s => [s.start.x, s.end.x]), [[0, 1], [3, 5]])
})

test('a small wall-offset ledge beside a fitted stair void does not grow a skirting strip', () => {
  const segment = { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }
  assert.deepEqual(clipSkirtingAtOpenings([segment], [rectangle(1, .0235, 2, 2)], { x: 0, y: 1 }, .05)
    .map(s => [s.start.x, s.end.x]), [[0, 1], [3, 5]])
  assert.deepEqual(clipSkirtingAtOpenings([segment], [rectangle(1, .1, 2, 2)], { x: 0, y: 1 }, .05)
    .map(s => [s.start.x, s.end.x]), [[0, 5]])
})
test('light portal layers open stair voids while keeping the solid slab and sealed floors opaque', () => {
  const data = createLightPortalTexture([{ y: 2.7, openings: [rectangle(1, 1, 1, 2)] },
    { y: 2.9, openings: [rectangle(1, 1, 1, 2)] }, { y: 5.8, openings: [] }], { minX: 0, minZ: 0, size: 4 }, 64)
  try {
    const pixels = data.texture.image.data as Uint8Array
    const sample = (x: number, z: number, layer: number) => pixels[(layer * 64 + Math.floor(z * 16)) * 64 + Math.floor(x * 16)]
    assert.equal(data.count, 3); assert.ok(Math.abs(data.heights[0] - 2.7) < 1e-6)
    assert.equal(sample(1.5, 2, 0), 255); assert.equal(sample(1.5, 2, 1), 255)
    assert.equal(sample(.5, 2, 0), 0); assert.equal(sample(1.5, 2, 2), 0)
  } finally { data.dispose() }
})
