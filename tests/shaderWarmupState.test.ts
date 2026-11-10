import assert from 'node:assert/strict'
import test from 'node:test'
import { CubeUVReflectionMapping, MeshStandardMaterial, Scene, Texture } from 'three'
import { completeShaderWarmup, failShaderWarmup, finishShaderWarmup, requestShaderWarmup, setViewportEnvironmentMap, shaderWarmupGeneration, subscribeShaderWarmup } from '../src/shaderWarmupState.ts'

test('a cancelled effect cannot poison a replacement job in the same shader generation', () => {
  const scene = new Scene()
  scene.userData.projectGeneration = 4
  requestShaderWarmup(scene)
  const generation = shaderWarmupGeneration(scene), error = new TypeError('old asynchronous source failed')
  assert.equal(failShaderWarmup(scene, generation, error, true), false)
  assert.equal(scene.userData.shaderWarmupFailure, undefined)
  assert.equal(completeShaderWarmup(scene, generation), true)
  scene.userData.viewportPreparation = { message: 'Uploading scene resources...' }
  assert.equal(failShaderWarmup(scene, generation, error), true)
  assert.equal(scene.userData.shaderWarmupFailure.name, error.name)
  assert.equal(scene.userData.shaderWarmupFailure.stack, error.stack)
  assert.equal(scene.userData.shaderWarmupFailure.projectGeneration, 4)
  assert.equal(scene.userData.shaderWarmupFailure.stage, 'Uploading scene resources...')
  assert.equal(completeShaderWarmup(scene, generation), false)
})

test('failed shader links cannot release the display, including a late completion', () => {
  const scene = new Scene()
  requestShaderWarmup(scene)
  const generation = shaderWarmupGeneration(scene)
  assert.equal(failShaderWarmup(scene,generation,new Error('fragment sampler limit')),true)
  assert.equal(completeShaderWarmup(scene,generation),false)
  assert.equal(scene.userData.shaderWarmupPending,true)
  requestShaderWarmup(scene)
  assert.equal(failShaderWarmup(scene,generation,new Error('obsolete failure')),false)
  assert.equal(completeShaderWarmup(scene,shaderWarmupGeneration(scene)),true)
  assert.equal(scene.userData.shaderWarmupFailure,undefined)
})

test('a lighting update cannot be released by an older shader scan or queued completion frame', () => {
  const scene = new Scene()
  requestShaderWarmup(scene)
  const scanning = shaderWarmupGeneration(scene)
  requestShaderWarmup(scene)
  assert.equal(completeShaderWarmup(scene, scanning), false)
  assert.equal(scene.userData.shaderWarmupPending, true)
  const compiling = shaderWarmupGeneration(scene)
  requestShaderWarmup(scene)
  assert.equal(completeShaderWarmup(scene, compiling), false)
  assert.equal(scene.userData.shaderWarmupPending, true)
  assert.equal(completeShaderWarmup(scene, shaderWarmupGeneration(scene)), true)
  assert.equal(scene.userData.shaderWarmupPending, false)
})

test('a queued completion superseded by a sky update is obsolete, not a material failure', () => {
  const scene = new Scene()
  requestShaderWarmup(scene)
  const old = shaderWarmupGeneration(scene)
  requestShaderWarmup(scene)
  const current = shaderWarmupGeneration(scene)
  assert.equal(finishShaderWarmup(scene, old, true), 'obsolete')
  assert.equal(shaderWarmupGeneration(scene), current)
  assert.equal(scene.userData.shaderWarmupPending, true)
  assert.equal(scene.userData.shaderWarmupFailure, undefined)
  assert.equal(finishShaderWarmup(scene, current, true, true), 'obsolete')
  assert.equal(finishShaderWarmup(scene, current, true), 'ready')
  assert.equal(scene.userData.shaderWarmupPending, false)
})

test('a changed texture that interrupts upload schedules fresh preparation without releasing the display', () => {
  const scene = new Scene()
  requestShaderWarmup(scene)
  const generation = shaderWarmupGeneration(scene)
  let notifications = 0
  const unsubscribe = subscribeShaderWarmup(scene, () => notifications++)
  assert.equal(finishShaderWarmup(scene, generation, false), 'retry')
  assert.equal(notifications, 1)
  assert.equal(shaderWarmupGeneration(scene), generation + 1)
  assert.equal(scene.userData.shaderWarmupPending, true)
  assert.equal(scene.userData.shaderWarmupFailure, undefined)
  unsubscribe()
  const error = new Error('real shader link failure')
  failShaderWarmup(scene, generation + 1, error)
  const failure = scene.userData.shaderWarmupFailure
  assert.equal(finishShaderWarmup(scene, generation + 1, false), 'failed')
  assert.equal(finishShaderWarmup(scene, generation + 1, true), 'failed')
  assert.equal(scene.userData.shaderWarmupFailure, failure)
  assert.equal(shaderWarmupGeneration(scene), generation + 1, 'genuine errors must not be retried or hidden')
  assert.equal(scene.userData.shaderWarmupPending, true)
})

test('reflection layout changes and restores hold the display, while repeated bakes reuse shaders', () => {
  const scene = new Scene(), material = new MeshStandardMaterial()
  const atlas = (height: number) => { const texture = new Texture({ height, width: height * 3 }); texture.mapping = CubeUVReflectionMapping; return texture }
  const sky = atlas(512), room = atlas(256), replacement = atlas(256)
  material.envMap = sky
  try {
    setViewportEnvironmentMap(scene, material, room)
    assert.equal(scene.userData.shaderWarmupPending, true)
    const roomGeneration = shaderWarmupGeneration(scene)
    assert.equal(material.envMap, room)
    assert.equal(completeShaderWarmup(scene, roomGeneration), true)
    setViewportEnvironmentMap(scene, material, replacement)
    assert.equal(shaderWarmupGeneration(scene), roomGeneration, 'a new same-size reflection does not recompile')
    assert.equal(scene.userData.shaderWarmupPending, false)
    setViewportEnvironmentMap(scene, material, sky)
    assert.equal(scene.userData.shaderWarmupPending, true, 'restoring the fallback needs the same protection as assignment')
    assert.equal(completeShaderWarmup(scene, roomGeneration), false, 'a late room completion cannot publish the restored shader')
  } finally { material.dispose(); sky.dispose(); room.dispose(); replacement.dispose() }
})
