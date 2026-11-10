import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, WebGLRenderTarget, type WebGLRenderer } from 'three'
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

test('AO reuses this frame matrices and permits furniture and camera updates next frame', () => {
  const scene = new Scene(), furniture = new Object3D(), camera = new PerspectiveCamera()
  scene.add(furniture)
  const renderer = { shadowMap: { autoUpdate: false, needsUpdate: true } } as WebGLRenderer
  let worldUpdates = 0, submissions = 0, expectedX = 2
  const update = scene.updateMatrixWorld.bind(scene)
  scene.updateMatrixWorld = force => { worldUpdates++; update(force) }
  const draw = () => {
    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld()
    assert.equal(furniture.matrixWorld.elements[12], expectedX)
  }
  const pass = {
    scene,
    renderTransparency() {
      assert.equal(this.scene.matrixWorldAutoUpdate, false)
      assert.equal(furniture.matrixWorldAutoUpdate, true)
      assert.equal(camera.matrixWorldAutoUpdate, true)
      draw(); draw(); submissions += 2
    },
    dispose() {},
  }
  configureAmbientOcclusionPass(pass)
  for (const x of [2, 5]) {
    expectedX = x; furniture.position.x = x; camera.position.x = x
    draw() // The preceding main-scene render updates the current transforms.
    camera.updateMatrixWorld()
    pass.renderTransparency(renderer)
    assert.equal(scene.matrixWorldAutoUpdate, true)
    assert.equal(camera.matrixWorld.elements[12], x)
  }
  assert.equal(worldUpdates, 2, 'only the main render updates the house')
  assert.equal(submissions, 4, 'both transparency geometry submissions remain')
  assert.deepEqual(renderer.shadowMap, { autoUpdate: false, needsUpdate: true })
})

test('AO restores the exact scene matrix flag on failure and after scene replacement', () => {
  const scene = new Scene(), replacement = new Scene()
  const renderer = { shadowMap: { autoUpdate: true, needsUpdate: true } } as WebGLRenderer
  const pass = { scene, mainScene: scene,
    renderTransparency() {
      assert.equal(this.scene.matrixWorldAutoUpdate, false)
      throw new Error('mask draw failed')
    }, dispose() {},
  }
  configureAmbientOcclusionPass(pass)
  for (const flag of [true, false]) {
    scene.matrixWorldAutoUpdate = flag
    assert.throws(() => pass.renderTransparency(renderer), /mask draw failed/)
    assert.equal(scene.matrixWorldAutoUpdate, flag)
  }
  pass.mainScene = replacement
  assert.equal(pass.scene, replacement)
  assert.throws(() => pass.renderTransparency(renderer), /mask draw failed/)
  assert.equal(replacement.matrixWorldAutoUpdate, true)
  assert.equal(scene.matrixWorldAutoUpdate, false)
  assert.deepEqual(renderer.shadowMap, { autoUpdate: true, needsUpdate: true })
})
