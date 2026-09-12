import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMaterialVariationShader,
  defaultMaterialVariation,
  isMaterialVariationActive,
  materialVariationFromMetadata,
  materialVariationMetadataDefaults,
} from '../src/materials/proceduralVariation.ts'
import { getMaterialVariationMetadata } from '../server/material-variation-metadata.mjs'
import { MeshStandardMaterial, ShaderLib, WebGLRenderer } from 'three'

test('legacy materials remain off and invalid metadata cannot create invalid shader values', () => {
  assert.deepEqual(materialVariationFromMetadata({}), defaultMaterialVariation)
  const config = materialVariationFromMetadata({
    variation_enabled: 'true', variation_brickStrength: 'NaN',
    variation_broadScaleMeters: '0', variation_broadStrength: '9',
    variation_bricksAcross: '4.7', variation_seed: 'Infinity',
  })
  assert.equal(config.enabled, true)
  assert.equal(config.brickStrength, defaultMaterialVariation.brickStrength)
  assert.equal(config.broadScaleMeters, 0.1)
  assert.equal(config.broadStrength, 1)
  assert.equal(config.bricksAcross, 5)
  assert.equal(config.seed, defaultMaterialVariation.seed)
  assert.equal(config.mode, 'surface')
})

test('portal create/edit metadata round-trips settings and older clients preserve them', () => {
  const created = getMaterialVariationMetadata({
    ...materialVariationMetadataDefaults,
    variation_enabled: 'true', variation_mode: 'brick', variation_seed: '42', variation_offsetU: '0.2',
  })
  const updated = getMaterialVariationMetadata({ variation_broadStrength: '0.3' }, created)
  const config = materialVariationFromMetadata(updated)
  assert.equal(config.seed, 42)
  assert.equal(config.enabled, true)
  assert.equal(config.mode, 'brick')
  assert.equal(config.offsetU, 0.2)
  assert.equal(config.broadStrength, 0.3)
  assert.equal(materialVariationFromMetadata(
    getMaterialVariationMetadata({ variation_enabled: 'false' }, updated),
  ).enabled, false)
})

test('VR overrides enabled materials without mutating their saved settings', () => {
  const config = { ...defaultMaterialVariation, enabled: true }
  assert.equal(isMaterialVariationActive(config, false), true)
  assert.equal(isMaterialVariationActive(config, true), false)
  assert.equal(isMaterialVariationActive(config, false), true)
  assert.equal(config.enabled, true)
  assert.equal(isMaterialVariationActive(undefined, false), false)
  assert.equal(isMaterialVariationActive({ ...config, brickStrength: 0, broadStrength: 0 }, false), false)
  assert.equal(isMaterialVariationActive({ ...config, mode: 'surface', broadStrength: 0 }, false), false)
})

test('variation uniforms are isolated per material while sharing a shader program', () => {
  const first = createMaterialVariationShader({ ...defaultMaterialVariation, seed: 3 })
  const second = createMaterialVariationShader({ ...defaultMaterialVariation, seed: 9 })
  const shader = () => ({
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0])
  const a = shader()
  const b = shader()
  const renderer = {} as WebGLRenderer
  first.onBeforeCompile.call(new MeshStandardMaterial(), a, renderer)
  second.onBeforeCompile.call(new MeshStandardMaterial(), b, renderer)
  assert.equal(first.customProgramCacheKey(), second.customProgramCacheKey())
  assert.equal(a.uniforms.hdVariationSeed.value, 3)
  assert.equal(b.uniforms.hdVariationSeed.value, 9)
  assert.notEqual(a.uniforms.hdBrickGrid.value, b.uniforms.hdBrickGrid.value)
  // Geometry, normal maps and texture sampling must stay on the original UVs.
  assert.ok(a.fragmentShader.includes('#include <map_fragment>'))
  assert.ok(a.fragmentShader.includes('#include <normal_fragment_maps>'))
  assert.ok(a.vertexShader.includes('(modelMatrix * hdWorld).xyz'))
})
