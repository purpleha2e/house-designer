import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshBasicMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { configureAmbientOcclusionPass } from '../src/ambientOcclusionResources.ts'

test('AO transparency preserves pending shadow work and restores flags on failure', () => {
  const shadowMap = { autoUpdate: true, needsUpdate: true }
  const renderer = { shadowMap } as WebGLRenderer
  const pass = {
    renderTransparency(actual: WebGLRenderer) {
      assert.equal(actual.shadowMap.autoUpdate, false)
      assert.equal(actual.shadowMap.needsUpdate, false)
      throw new Error('render failure')
    },
    dispose() {},
  }
  configureAmbientOcclusionPass(pass)
  assert.throws(() => pass.renderTransparency(renderer), /render failure/)
  assert.deepEqual(shadowMap, { autoUpdate: true, needsUpdate: true })
  shadowMap.autoUpdate = false; shadowMap.needsUpdate = false
  assert.throws(() => pass.renderTransparency(renderer), /render failure/)
  assert.deepEqual(shadowMap, { autoUpdate: false, needsUpdate: false })
})

test('AO disposal releases wrapped shader materials without disposing shared geometry', () => {
  const wrapped = new MeshBasicMaterial(), direct = new MeshBasicMaterial()
  const target = new WebGLRenderTarget(4, 4)
  let wrappedDisposals = 0, directDisposals = 0, targetDisposals = 0
  wrapped.addEventListener('dispose', () => wrappedDisposals++)
  direct.addEventListener('dispose', () => directDisposals++)
  target.addEventListener('dispose', () => targetDisposals++)
  const pass = {
    effectQuad: { material: wrapped, dispose() { throw new Error('Shared geometry disposed') } },
    otherQuad: { material: wrapped },
    blurQuad: { material: direct },
    direct,
    target,
    renderTransparency() {},
    dispose() { direct.dispose(); target.dispose() },
  }
  const detach = configureAmbientOcclusionPass(pass)
  assert.ok(detach)
  detach()
  assert.deepEqual([wrappedDisposals, directDisposals, targetDisposals], [1, 1, 1])
  // A development-mode remount can allocate GPU resources on this instance
  // again; the next actual unmount must still release them.
  const detachAfterRemount = configureAmbientOcclusionPass(pass)
  assert.ok(detachAfterRemount)
  detachAfterRemount()
  assert.deepEqual([wrappedDisposals, directDisposals, targetDisposals], [2, 2, 2])
})
