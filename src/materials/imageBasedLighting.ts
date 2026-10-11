import type { Material } from 'three'

type ShaderOverrides = Partial<
  Pick<Material, 'customProgramCacheKey' | 'onBeforeCompile'>
>

const LIGHTING_END_CHUNK = '#include <lights_fragment_end>'

/**
 * Surface-product IBL is reflection-only so enabling it does not brighten or
 * recolour the material's authored diffuse/albedo response.
 */
export function withSpecularOnlyImageBasedLighting(
  overrides: ShaderOverrides = {},
): ShaderOverrides {
  const baseCompile = overrides.onBeforeCompile
  const baseCacheKey = overrides.customProgramCacheKey

  return {
    ...overrides,
    onBeforeCompile: (shader, renderer) => {
      baseCompile?.(shader, renderer)
      if (shader.fragmentShader.includes('// House Designer: retain environment radiance')) return
      shader.fragmentShader = shader.fragmentShader.replace(
        LIGHTING_END_CHUNK,
        `// House Designer: retain environment radiance, omit environment irradiance.
iblIrradiance = vec3(0.0);
${LIGHTING_END_CHUNK}`,
      )
    },
    customProgramCacheKey: () => {
      const key = baseCacheKey?.() ?? 'standard', suffix = '-house-designer-specular-ibl-v1'
      return key.includes(suffix) ? key : key + suffix
    },
  }
}

const reflectionOnlyMaterials = new WeakSet<Material>()

/** Compose with existing variation/light-mask hooks, once per material. */
export function applySpecularOnlyImageBasedLighting(material: Material) {
  if (reflectionOnlyMaterials.has(material)) return false
  const overrides = withSpecularOnlyImageBasedLighting({
    onBeforeCompile: material.onBeforeCompile.bind(material),
    customProgramCacheKey: material.customProgramCacheKey.bind(material),
  })
  material.onBeforeCompile = overrides.onBeforeCompile!
  material.customProgramCacheKey = overrides.customProgramCacheKey!
  reflectionOnlyMaterials.add(material)
  material.needsUpdate = true
  return true
}
