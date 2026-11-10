import assert from 'node:assert/strict'
import test from 'node:test'
import { SphericalHarmonics3, Vector3 } from 'three'
import { evaluateIndirectSHOrder, indirectSHIrradianceBasis, indirectSHRadianceBasis, supportedIndirectSHOrder } from '../src/indirectSH.ts'

test('experimental L2 falls back without resizing or extra display samplers', () => {
  assert.equal(supportedIndirectSHOrder(1, 2, 2048, true), 1)
  assert.equal(supportedIndirectSHOrder(2, 2, 256), 2)
  assert.equal(supportedIndirectSHOrder(2, 2, 256, true), 1)
  assert.equal(supportedIndirectSHOrder(2, 2, 512, true), 2)
  assert.equal(supportedIndirectSHOrder(2, 3, 256), 1)
})

test('L1 remains bit-identical when the experimental second band is absent', () => {
  const sh = new SphericalHarmonics3()
  sh.coefficients.forEach((c, i) => c.set(.2 + i * .13, .4 - i * .04, .3 + i * .02))
  const normal = new Vector3(.4, .8, -.2).normalize()
  const expected = sh.coefficients[0].clone().multiplyScalar(.886227)
    .addScaledVector(sh.coefficients[1], 1.023328 * normal.y)
    .addScaledVector(sh.coefficients[2], 1.023328 * normal.z)
    .addScaledVector(sh.coefficients[3], 1.023328 * normal.x).max(new Vector3())
  assert.deepEqual(evaluateIndirectSHOrder(sh, normal, 1), expected)
  sh.coefficients.slice(4).forEach(c => c.set(0, 0, 0))
  assert.deepEqual(evaluateIndirectSHOrder(sh, normal, 2), expected)
})

test('second-order radiance basis is orthonormal and cosine convolution matches Three', () => {
  const samples = 32768, gram = new Float64Array(81), sh = new SphericalHarmonics3()
  sh.coefficients.forEach((c, i) => c.set(.5 + Math.sin(i) * .12, .4 + Math.cos(i) * .1, .6 - i * .02))
  for (let i = 0; i < samples; i++) {
    const z = 1 - 2 * (i + .5) / samples, phi = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1 - z * z)
    const n = new Vector3(r * Math.cos(phi), r * Math.sin(phi), z), basis = indirectSHRadianceBasis(n, 2)
    for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) gram[a * 9 + b] += basis[a] * basis[b] * 4 * Math.PI / samples
    if (i % 1024 === 0) {
      const expected = sh.getIrradianceAt(n, new Vector3()).max(new Vector3())
      assert.ok(evaluateIndirectSHOrder(sh, n, 2).distanceTo(expected) < 3e-6)
      const irradiance = indirectSHIrradianceBasis(n, 2)
      for (let k = 4; k < 9; k++) assert.ok(Math.abs(irradiance[k] - basis[k] * Math.PI / 4) < 1e-14)
    }
  }
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) assert.ok(Math.abs(gram[a * 9 + b] - (a === b ? 1 : 0)) < 2e-5)
})
