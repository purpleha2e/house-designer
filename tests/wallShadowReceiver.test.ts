import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, ShaderChunk } from 'three'
import { withWallShadowReceiver } from '../src/materials/wallShadowReceiver.ts'

test('wall filtering replaces the installed PCF shader without changing point shadows or global chunks', () => {
  const original = ShaderChunk.shadowmap_pars_fragment
  const shader = { fragmentShader: '#include <shadowmap_pars_fragment>' }
  const material = new MeshStandardMaterial()
  const overrides = withWallShadowReceiver()
  overrides.onBeforeCompile!.call(material, shader as never, {} as never)
  assert.match(shader.fragmentShader, /dFdx\(shadowCoord.xyz\)/)
  assert.match(shader.fragmentShader, /dot\(depthGradient, offset\)/)
  assert.equal((shader.fragmentShader.match(/float getShadow\( sampler2DShadow/g) ?? []).length, 1)
  const pointShadows = original.slice(original.indexOf('float getPointShadow('))
  assert.ok(shader.fragmentShader.endsWith(pointShadows))
  assert.equal(ShaderChunk.shadowmap_pars_fragment, original)
})

test('wall filtering composes with material finish hooks and separates its cached shader', () => {
  const material = new MeshStandardMaterial()
  let receiver: unknown
  const overrides = withWallShadowReceiver({
    onBeforeCompile(shader) { receiver = this; shader.fragmentShader += '\n// original finish' },
    customProgramCacheKey() { return 'finish-key' },
  })
  const shader = { fragmentShader: '#include <shadowmap_pars_fragment>' }
  overrides.onBeforeCompile!.call(material, shader as never, {} as never)
  assert.equal(receiver, material)
  assert.match(shader.fragmentShader, /original finish/)
  assert.equal(overrides.customProgramCacheKey!.call(material), 'finish-key-wall-shadow-receiver-v1')
})
