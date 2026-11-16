import type { ModelMaterialRegion } from './models/modelLibrary'

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
