import assert from 'node:assert/strict'
import test from 'node:test'
import { getRulerPoint } from '../src/planRuler.ts'

test('free measurements retain arbitrary direction and snap independently to both wall faces', () => {
  const faces = [-.15, .15].map(y => ({ start: { x: 0, y }, end: { x: 5, y } }))
  assert.deepEqual(getRulerPoint({ x: 1.123, y: 2.456 }, faces, .1).point, { x: 1.123, y: 2.456 })
  for (const y of [-.15, .15]) {
    const result = getRulerPoint({ x: 2, y: y + .03 }, faces, .1)
    assert.deepEqual(result, { point: { x: 2, y }, snapped: true })
  }
  assert.equal(getRulerPoint({ x: 2, y: .24 }, faces, .05).snapped, false, 'zoom-scaled tolerance prevents distant snaps')
})

test('Ctrl locks all eight directions without a grid or length quantization', () => {
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, offset = angle + .12, origin = { x: 1.3, y: -2.7 }
    const result = getRulerPoint({ x: origin.x + 3 * Math.cos(offset), y: origin.y + 3 * Math.sin(offset) }, [], .1, origin, true)
    const dx = result.point.x - origin.x, dy = result.point.y - origin.y
    assert.ok(Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) < 1e-10)
    assert.ok(Math.abs(Math.hypot(dx, dy) - 3 * Math.cos(.12)) < 1e-10)
  }
})

test('constrained wall snaps intersect the locked ray, including diagonal and parallel faces', () => {
  const origin = { x: 0, y: 0 }, wall = [{ start: { x: 2, y: -1 }, end: { x: 2, y: 4 } }]
  for (const pointer of [{ x: 2.02, y: .1 }, { x: 2.02, y: 1.98 }]) {
    const result = getRulerPoint(pointer, wall, .1, origin, true)
    assert.equal(result.snapped, true)
    assert.ok(Math.abs(result.point.x - 2) < 1e-10)
    assert.ok(Math.abs(result.point.y - (pointer.y > 1 ? 2 : 0)) < 1e-10)
  }
  const parallel = [{ start: { x: 1, y: .04 }, end: { x: 3, y: .04 } }]
  assert.deepEqual(getRulerPoint({ x: 2, y: .04 }, parallel, .1, origin, true), { point: { x: 2, y: 0 }, snapped: false })
  assert.equal(getRulerPoint({ x: 2, y: .04 }, [{ start: { x: 1, y: 0 }, end: { x: 3, y: 0 } }], .1, origin, true).snapped, true)
})
