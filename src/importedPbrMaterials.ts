import type { Material, Texture } from 'three'

type PbrMaterial = Material & {
  metalness: number
  roughness: number
}

type EnvironmentMappedMaterial = Material & {
  envMap: Texture | null
  envMapIntensity: number
  metalness: number
}

function clampUnitInterval(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

const importedMetalIblThreshold = 0.5

/**
 * Keep imported metallic/roughness materials physically meaningful without
 * replacing their authored PBR response. glTF requires both factors to be in
 * the 0..1 range, but some DCC exports contain out-of-range values.
 */
export function normalizeImportedPbrMaterial(material: Material) {
  if (
    !('metalness' in material) ||
    typeof material.metalness !== 'number' ||
    !('roughness' in material) ||
    typeof material.roughness !== 'number'
  ) {
    return false
  }

  const pbrMaterial = material as PbrMaterial
  const metalness = clampUnitInterval(pbrMaterial.metalness, 0)
  const roughness = clampUnitInterval(pbrMaterial.roughness, 1)

  if (
    metalness === pbrMaterial.metalness &&
    roughness === pbrMaterial.roughness
  ) {
    return false
  }

  pbrMaterial.metalness = metalness
  pbrMaterial.roughness = roughness
  pbrMaterial.needsUpdate = true
  return true
}

/**
 * Apply image-based lighting only to metallic materials in imported assets.
 * Painted wood, glass surrounds, and other dielectric parts must retain the
 * same direct-lighting response they had before imported-metal IBL existed.
 */
export function applyImportedPbrEnvironment(
  material: Material,
  environmentMap: Texture | null,
  intensity: number,
) {
  if (
    !('envMap' in material) ||
    !('envMapIntensity' in material) ||
    typeof material.envMapIntensity !== 'number' ||
    !('metalness' in material) ||
    typeof material.metalness !== 'number'
  ) {
    return false
  }

  const environmentMappedMaterial = material as EnvironmentMappedMaterial
  if (environmentMappedMaterial.metalness < importedMetalIblThreshold) {
    return false
  }

  const nextIntensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 0
  const mapChanged = environmentMappedMaterial.envMap !== environmentMap
  const intensityChanged =
    environmentMappedMaterial.envMapIntensity !== nextIntensity

  if (!mapChanged && !intensityChanged) {
    return false
  }

  environmentMappedMaterial.envMap = environmentMap
  environmentMappedMaterial.envMapIntensity = nextIntensity

  if (mapChanged) {
    environmentMappedMaterial.needsUpdate = true
  }

  return true
}
