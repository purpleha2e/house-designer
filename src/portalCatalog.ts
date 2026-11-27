import type { SurfaceFinish, SurfaceMaterialProduct } from './types'
import { materialVariationFromMetadata } from './materials/proceduralVariation.ts'
import type { ModelDefinition, ModelObjectType } from './models/modelLibrary'
import { discoverHdMaterialRegions, normalizeArtworkMaterialRegions } from './modelMaterialOverrides.ts'
import { readObjectCatalogue, type ObjectCatalogue } from './models/objectCatalogue.ts'
import { materialMapSlots } from './materials/localMaterials.ts'
import { readMaterialCatalogueLayout, type MaterialCatalogueLayout } from './materials/materialCatalogueLayout.ts'
import { normalizeMaterialFolder } from './materials/materialFolderPath.ts'
import { normalizeMaterialLabel, parseSurfaceCategory } from './materials/materialCatalogueMetadata.ts'

type PortalCatalogFile = {
  fieldName: string
  url: string
}

type PortalCatalogAsset = {
  assetKind: 'material' | 'model'
  bundledMaterialId?: string
  category: string
  collection: string
  conversion?: {
    status: string
  }
  files: PortalCatalogFile[]
  id: string
  inferredDimensions?: {
    depth: number
    height: number
    maxX?: number
    maxZ?: number
    minX?: number
    minZ?: number
    width: number
  } | null
  manufacturer: {
    name: string
    slug: string
  }
  metadata: Record<string, string>
  materialNames?: string[]
  processedFiles?: PortalCatalogFile[]
}

type PortalCatalogGroup = {
  assets: PortalCatalogAsset[]
}

type PortalCatalogResponse = {
  manufacturers: PortalCatalogGroup[]
  catalogueLayout?: unknown
  materialCatalogue?: unknown
}

export type RuntimePortalCatalog = {
  materials: SurfaceMaterialProduct[]
  models: ModelDefinition[]
  catalogueLayout?: ObjectCatalogue
  materialCatalogue?: MaterialCatalogueLayout
}

