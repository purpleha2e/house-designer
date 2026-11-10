import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelPlanDrawing } from '../src/modelPlanDrawing.ts'

test('traces a white silhouette and a black internal seam into separate vector paths', () => {
  const size = 40, pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 4; y < 36; y++) for (let x = 4; x < 36; x++) {
    const offset = (y * size + x) * 4
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = y >= 18 && y <= 20 ? 0 : 255
    pixels[offset + 3] = 255
  }
  const drawing = createModelPlanDrawing(pixels, size, size)
  assert.equal(drawing.outlines.length, 1)
  assert.equal(drawing.outlines[0].length, 10, 'a rectangular outline simplifies to four corners and closure')
  assert.ok(drawing.lines.length > 0, 'the seam remains a stroked path rather than raster pixels')
  for (const path of [...drawing.outlines, ...drawing.lines]) {
    assert.ok(path.every(value => Number.isFinite(value) && value >= 0 && value <= 1))
  }
})

test('empty previews do not manufacture a rectangle around an object', () => {
  assert.deepEqual(createModelPlanDrawing(new Uint8ClampedArray(16 * 16 * 4), 16, 16), { outlines: [], lines: [] })
})
