import assert from 'node:assert/strict'
import test from 'node:test'
import { filterIsolatedFireflies, flipImageRows } from '../src/lightingLab/houseDenoisePixels.ts'

test('WebGL/OIDN row conversion preserves HDR values, channels and the source', () => {
  const source = Float32Array.from([1,2,3,1, 4,5,6,1, 7,8,9,1, 10,11,12,1])
  const before = source.slice(), converted = flipImageRows(source, 2, 2)
  assert.deepEqual(converted, Float32Array.from([7,8,9,1, 10,11,12,1, 1,2,3,1, 4,5,6,1]))
  assert.deepEqual(flipImageRows(converted, 2, 2), source)
  assert.deepEqual(source, before)
  assert.throws(() => flipImageRows(source, 3, 2), /dimensions/)
})

test('isolated HDR spikes are filtered without changing the raw reference, bright regions or surface boundaries', () => {
  const width = 7, height = 7, colour = new Float32Array(width * height * 4), albedo = colour.slice(), normal = colour.slice()
  for (let i = 0; i < colour.length; i += 4) {
    colour.set([.2, .3, .4, 1], i); albedo.set([.6, .6, .6, 1], i); normal.set([.5, .5, 1, 1], i)
  }
  const centre = (3 * width + 3) * 4
  colour.set([1000000, 1000000, 1000000, 1], centre)
  const raw = colour.slice(), filtered = filterIsolatedFireflies(colour, albedo, normal, width, height)
  assert.equal(filtered.changedPixels, 1)
  assert.deepEqual(filtered.values.slice(centre, centre + 4), Float32Array.from([.2, .3, .4, 1]))
  assert.deepEqual(colour, raw)
  // A different surface at the bright pixel must not borrow its neighbours.
  normal.set([1, .5, .5, 1], centre)
  assert.equal(filterIsolatedFireflies(colour, albedo, normal, width, height).changedPixels, 0)
  // Contiguous high HDR energy (e.g. an emitter) is not globally clamped.
  for (let i = 0; i < colour.length; i += 4) colour.set([1000, 1000, 1000, 1], i)
  assert.deepEqual(filterIsolatedFireflies(colour, albedo, normal, width, height).values, colour)
})
