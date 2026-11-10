import test from 'node:test'
import assert from 'node:assert/strict'
import { DirectionalLight, PerspectiveCamera, OrthographicCamera, Vector3 } from 'three'
import { fitSunCascade } from '../src/sunCascades.ts'

for (const camera of [new PerspectiveCamera(60, 1.5, .1, 200), new OrthographicCamera(-3, 3, 2, -2, .1, 200)]) {
  test(`${camera.type}: cascade covers its camera slice and upstream casters`, () => {
    camera.position.set(2, 1.5, 8); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true)
    const sun = new DirectionalLight(), light = new DirectionalLight()
    sun.position.set(20, 30, -10); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true)
    sun.shadow.normalBias = .015; light.shadow.mapSize.set(2048, 2048)
    const { texel } = fitSunCascade(light, camera, sun, 4, 60)
    light.shadow.updateMatrices(light)
    for (const depth of [.1, 4]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const p = new Vector3(x, y, 0).applyMatrix4(camera.projectionMatrixInverse)
      if (camera instanceof PerspectiveCamera) p.multiplyScalar(depth / -p.z)
      else p.z = -depth
      p.applyMatrix4(camera.matrixWorld)
      for (const upstream of [0, 40]) {
        const caster = p.clone().addScaledVector(sun.position.clone().normalize(), upstream).applyMatrix4(light.shadow.matrix)
        for (const component of caster.toArray()) assert.ok(component > 0 && component < 1, `point inside cascade: ${caster.toArray()}`)
      }
    }
    assert.ok(texel < .005, 'nearby detail resolves to less than 5 mm')
    assert.ok(light.shadow.normalBias <= texel * .5, 'bias follows the finer texel size')
  })
}

test('near cascade has materially finer sampling than the whole-building map', () => {
  const camera = new PerspectiveCamera(60, 1.5, .1, 200), sun = new DirectionalLight(), light = new DirectionalLight()
  sun.position.set(10, 20, 10); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true)
  light.shadow.mapSize.set(2048, 2048)
  const near = fitSunCascade(light, camera, sun, 4, 60)
  const middle = fitSunCascade(light, camera, sun, 14, 60)
  assert.ok(near.texel < (36 / 2048) / 3.5, 'more than 3.5 times finer linear resolution nearby')
  assert.ok(middle.texel > near.texel * 3)
})
