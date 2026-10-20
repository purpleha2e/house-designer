import assert from 'node:assert/strict'
import test from 'node:test'
import { CubeUVReflectionMapping, MeshStandardMaterial, Scene, Texture } from 'three'
import { completeShaderWarmup, requestShaderWarmup, setViewportEnvironmentMap, shaderWarmupGeneration } from '../src/shaderWarmupState.ts'

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
