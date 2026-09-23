import type { ModelMaterialRegion } from './models/modelLibrary'

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
