import test from 'node:test'
import assert from 'node:assert/strict'
import { Data3DTexture, DataTexture, Scene, type WebGLRenderer } from 'three'
import { prepareTextureReplacement, prepareTextureUpload } from '../src/textureUpload.ts'
import { finishShaderWarmup, requestShaderWarmup, shaderWarmupGeneration } from '../src/shaderWarmupState.ts'

test('changing lighting pixels during a bounded upload retries preparation without reporting a GPU failure', async () => {
  const texture = new DataTexture(new Uint8Array(256 * 256 * 4), 256, 256)
  texture.needsUpdate = true
  const scene = new Scene()
  requestShaderWarmup(scene)
  const generation = shaderWarmupGeneration(scene)
  let copies = 0, disposed = false
  texture.addEventListener('dispose', () => { disposed = true })
  const renderer = { properties: { has: () => false }, initTexture() {}, copyTextureToTexture() {
    copies++; texture.needsUpdate = true
  } } as unknown as WebGLRenderer
  try {
    const ready = await prepareTextureUpload(renderer, texture, () => false)
    assert.equal(ready, false)
    assert.equal(copies, 1, 'the old upload stops when its lighting pixels change')
    assert.equal(finishShaderWarmup(scene, generation, ready), 'retry')
    assert.equal(shaderWarmupGeneration(scene), generation + 1)
    assert.equal(scene.userData.shaderWarmupPending, true)
    assert.equal(scene.userData.shaderWarmupFailure, undefined)
    assert.equal(disposed, false, 'the displayed lighting remains owned by its source')
  } finally { texture.dispose() }
})

test('a failed replacement upload releases its allocation and preserves the displayed texture', async () => {
  const original = new Data3DTexture(new Uint8Array(32), 2, 2, 2)
  let displayedDisposed = false, replacementDisposed = false
  original.addEventListener('dispose', () => { displayedDisposed = true })
  const renderer = { properties: { has: () => false }, initTexture(texture: Data3DTexture) {
    assert.notEqual(texture, original)
    texture.addEventListener('dispose', () => { replacementDisposed = true })
    throw Error('Injected upload failure')
  } } as unknown as WebGLRenderer
  await assert.rejects(prepareTextureReplacement(renderer, original, () => false), /Injected upload failure/)
  assert.equal(replacementDisposed, true)
  assert.equal(displayedDisposed, false)
  assert.equal(original.image.data.length, 32)
  original.dispose()
})
