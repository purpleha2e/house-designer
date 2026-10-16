import assert from 'node:assert/strict'
import test from 'node:test'
import { PointLight, SpotLight, WebGLCubeRenderTarget, WebGLRenderTarget } from 'three'
import { releaseLightShadowResources, setLightShadowEnabled, createLightShadowControl } from '../src/lightShadowResources.ts'

test('a scene-local toggle applies shadow state synchronously and detaches removed lights', () => {
  const control = createLightShadowControl(true), otherScene = createLightShadowControl(true)
  const light = new PointLight()
  light.shadow.map = new WebGLCubeRenderTarget(16)
  let updates = 0
  const unsubscribe = control.subscribe(() => {
    updates++
    setLightShadowEnabled(light.shadow, control.get(), true)
  })
  control.set(false)
  assert.equal(light.shadow.intensity, 0, 'the event returns with shadows already disabled')
  assert.equal(light.shadow.autoUpdate, false)
  assert.equal(otherScene.get(), true, 'another viewport is independent')
  control.set(false)
  assert.equal(updates, 1, 'unchanged settings do not repeat work')
  unsubscribe()
  control.set(true)
  assert.equal(updates, 1)
  releaseLightShadowResources(light.shadow)
})

test('disabling shadows preserves targets and shader light counts without requesting a shadow pass', () => {
  for (const light of [new PointLight(), new SpotLight()]) {
    light.castShadow = true
    const map = new WebGLRenderTarget(16, 16), pass = new WebGLRenderTarget(16, 16)
    let disposed = 0
    map.addEventListener('dispose', () => disposed++)
    pass.addEventListener('dispose', () => disposed++)
    light.shadow.map = map; light.shadow.mapPass = pass
    for (const enabled of [true, false, true, false]) {
      setLightShadowEnabled(light.shadow, enabled, true)
      assert.equal(light.castShadow, true)
      assert.equal(light.shadow.intensity, enabled ? 1 : 0)
      assert.equal(light.shadow.autoUpdate, enabled)
      assert.equal(light.shadow.needsUpdate, enabled)
      assert.equal(light.shadow.map, map)
      assert.equal(light.shadow.mapPass, pass)
      assert.equal(disposed, 0)
    }
    setLightShadowEnabled(light.shadow, true, false)
    assert.equal(light.shadow.intensity, 0)
    assert.equal(light.shadow.autoUpdate, false)
    assert.equal(light.shadow.needsUpdate, false)
    releaseLightShadowResources(light.shadow)
    assert.equal(disposed, 2)
  }
})

test('removed point and spot lights release their shadow targets and can allocate again', () => {
  for (const light of [new PointLight(), new SpotLight()]) {
    const shadow = light.shadow
    let released = 0
    const map = light instanceof PointLight ? new WebGLCubeRenderTarget(16) : new WebGLRenderTarget(16, 16)
    const pass = new WebGLRenderTarget(16, 16)
    map.addEventListener('dispose', () => { released++ })
    pass.addEventListener('dispose', () => { released++ })
    shadow.map = map; shadow.mapPass = pass; shadow.needsUpdate = false
    releaseLightShadowResources(shadow)
    assert.equal(released, 2)
    assert.equal(shadow.map, null)
    assert.equal(shadow.mapPass, null)
    assert.equal(shadow.needsUpdate, true)
    releaseLightShadowResources(shadow)
    assert.equal(released, 2, 'repeated cleanup is harmless')
    const next = new WebGLRenderTarget(16, 16)
    next.addEventListener('dispose', () => { released++ })
    shadow.map = next
    releaseLightShadowResources(shadow)
    assert.equal(released, 3, 'a subsequent enable/disable cycle releases its new target')
  }
})
