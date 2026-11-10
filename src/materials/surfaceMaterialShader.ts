import type { Material } from 'three'

type ShaderOverrides = Partial<Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'>>
const finishes = new WeakMap<Material, { overrides: ShaderOverrides }>()

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
  const cacheKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    state.overrides.onBeforeCompile?.call(material, shader, renderer)
  }
  material.customProgramCacheKey = () => `${cacheKey.call(material)}:surface-finish:${
    state.overrides.customProgramCacheKey?.call(material) ?? 'standard'
  }`
}
