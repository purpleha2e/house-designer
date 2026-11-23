import type { Material } from 'three'
import { captureMaterialShaderKey, composedMaterialShaderKey } from '../shaderKeyTransform.ts'
import { withSpecularOnlyImageBasedLighting } from './imageBasedLighting.ts'
import { createMaterialVariationShader } from './proceduralVariation.ts'
import { withWallShadowReceiver } from './wallShadowReceiver.ts'

type ShaderOverrides = Partial<Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'>>
const finishes = new WeakMap<Material, { overrides: ShaderOverrides }>()

export function createSurfaceFinishShader(variationKey: string, reflectEnvironment: boolean, wallReceiver: boolean) {
  const variation = variationKey ? createMaterialVariationShader(JSON.parse(variationKey)) : {}
  const finish = reflectEnvironment ? withSpecularOnlyImageBasedLighting(variation) : variation
  return wallReceiver ? withWallShadowReceiver(finish) : finish
}

/** Keep one finish hook so asynchronous textures cannot replace GI/room-light hooks. */
export function updateSurfaceMaterialShader(material: Material, overrides: ShaderOverrides) {
  const existing = finishes.get(material)
  if (existing) {
    existing.overrides = overrides
    return
  }
  const state = { overrides }
  finishes.set(material, state)
  const compile = material.onBeforeCompile
  const cacheKey = captureMaterialShaderKey(material), composeKey = composedMaterialShaderKey()
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    state.overrides.onBeforeCompile?.call(material, shader, renderer)
  }
  material.customProgramCacheKey = () => composeKey(cacheKey(), `:surface-finish:${
    state.overrides.customProgramCacheKey?.call(material) ?? 'standard'
  }`)
}
