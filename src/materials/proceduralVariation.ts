import { Vector2, type Material } from 'three'
import type { SurfaceMaterialVariation } from '../types.ts'

export const defaultMaterialVariation: SurfaceMaterialVariation = {
  enabled: false,
  mode: 'surface',
  brickStrength: 0.12,
  broadStrength: 0.15,
  broadScaleMeters: 3,
  seed: 1,
  bricksAcross: 4,
  brickRows: 8,
  rowOffset: 0.5,
  offsetU: 0,
  offsetV: 0,
}

const limits: Record<Exclude<keyof SurfaceMaterialVariation, 'enabled' | 'mode'>, [number, number]> = {
  brickStrength: [0, 1], broadStrength: [0, 1], broadScaleMeters: [0.1, 100],
  seed: [0, 65535], bricksAcross: [1, 128], brickRows: [1, 128],
  rowOffset: [0, 1], offsetU: [0, 1], offsetV: [0, 1],
}

export function normalizeMaterialVariation(input?: Partial<SurfaceMaterialVariation>) {
  const result = { ...defaultMaterialVariation, enabled: input?.enabled === true }
  result.mode = input?.mode === 'brick' ? 'brick' : 'surface'
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    const value = input?.[key]
    const [min, max] = limits[key]
    result[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : defaultMaterialVariation[key]
  }
  result.seed = Math.round(result.seed)
  result.bricksAcross = Math.round(result.bricksAcross)
  result.brickRows = Math.round(result.brickRows)
  return result
}

export const materialVariationMetadataDefaults = Object.fromEntries(
  Object.entries(defaultMaterialVariation).map(([key, value]) => [
    `variation_${key}`, String(value),
  ]),
)

export function materialVariationFromMetadata(metadata: Record<string, string>) {
  const values: Partial<SurfaceMaterialVariation> = {
    enabled: metadata.variation_enabled === 'true',
    mode: metadata.variation_mode === 'brick' ? 'brick' : 'surface',
  }
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    const raw = metadata[`variation_${key}`]
    if (raw?.trim()) values[key] = Number(raw)
  }
  return normalizeMaterialVariation(values)
}

export function isMaterialVariationActive(
  settings: SurfaceMaterialVariation | undefined,
  isVr: boolean,
) {
  return !isVr && settings?.enabled === true &&
    ((settings.mode === 'brick' && settings.brickStrength > 0) || settings.broadStrength > 0)
}

// Hash/value noise uses arithmetic only: no additional texture reads.
const noiseFunctions = /* glsl */ `
uniform float hdVariationSeed;
float hdVariationHash(vec3 p) {
  p = fract(p * 0.1031 + hdVariationSeed * 0.0137);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float hdVariationNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hdVariationHash(cell), hdVariationHash(cell + vec3(1,0,0)), f.x),
        mix(hdVariationHash(cell + vec3(0,1,0)), hdVariationHash(cell + vec3(1,1,0)), f.x), f.y),
    mix(mix(hdVariationHash(cell + vec3(0,0,1)), hdVariationHash(cell + vec3(1,0,1)), f.x),
        mix(hdVariationHash(cell + vec3(0,1,1)), hdVariationHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
`

export function createMaterialVariationShader(settings: SurfaceMaterialVariation) {
  const config = normalizeMaterialVariation(settings)
  const onBeforeCompile: Material['onBeforeCompile'] = (shader) => {
    Object.assign(shader.uniforms, {
      hdVariationSeed: { value: config.seed },
      hdBrickStrength: { value: config.brickStrength },
      hdBroadStrength: { value: config.broadStrength },
      hdBroadScale: { value: config.broadScaleMeters },
      hdBrickGrid: { value: new Vector2(config.bricksAcross, config.brickRows) },
      hdBrickOffset: { value: new Vector2(config.offsetU, config.offsetV) },
      hdRowOffset: { value: config.rowOffset },
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hdVariationPosition;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdWorld = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          hdWorld = batchingMatrix * hdWorld;
        #endif
        #ifdef USE_INSTANCING
          hdWorld = instanceMatrix * hdWorld;
        #endif
        hdVariationPosition = (modelMatrix * hdWorld).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 hdVariationPosition;
        uniform float hdBrickStrength;
        uniform float hdBroadStrength;
        uniform float hdBroadScale;
        uniform vec2 hdBrickGrid;
        uniform vec2 hdBrickOffset;
        uniform float hdRowOffset;
        ${noiseFunctions}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float hdBrickTint = 0.0;
        #if defined(USE_MAP) && ${config.mode === 'brick' && config.brickStrength > 0 ? '1' : '0'}
          // Keep unwrapped UVs: each brick gets its own stable seed, even in
          // subsequent texture repeats. UV transforms match the colour map.
          vec2 hdGrid = (vMapUv + hdBrickOffset) * hdBrickGrid;
          hdGrid.x += mod(floor(hdGrid.y), 2.0) * hdRowOffset;
          vec2 hdCell = floor(hdGrid);
          vec2 hdLocal = fract(hdGrid);
          vec2 hdDerivative = fwidth(hdGrid);
          vec2 hdBorder = min(hdLocal, 1.0 - hdLocal);
          vec2 hdInterior = smoothstep(vec2(0.06), vec2(0.12) + hdDerivative, hdBorder);
          // Fade tiny cells to suppress shimmering at distance.
          float hdDetailFade = 1.0 - smoothstep(0.25, 1.0, max(hdDerivative.x, hdDerivative.y));
          hdBrickTint = (hdVariationHash(vec3(hdCell, 17.0)) * 2.0 - 1.0)
            * hdBrickStrength * hdInterior.x * hdInterior.y * hdDetailFade;
        #endif
        float hdBroadTint = (hdVariationNoise(hdVariationPosition / hdBroadScale) * 2.0 - 1.0)
          * hdBroadStrength;
        diffuseColor.rgb *= max(vec3(0.0), vec3(1.0 + hdBroadTint)
          + hdBrickTint * vec3(1.0, 0.8, 0.65));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + hdBrickTint * 0.12, 0.0, 1.0);`)
  }
  return {
    onBeforeCompile,
    // Values are uniforms, so all enabled materials share the shader program.
    customProgramCacheKey: () => `house-designer-material-variation-v1-${config.mode === 'brick' && config.brickStrength > 0 ? 'brick' : 'surface'}`,
  }
}
