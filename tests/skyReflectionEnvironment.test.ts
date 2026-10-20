import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { DataUtils } from 'three'
import { createSkyReflectionEnvironment } from '../src/skyReflectionEnvironment.ts'

test('fallback sky has no fixed azimuthal lights and remains below the ambient radiance budget', () => {
  const texture = createSkyReflectionEnvironment()
  try {
    const { data, width, height } = texture.image
    for (let y = 0; y < height; y++) {
      const row = y * width * 4, radiance = data[row]
      assert.ok(radiance >= .04 && radiance <= .35)
      for (let x = 0; x < width; x++) {
        const i = row + x * 4
        assert.equal(data[i], radiance, 'rotating the sun cannot reveal a second, fixed lamp')
        assert.equal(data[i + 1], radiance)
        assert.equal(data[i + 2], radiance)
      }
    }
    assert.ok(data[0] < data[(height - 1) * width * 4], 'ground is darker than sky')
  } finally { texture.dispose() }
})

test('shipped sky PMREM contains finite, bounded radiance at every roughness', () => {
  const size = JSON.parse(readFileSync(new URL('../src/assets/environments/skyEnvironment.json', import.meta.url), 'utf8'))
  const bytes = gunzipSync(readFileSync(new URL('../src/assets/environments/skyEnvironment.bin.gz', import.meta.url)))
  assert.equal(bytes.byteLength, size.width * size.height * 8)
  const pixels = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  let peak = 0
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = DataUtils.fromHalfFloat(pixels[i + channel])
      assert.ok(Number.isFinite(value) && value >= 0 && value <= .351, 'no baked studio lamp highlights')
      peak = Math.max(peak, value)
    }
  }
  assert.ok(peak > .3, 'the asset must retain useful sky reflections')
})
