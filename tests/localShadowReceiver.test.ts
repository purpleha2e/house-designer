import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, ShaderChunk } from 'three'
import { applyLocalShadowReceiver } from '../src/materials/localShadowReceiver.ts'
import { withWallShadowReceiver } from '../src/materials/wallShadowReceiver.ts'

test('point filtering preserves installed basic shadows and uses each cube texel receiver depth', () => {
  const original = ShaderChunk.shadowmap_pars_fragment
  const shader = { fragmentShader: '#include <shadowmap_pars_fragment>' }
  applyLocalShadowReceiver(shader as never, {} as never)
  assert.equal((shader.fragmentShader.match(/float getPointShadow\(samplerCubeShadow/g) ?? []).length, 1)
  assert.match(shader.fragmentShader, /cross\(dFdx\(p\), dFdy\(p\)\)/)
  assert.match(shader.fragmentShader, /hdPointShadowTexel/)
  assert.match(shader.fragmentShader, /texture\(shadowMap, vec4\(tap, reference\)\)/)
  const basic = original.slice(original.indexOf('\n\t#elif defined( SHADOWMAP_TYPE_BASIC )', original.indexOf('float getPointShadow(')))
  assert.ok(shader.fragmentShader.endsWith(basic))
  assert.equal(ShaderChunk.shadowmap_pars_fragment, original)
})

test('ordinary and previously composed wall materials share the corrected receivers', () => {
  const material = new MeshStandardMaterial(), shader = { fragmentShader: '#include <shadowmap_pars_fragment>' }
  withWallShadowReceiver().onBeforeCompile!.call(material, shader as never, {} as never)
  applyLocalShadowReceiver(shader as never, {} as never)
  assert.equal((shader.fragmentShader.match(/float getShadow\( sampler2DShadow/g) ?? []).length, 1)
  assert.match(shader.fragmentShader, /dot\(depthGradient, tap - shadowCoord.xy\)/)
  assert.match(shader.fragmentShader, /hdPointShadowTexel/)
})
