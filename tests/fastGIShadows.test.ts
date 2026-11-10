import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Mesh, MeshStandardMaterial, PointLight, Scene } from 'three'
import { configureFastGIShadows } from '../src/fastGIShadows.ts'

test('preview lights use their own bounded GPU shadows without requiring probe visibility atlases', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  material.defines = { HD_GI_CAPTURE_VISIBILITY: 1, OTHER_FEATURE: 1 }
  const mesh = new Mesh(geometry, material), on = new PointLight(0xffffff, 100), off = new PointLight(0xffffff, 0)
  scene.add(mesh, on, off)
  const shadows = configureFastGIShadows(scene)
  assert.deepEqual(shadows.lights, [on])
  assert.equal(on.castShadow, true); assert.equal(off.castShadow, false)
  assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, true)
  assert.deepEqual(material.defines, { OTHER_FEATURE: 1 })
  assert.deepEqual(on.shadow.mapSize.toArray(), [512, 512])
  shadows.dispose(); geometry.dispose(); material.dispose()
})
