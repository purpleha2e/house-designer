import assert from 'node:assert/strict'
import test from 'node:test'
import { getLocalLightLimits } from '../src/localLightBudget.ts'

test('a sixteen-texture GPU can illuminate the four bedrooms while retaining two shadow maps', () => {
  const limits = getLocalLightLimits(1024, 16)
  assert.ok(limits.lights >= 4)
  assert.equal(limits.shadows, 2)
})

test('direct lights respect uniform capacity independently of shadow textures', () => {
  assert.deepEqual(getLocalLightLimits(256, 16), { lights: 4, shadows: 2 })
  assert.deepEqual(getLocalLightLimits(512, 32), { lights: 8, shadows: 8 })
  assert.deepEqual(getLocalLightLimits(1024, 32), { lights: 11, shadows: 11 })
})