const surfaceFinishes = new Set<SurfaceFinish>([
  'eggshell',
  'gloss',
  'matt',
  'satin',
  'textured',
])
const modelWallMounts = new Set<NonNullable<ModelDefinition['wallMount']>>([
  'exterior-door',
  'interior-door',
  'patio-door',
  'window',
])
const modelObjectTypes = new Set<ModelObjectType>([
  'appliance',
  'bathroom',
  'decor',
  'exterior-door',
  'furniture',
  'interior-door',
  'kitchen',
  'lighting',
  'other',
  'patio-door',
  'stairs',
  'structural',
  'window',
])
const modelObjectTypeCategories: Partial<Record<ModelObjectType, string>> = {
  appliance: 'Appliances',
  bathroom: 'Bathroom',
  decor: 'Decoration',
  'exterior-door': 'Doors',
  furniture: 'Furniture',
  'interior-door': 'Doors',
  kitchen: 'Kitchen',
  lighting: 'Lighting',
  other: 'Uploaded',
  'patio-door': 'Doors',
  stairs: 'Stairs',
  structural: 'Structural',
  window: 'Windows',
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function normalizeSurfaceFinish(value: string) {
  const normalized = normalizeToken(value)

  return surfaceFinishes.has(normalized as SurfaceFinish)
    ? (normalized as SurfaceFinish)
    : undefined
}

function parsePositiveNumber(value: string | undefined) {
  const parsedValue = Number.parseFloat(value ?? '')

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined
}

function parseUnitNumber(value: string | undefined) {
  const parsedValue = Number.parseFloat(value ?? '')

  return Number.isFinite(parsedValue)
    ? Math.min(1, Math.max(0, parsedValue))
    : undefined
}

function parseMappingNumber(value: string | undefined, min: number, max = Infinity) {
  if (!value?.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}

function parseHexColor(value: string | undefined) {
  const normalizedValue = value?.trim()

  return normalizedValue && /^#[\da-f]{6}$/i.test(normalizedValue)
    ? normalizedValue
    : undefined
}

function normalizeModelWallMount(value: string | undefined) {
  const normalized = normalizeToken(value ?? '')

  return modelWallMounts.has(normalized as NonNullable<ModelDefinition['wallMount']>)
    ? (normalized as NonNullable<ModelDefinition['wallMount']>)
    : undefined
}

function normalizeModelObjectType(value: string | undefined) {
  const normalized = normalizeToken(value ?? '')

  return modelObjectTypes.has(normalized as ModelObjectType)
    ? (normalized as ModelObjectType)
    : undefined
}

function findOriginalFile(asset: PortalCatalogAsset, fieldName: string) {
  return asset.files.find((file) => file.fieldName === fieldName)?.url
}

function findProcessedFile(asset: PortalCatalogAsset, fieldName: string) {
  return asset.processedFiles?.find((file) => file.fieldName === fieldName)?.url
}

function portalMaterialToSurfaceMaterial(
  asset: PortalCatalogAsset,
): SurfaceMaterialProduct | null {
  const originalTextureUrls = Object.fromEntries(materialMapSlots.flatMap(({ key, field }) => {
    const url = findOriginalFile(asset, field)
    return url ? [[key, url]] : []
  })) as SurfaceMaterialProduct['originalTextureUrls']
  const pbrTextures = Object.fromEntries(materialMapSlots.map(({ key, field }) => {
    const original = originalTextureUrls?.[key]
    const raster = original && /\.(png|jpe?g|webp|bmp|avif|gif)(?:[?#]|$)/i.test(original) ? original : undefined
    const processed = ['complete', 'partial'].includes(asset.conversion?.status ?? '') ? findProcessedFile(asset, field) : undefined
    return [key, processed ?? raster]
  })) as Partial<SurfaceMaterialProduct['pbr']>
  const baseColor = parseHexColor(asset.metadata.baseColor)

  if (!pbrTextures.baseColorTextureUrl && !baseColor) {
    return null
  }

  const authoredCategory = normalizeMaterialLabel(asset.metadata.category || asset.category)
  const legacyCategory = parseSurfaceCategory(authoredCategory)
  const surfaceCategory = parseSurfaceCategory(asset.metadata.surfaceCategory)
  const category = legacyCategory ?? surfaceCategory ?? 'wall-covering'
  const catalogueCategory = authoredCategory && (surfaceCategory || !legacyCategory) ? authoredCategory : undefined
  const finish = normalizeSurfaceFinish(asset.metadata.finish ?? '')
  const roughness = parseUnitNumber(asset.metadata.roughness)
  let catalogueFolder: string | undefined
  if (typeof asset.metadata.catalogueFolder === 'string') {
    try { catalogueFolder = normalizeMaterialFolder(asset.metadata.catalogueFolder) } catch { /* Use the default hierarchy. */ }
  }

  return {
    category,
    ...(catalogueCategory && { catalogueCategory }),
    ...(catalogueFolder !== undefined && { catalogueFolder }),
    collection: normalizeMaterialLabel(asset.metadata.collection || asset.collection) || (surfaceCategory ? undefined : 'Portal uploads'),
    colourFamily: asset.metadata.colourFamily || undefined,
    finish,
    id: asset.bundledMaterialId ?? `portal-material-${asset.id}`,
    manufacturer: normalizeMaterialLabel(asset.metadata.brand) || asset.manufacturer.name,
    materialType: asset.metadata.materialType || category,
    ...(originalTextureUrls && Object.keys(originalTextureUrls).length > 0 && { originalTextureUrls }),
    pbr: {
      ...pbrTextures,
      proceduralVariation: materialVariationFromMetadata(asset.metadata),
      baseColor,
      displacementScale: parseMappingNumber(asset.metadata.displacementScale, 0, .05) ?? .003,
      imageBasedLighting: asset.metadata.imageBasedLighting === 'true',
      metalness: parseUnitNumber(asset.metadata.metalness) ?? 0,
      normalStrength: parseMappingNumber(asset.metadata.normalStrength, 0, 3),
      normalFlipY: asset.metadata.normalFlipY === 'true',
      realWorldHeightMeters: parsePositiveNumber(
        asset.metadata.realWorldHeightMeters,
      ),
      realWorldWidthMeters: parsePositiveNumber(asset.metadata.realWorldWidthMeters),
      repeatX: parsePositiveNumber(asset.metadata.repeatX),
      repeatY: parsePositiveNumber(asset.metadata.repeatY),
      rotation: parseMappingNumber(asset.metadata.rotation, -Infinity),
      roughness: roughness ?? 0.7,
    },
    productName: asset.metadata.productName || 'Uploaded material',
    productUrl: asset.metadata.productUrl || undefined,
    sku: asset.metadata.sku || undefined,
    tags: readPortalTags(asset.metadata.tags),
  }
}

function readPortalTags(tags: string | undefined) {
  return tags?.split(',').map(tag => tag.trim()).filter(Boolean)
}

function portalAssetToModel(asset: PortalCatalogAsset): ModelDefinition | null {
  const processedModelUrl =
    asset.conversion?.status === 'complete' || asset.conversion?.status === 'partial'
      ? findProcessedFile(asset, 'model')
      : undefined
  const modelUrl = processedModelUrl ?? findOriginalFile(asset, 'model')

  if (!modelUrl) {
    return null
  }

  const metadataWidth = parsePositiveNumber(asset.metadata.width)
  const metadataDepth = parsePositiveNumber(asset.metadata.depth)
  const metadataHeight = parsePositiveNumber(asset.metadata.height)
  const hasManualDimensions = Boolean(
    metadataWidth || metadataDepth || metadataHeight,
  )
  const objectType = normalizeModelObjectType(
    asset.metadata.objectType || asset.metadata.modelBehavior,
  )
  const wallMount = normalizeModelWallMount(
    asset.metadata.modelBehavior || objectType,
  )
  const inferredDimensions = asset.inferredDimensions
  const taggedRegions = asset.materialNames ? normalizeArtworkMaterialRegions(discoverHdMaterialRegions(asset.materialNames), objectType) : undefined
  const hasLocalBounds = [
    inferredDimensions?.maxX,
    inferredDimensions?.maxZ,
    inferredDimensions?.minX,
    inferredDimensions?.minZ,
  ].every((value) => Number.isFinite(value))

  return {
    category:
      asset.metadata.category ||
      asset.category ||
      (objectType ? modelObjectTypeCategories[objectType] : undefined) ||
      'Uploaded',
    color: '#64748b',
    depth: metadataDepth ?? asset.inferredDimensions?.depth ?? 1,
    doorLeafCount: asset.metadata.doorLeafCount === '1' ? 1 : asset.metadata.doorLeafCount === '2' ? 2 : undefined,
    height: metadataHeight ?? asset.inferredDimensions?.height ?? 1,
    id: `portal-model-${asset.id}`,
    localBounds: hasLocalBounds
      ? {
          maxX: inferredDimensions!.maxX!,
          maxZ: inferredDimensions!.maxZ!,
          minX: inferredDimensions!.minX!,
          minZ: inferredDimensions!.minZ!,
        }
      : undefined,
    name: asset.metadata.productName || 'Uploaded model',
    normalizeToDimensions: hasManualDimensions,
    // Older stair assets use their established stairs_* regions. New tagged
    // models opt into their own authored slots, including an empty furniture list.
    materialRegions: objectType === 'stairs' && !taggedRegions?.length ? undefined : taggedRegions,
    objectType,
    openingWidth: parsePositiveNumber(asset.metadata.openingWidth),
    placement: !wallMount && (asset.metadata.placement === 'wall-mounted' || asset.metadata.placement === 'ceiling-mounted' || asset.metadata.placement === 'floor')
      ? asset.metadata.placement : undefined,
    previewUrl: findOriginalFile(asset, 'preview'),
    shape: 'box',
    sourceUrl: modelUrl,
    tags: readPortalTags(asset.metadata.tags),
    wallMount,
    width: metadataWidth ?? asset.inferredDimensions?.width ?? 1,
  }
}

export async function loadPortalCatalog(): Promise<RuntimePortalCatalog> {
  const retryDelays = [0, 100, 250, 500, 1_000, 2_000]
  let response: Response | undefined
  let lastError: unknown

  for (const retryDelay of retryDelays) {
    if (retryDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }

    try {
      response = await fetch('/api/portal/catalog')

      if (response.ok) {
        break
      }

      lastError = new Error(
        `Asset catalogue request returned ${response.status}`,
      )
    } catch (error) {
      lastError = error
    }
  }

  if (!response?.ok) {
    throw new Error('Could not load uploaded asset catalogue', {
      cause: lastError,
    })
  }

  const data = (await response.json()) as PortalCatalogResponse
  return createRuntimePortalCatalog(data)
}

/** Shared by the live portal and static, per-house viewer packaging. */
export function createRuntimePortalCatalog(data: PortalCatalogResponse): RuntimePortalCatalog {
  const assets = data.manufacturers.flatMap((group) => group.assets)
  const materials = assets
    .filter((asset) => asset.assetKind === 'material')
    .map(portalMaterialToSurfaceMaterial)
    .filter((material): material is SurfaceMaterialProduct => Boolean(material))
  const models = assets
    .filter((asset) => asset.assetKind === 'model')
    .map(portalAssetToModel)
    .filter((model): model is ModelDefinition => Boolean(model))

  return { materials, models,
    ...(data.catalogueLayout === undefined ? {} : { catalogueLayout: readObjectCatalogue(data.catalogueLayout) }),
    ...(data.materialCatalogue === undefined ? {} : { materialCatalogue: readMaterialCatalogueLayout(data.materialCatalogue) }) }
}
