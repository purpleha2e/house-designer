import type { ModelMaterialRegion } from './models/modelLibrary'
import type { MaterialTextureTransform, PlacedModel } from './types.ts'

export const MIN_OBJECT_TEXTURE_SCALE = 0.001

export function normalizeTextureRotation(degrees: number) {
  const angle = degrees % 360
  return angle < 0 ? angle + 360 : angle
}

export function getModelMaterialTextureTransform(transforms: PlacedModel['materialTextureTransforms'], regionId: string): MaterialTextureTransform {
  const { textureRotation, textureScale } = transforms?.[regionId] ?? {}
  return {
    ...(typeof textureScale === 'number' && Number.isFinite(textureScale) && textureScale >= MIN_OBJECT_TEXTURE_SCALE && { textureScale }),
    ...(typeof textureRotation === 'number' && Number.isFinite(textureRotation) && { textureRotation: normalizeTextureRotation(textureRotation) }),
  }
}

/** Opt-in editable slots, independent of object category or mesh names.
 * Exact authored names are stable IDs: punctuation/case and Blender suffixes
 * must not accidentally merge two independently editable materials. */
export function discoverHdMaterialRegions(names: readonly string[]): ModelMaterialRegion[] {
  return [...new Set(names)].flatMap(name => {
    if (typeof name !== 'string' || !/^hd_/i.test(name)) return []
    const label = name.slice(3).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
    return label ? [{ id: name, label: label.charAt(0).toUpperCase()+label.slice(1), sourceMaterialNames: [name] }] : []
  })
}

export function normalizeArtworkMaterialRegions(regions: ModelMaterialRegion[] | undefined, objectType: string | undefined) {
  if (objectType !== 'decor' || !regions?.some(region => region.id === 'hd_frame')) return regions
  const legacy = regions.some(region => region.id === 'hd_canvas')
  if (legacy && regions.some(region => region.id === 'hd_image')) return regions
  return regions.map(region => region.id === 'hd_canvas' || region.id === 'hd_image'
    ? { ...region, id: 'hd_image', label: 'Image', sourceMaterialNames: ['hd_image', 'hd_canvas'] }
    : region)
}

export function migrateArtworkMaterial<T>(values: Record<string, T> | undefined) {
  if (!values || !Object.hasOwn(values, 'hd_canvas')) return values
  const { hd_canvas, ...rest } = values
  return { ...rest, hd_image: rest.hd_image ?? hd_canvas }
}

export function getModelMaterialRegion(
  regions: ModelMaterialRegion[] | undefined,
  sourceMaterialName: string,
) {
  return regions?.find((region) =>
    region.sourceMaterialNames.includes(sourceMaterialName),
  )
}

export function getModelMaterialOverrideId(
  overrides: Record<string, string> | undefined,
  regions: ModelMaterialRegion[] | undefined,
  sourceMaterialName: string,
) {
  const region = getModelMaterialRegion(regions, sourceMaterialName)
  return region ? overrides?.[region.id] : undefined
}
