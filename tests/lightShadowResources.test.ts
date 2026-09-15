import assert from 'node:assert/strict'
import test from 'node:test'
import { PointLight, SpotLight, WebGLCubeRenderTarget, WebGLRenderTarget } from 'three'
import { releaseLightShadowResources } from '../src/lightShadowResources.ts'

test('inactive point and spot lights release their shadow targets and can allocate again', () => {
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
