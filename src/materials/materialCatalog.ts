import type { SurfaceMaterialProduct } from '../types'

export const CUSTOM_PAINT_MATERIAL_IDS = new Set([
  'house-designer-custom-paint-gloss',
  'house-designer-custom-paint-matt',
])

const materialTextureModules = import.meta.glob<string>(
  './textures/**/*.{jpg,jpeg,png,webp}',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
)
const materialModules = import.meta.glob<SurfaceMaterialProduct>(
  './catalog/**/*.json',
  {
    eager: true,
    import: 'default',
  },
)

function resolveMaterialTextureUrl(textureUrl: string | undefined) {
  if (
    !textureUrl ||
    textureUrl.startsWith('/') ||
    textureUrl.startsWith('http://') ||
    textureUrl.startsWith('https://') ||
    textureUrl.startsWith('data:') ||
    textureUrl.startsWith('blob:')
  ) {
    return textureUrl
  }

  const normalizedUrl = textureUrl.replace(/\\/g, '/')
  const candidates = [
    normalizedUrl,
    normalizedUrl.startsWith('.') ? normalizedUrl : `./${normalizedUrl}`,
    normalizedUrl.replace(/^\.\.\/textures\//, './textures/'),
  ]

  return (
    candidates
      .map((candidate) => materialTextureModules[candidate])
      .find((candidate): candidate is string => Boolean(candidate)) ??
    (() => {
      if (import.meta.env.DEV) {
        console.warn(`Material texture was not found: ${textureUrl}`)
      }

      return textureUrl
    })()
  )
}

function resolveMaterialTextureUrls(
  material: SurfaceMaterialProduct,
): SurfaceMaterialProduct {
  return {
    ...material,
    pbr: {
      ...material.pbr,
      ambientOcclusionTextureUrl: resolveMaterialTextureUrl(
        material.pbr.ambientOcclusionTextureUrl,
      ),
      baseColorTextureUrl: resolveMaterialTextureUrl(
        material.pbr.baseColorTextureUrl,
      ),
      displacementTextureUrl: resolveMaterialTextureUrl(
        material.pbr.displacementTextureUrl,
      ),
      metalnessTextureUrl: resolveMaterialTextureUrl(
        material.pbr.metalnessTextureUrl,
      ),
      normalTextureUrl: resolveMaterialTextureUrl(material.pbr.normalTextureUrl),
      roughnessTextureUrl: resolveMaterialTextureUrl(
        material.pbr.roughnessTextureUrl,
      ),
    },
  }
}

export const surfaceMaterialCatalog = Object.values(materialModules)
  .map(resolveMaterialTextureUrls)
  .sort(
  (firstMaterial, secondMaterial) =>
    [
      firstMaterial.manufacturer.localeCompare(secondMaterial.manufacturer),
      (firstMaterial.collection ?? '').localeCompare(
        secondMaterial.collection ?? '',
      ),
      firstMaterial.productName.localeCompare(secondMaterial.productName),
    ].find((comparison) => comparison !== 0) ?? 0,
  )

export const surfaceMaterialsById = new Map(
  surfaceMaterialCatalog.map((material) => [material.id, material]),
)

export function getSurfaceMaterialLabel(material: SurfaceMaterialProduct) {
  return [
    material.manufacturer,
    material.collection,
    material.productName,
    material.finish,
  ]
    .filter(Boolean)
    .join(' - ')
}

export function isCustomPaintMaterialId(materialId: string) {
  return CUSTOM_PAINT_MATERIAL_IDS.has(materialId)
}
