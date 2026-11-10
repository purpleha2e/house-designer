import assert from 'node:assert/strict'
import test from 'node:test'
import { packExteriorSkyTexture } from '../src/exteriorSkyTexture.ts'
import type { ExteriorSkyField } from '../src/exteriorSkyOcclusion.ts'
import type { ExteriorEaveField } from '../src/exteriorEaveOcclusion.ts'

test('sky and fine roof fields share a sampler without exceeding the guaranteed texture depth', () => {
  const dimensions = [35, 25, 62], count = dimensions.reduce((a, b) => a * b, 1) * 4
  const field: ExteriorSkyField = { min: [0, 0, 0], size: [10, 8, 20], dimensions, cell: .35,
    positive: Uint8Array.from({ length: count }, (_, i) => i % 251),
    negative: Uint8Array.from({ length: count }, (_, i) => 255 - i % 251), rays: 0, ms: 0 }
  const eaves: ExteriorEaveField = { min: [0, 0], size: [20, 20], dimensions: [256, 256], layers: 8,
    heightMin: 2, heightRange: 5, data: Uint8Array.from({ length: 256 * 256 * 8 * 4 }, (_, i) => i % 239) }
  const packed = packExteriorSkyTexture(field, eaves)
  assert.ok(Math.max(packed.width, packed.height, packed.depth) <= 256)
  assert.ok(packed.data.length < (field.positive.length * 2 + eaves.data.length) * 2, 'padding remains bounded')
  for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < dimensions[1]; y++) {
    const source = (z * dimensions[1] + y) * dimensions[0] * 4
    const target = (z * packed.height + y) * packed.width * 4
    const negative = target + dimensions[2] * packed.width * packed.height * 4
    assert.deepEqual(packed.data.subarray(target, target + dimensions[0] * 4), field.positive.subarray(source, source + dimensions[0] * 4))
    assert.deepEqual(packed.data.subarray(negative, negative + dimensions[0] * 4), field.negative.subarray(source, source + dimensions[0] * 4))
  }
  const roofStart = dimensions[2] * 2 * packed.width * packed.height * 4
  assert.deepEqual(packed.data.subarray(roofStart, roofStart + eaves.data.length), eaves.data)
  const skyOnly = packExteriorSkyTexture(field, null)
  assert.deepEqual([skyOnly.width, skyOnly.height, skyOnly.depth], [35, 25, 124])
  assert.deepEqual(skyOnly.data.subarray(0, count), field.positive)
  assert.deepEqual(skyOnly.data.subarray(count), field.negative)
})
