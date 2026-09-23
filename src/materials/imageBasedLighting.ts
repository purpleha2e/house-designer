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
      shader.fragmentShader = shader.fragmentShader.replace(
        LIGHTING_END_CHUNK,
        `// House Designer: retain environment radiance, omit environment irradiance.
iblIrradiance = vec3(0.0);
${LIGHTING_END_CHUNK}`,
      )
    },
    customProgramCacheKey: () =>
      `${baseCacheKey?.() ?? 'standard'}-house-designer-specular-ibl-v1`,
  }
}
