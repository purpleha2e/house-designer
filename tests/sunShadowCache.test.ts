import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Scene, Texture, WebGLRenderTarget } from 'three'
import { SunShadowCache } from '../src/sunShadowCache.ts'

function fixture() {
  const scene = new Scene(), light = new DirectionalLight(), parent = new Group()
  const caster = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  caster.castShadow = true
  parent.add(caster); scene.add(parent, light, light.target)
  light.shadow.autoUpdate = false
  light.shadow.map = new WebGLRenderTarget(16, 16)
  const cache = new SunShadowCache()
  const update = (layers = 1, type = 1) => {
    scene.updateMatrixWorld(true)
    const changed = cache.update(light, scene, layers, type)
    assert.equal(light.shadow.needsUpdate, changed)
    light.shadow.needsUpdate = false // Simulate the completed shadow pass.
    return changed
  }
  return { scene, light, parent, caster, update }
}

test('temporarily detached materials invalidate once and recover when reattached', () => {
  const { caster, update } = fixture()
  const original = caster.material
  update()
  Reflect.deleteProperty(caster, 'material')
  assert.equal(update(), true)
  assert.equal(update(), false)
  caster.material = original
  assert.equal(update(), true)
  assert.equal(update(), false)
})

test('static sun shadows settle and ignore non-casters while sun/target/settings changes refresh', () => {
  const { scene, light, update } = fixture()
  assert.equal(update(), true)
  assert.equal(update(), false)
  const decoration = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  scene.add(decoration); decoration.position.x = 3
  assert.equal(update(), false)
  light.position.x = 4
  assert.equal(update(), true)
  assert.equal(update(), false)
  light.target.position.z = 2
  assert.equal(update(), true)
  light.shadow.camera.right += 1
  assert.equal(update(), true)
  light.shadow.mapSize.x = 32
  assert.equal(update(), true)
  assert.equal(update(2), true)
  assert.equal(update(2), false)
  assert.equal(update(2, 2), true)
  light.shadow.map = null
  assert.equal(update(2, 2), true)
})

test('caster geometry, parent movement, visibility, addition and removal invalidate the cache', () => {
  const { caster, parent, scene, update } = fixture()
  update()
  parent.position.y = 2
  assert.equal(update(), true)
  caster.geometry.attributes.position.needsUpdate = true
  assert.equal(update(), true)
  caster.geometry.setAttribute('position', caster.geometry.attributes.position.clone())
  assert.equal(update(), true)
  parent.visible = false
  assert.equal(update(), true)
  assert.equal(update(), false)
  parent.visible = true
  assert.equal(update(), true)
  caster.castShadow = false
  assert.equal(update(), true)
  caster.castShadow = true
  assert.equal(update(), true)
  scene.remove(parent)
  assert.equal(update(), true)
  scene.add(parent)
  assert.equal(update(), true)
})

test('instance transforms and shadow-affecting materials refresh without resource replacement', () => {
  const { scene, caster, update } = fixture()
  const instances = new InstancedMesh(caster.geometry, caster.material, 2)
  instances.castShadow = true
  scene.add(instances)
  update()
  instances.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0))
  instances.instanceMatrix.needsUpdate = true
  assert.equal(update(), true)
  assert.equal(update(), false)
  instances.count = 1
  assert.equal(update(), true)
  caster.material.alphaTest = 0.5
  caster.material.alphaMap = new Texture()
  assert.equal(update(), true)
  caster.material.alphaMap.offset.x = 0.2
  assert.equal(update(), true)
  assert.equal(update(), false)
  caster.material.visible = false
  assert.equal(update(), true)
})
