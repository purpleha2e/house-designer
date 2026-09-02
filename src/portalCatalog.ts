import type { SurfaceCategory, SurfaceFinish, SurfaceMaterialProduct } from './types'
import type { ModelDefinition, ModelObjectType } from './models/modelLibrary'

type PortalCatalogFile = {
  fieldName: string
  url: string
}

type PortalCatalogAsset = {
  assetKind: 'material' | 'model'
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
    width: number
  } | null
  manufacturer: {
    name: string
    slug: string
  }
  metadata: Record<string, string>
  processedFiles?: PortalCatalogFile[]
}

type PortalCatalogGroup = {
  assets: PortalCatalogAsset[]
}

type PortalCatalogResponse = {
  manufacturers: PortalCatalogGroup[]
}

export type RuntimePortalCatalog = {
  materials: SurfaceMaterialProduct[]
  models: ModelDefinition[]
}

const surfaceCategories = new Set<SurfaceCategory>([
  'ceiling',
  'flooring',
  'paint',
  'tile',
  'wall-covering',
  'worktop',
])
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

function normalizeSurfaceCategory(value: string): SurfaceCategory {
  const normalized = normalizeToken(value)

  if (normalized === 'tiles') {
    return 'tile'
  }

  if (normalized === 'wallpaper') {
    return 'wall-covering'
  }

  return surfaceCategories.has(normalized as SurfaceCategory)
    ? (normalized as SurfaceCategory)
    : 'wall-covering'
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
  const baseColorTextureUrl = findProcessedFile(asset, 'baseColor')

  if (asset.conversion?.status !== 'complete' || !baseColorTextureUrl) {
    return null
  }

  const category = normalizeSurfaceCategory(
    asset.metadata.category || asset.category || '',
  )
  const finish = normalizeSurfaceFinish(asset.metadata.finish ?? '')

  return {
    category,
    collection: asset.metadata.collection || asset.collection || 'Portal uploads',
    colourFamily: asset.metadata.colourFamily || undefined,
    finish,
    id: `portal-material-${asset.id}`,
    manufacturer: asset.manufacturer.name,
    materialType: asset.metadata.materialType || category,
    pbr: {
      ambientOcclusionTextureUrl: findProcessedFile(asset, 'ambientOcclusion'),
      baseColorTextureUrl,
      displacementScale: 0.003,
      displacementTextureUrl: findProcessedFile(asset, 'displacement'),
      metalness: 0,
      metalnessTextureUrl: findProcessedFile(asset, 'metalness'),
      normalTextureUrl: findProcessedFile(asset, 'normal'),
      realWorldHeightMeters: parsePositiveNumber(
        asset.metadata.realWorldHeightMeters,
      ),
      realWorldWidthMeters: parsePositiveNumber(asset.metadata.realWorldWidthMeters),
      roughness: 0.7,
      roughnessTextureUrl: findProcessedFile(asset, 'roughness'),
    },
    productName: asset.metadata.productName || 'Uploaded material',
    productUrl: asset.metadata.productUrl || undefined,
    sku: asset.metadata.sku || undefined,
    tags: asset.metadata.tags
      ?.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  }
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

  return {
    category:
      asset.metadata.category ||
      asset.category ||
      (objectType ? modelObjectTypeCategories[objectType] : undefined) ||
      'Uploaded',
    color: '#64748b',
    depth: metadataDepth ?? asset.inferredDimensions?.depth ?? 1,
    height: metadataHeight ?? asset.inferredDimensions?.height ?? 1,
    id: `portal-model-${asset.id}`,
    name: asset.metadata.productName || 'Uploaded model',
    normalizeToDimensions: hasManualDimensions,
    objectType,
    openingWidth: parsePositiveNumber(asset.metadata.openingWidth),
    shape: 'box',
    sourceUrl: modelUrl,
    wallMount,
    width: metadataWidth ?? asset.inferredDimensions?.width ?? 1,
  }
}

export async function loadPortalCatalog(): Promise<RuntimePortalCatalog> {
  const response = await fetch('/api/portal/catalog')

  if (!response.ok) {
    throw new Error('Could not load uploaded asset catalogue')
  }

  const data = (await response.json()) as PortalCatalogResponse
  const assets = data.manufacturers.flatMap((group) => group.assets)
  const materials = assets
    .filter((asset) => asset.assetKind === 'material')
    .map(portalMaterialToSurfaceMaterial)
    .filter((material): material is SurfaceMaterialProduct => Boolean(material))
  const models = assets
    .filter((asset) => asset.assetKind === 'model')
    .map(portalAssetToModel)
    .filter((model): model is ModelDefinition => Boolean(model))

  return { materials, models }
}
