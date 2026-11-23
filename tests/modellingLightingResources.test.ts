import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, PointLight, Scene, SpotLight, Vector3 } from 'three'
import { fastGICaptureLightSlots } from '../src/fastGI.ts'
import { configureFastGIShadows } from '../src/fastGIShadows.ts'

const room = new Box3(new Vector3(0, 0, 0), new Vector3(5, 3, 5))

test('modelling captures retain point, spot and shadow layouts across lamp toggles and additions', () => {
  const lamp = new PointLight(0xff8844, 20), spot = new SpotLight(0xffffff, 30)
  lamp.position.set(2, 2, 2); spot.position.set(3, 2, 2); spot.target.position.set(1, 0, 1)
  const layouts: string[][] = []
  for (const lights of [[], [lamp], [lamp, spot]]) {
    for (const enabled of [false, true]) {
      lamp.intensity = enabled ? 20 : 0; spot.intensity = enabled ? 30 : 0
      const scene = new Scene(), slots = fastGICaptureLightSlots(lights, room)
      slots.forEach(({ light }) => scene.add(light))
      const shadows = configureFastGIShadows(scene, true)
      layouts.push(slots.map(({ light }) => `${light.type}:${light.castShadow}`))
      assert.equal(shadows.lights.length, 8)
      slots.forEach(({ light, index }) => {
        if (index < 0 || !enabled) {
          assert.equal(light.intensity, 0, 'unused slots contribute no illumination')
          assert.equal(light.shadow.autoUpdate, false, 'unused shadow maps do not consume draw time')
          assert.equal(light.shadow.needsUpdate, false)
        }
        if (light instanceof SpotLight && index === 1) {
          assert.notEqual(light.target, spot.target, 'capture owns its target')
          assert.deepEqual(light.target.position.toArray(), spot.target.position.toArray())
        }
      })
      shadows.dispose(); slots.forEach(({ light }) => light.dispose())
    }
  }
  layouts.forEach(layout => assert.deepEqual(layout, layouts[0]))
})

test('capture light budget favours contributing room lamps and preserves authored indices', () => {
  const far = new PointLight(0xffffff, 100), near = new PointLight(0xffffff, 10), clipped = new PointLight(0xffffff, 10000)
  far.position.set(100, 1, 1); near.position.set(2, 2, 2); clipped.position.set(20, 2, 2); clipped.distance = 2
  const slots = fastGICaptureLightSlots([far, near, clipped], room, 1)
  assert.equal(slots.length, 2, 'one point and one spot slot')
  assert.equal(slots[0].index, 1)
  assert.equal(slots[0].light.intensity, 10)
  assert.notEqual(slots[0].light, near)
  assert.equal(slots[1].index, -1)
  slots.forEach(({ light }) => light.dispose())
})
