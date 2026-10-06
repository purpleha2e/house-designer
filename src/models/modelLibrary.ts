import type { WindowDesign } from '../windowDesign'

export type ModelObjectType =
  | 'appliance'
  | 'bathroom'
  | 'decor'
  | 'dormer-window'
  | 'exterior-door'
  | 'furniture'
  | 'interior-door'
  | 'kitchen'
  | 'lighting'
  | 'other'
  | 'patio-door'
  | 'stairs'
  | 'structural'
  | 'window'

export type ModelHorizontalBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

export type ModelMaterialRegion = {
  id: string
  label: string
  sourceMaterialNames: string[]
}

export const stairMaterialRegions: ModelMaterialRegion[] = [
  {
    id: 'stairs_steps',
    label: 'Steps',
    sourceMaterialNames: ['stairs_steps'],
  },
  {
    id: 'stairs_woodwork',
    label: 'Wood',
    sourceMaterialNames: [
      'stairs_woodwork',
      'stairs_banister',
      'stairs_spindles',
    ],
  },
]

export type ModelDefinition = {
  windowDesign?: WindowDesign
  id: string
  name: string
  category: string
  color: string
  height: number
  isLight?: boolean
  lightColor?: string
  lightDistance?: number
  lightFalloff?: number
  lightKind?: 'point' | 'spot'
  lightPower?: number
  lightSpread?: number
  localBounds?: ModelHorizontalBounds
  materialRegions?: ModelMaterialRegion[]
  openingCenterOffset?: number
  openingWidth?: number
  previewUrl?: string
  normalizeToDimensions?: boolean
  objectType?: ModelObjectType
  roofMount?: 'dormer'
  wallMount?: 'exterior-door' | 'interior-door' | 'patio-door' | 'window'
  sourceUrl?: string
  shape: 'box' | 'light' | 'round'
  width: number
  depth: number
}

const discoveredModelFiles = import.meta.glob('./assets/*.{glb,gltf}', {
  eager: true,
  query: '?url',
  import: 'default',
})

function formatModelName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getModelId(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const modelDefinitionOverrides: Record<string, Partial<ModelDefinition>> = {
  'window-large-single-pane': {
    name: 'Large Single-pane Window',
    width: 1.8, height: 2, depth: 0.08,
    openingWidth: 1.8, openingCenterOffset: 0, objectType: 'window',
    previewUrl: new URL('./assets/window_large_single_pane.png', import.meta.url).href,
    localBounds: { minX: -0.9, maxX: 0.9, minZ: 0.00018126, maxZ: 0.08018126 },
  },
  'patio-doors-bifold-three-pane-closed': {
    name: 'Three-pane Bifold Doors (Closed)',
    width: 2.4, height: 2.08, depth: 0.091,
    openingWidth: 2.4, openingCenterOffset: 0, objectType: 'patio-door',
    previewUrl: new URL('./assets/patio_doors_bifold_three_pane_closed.png', import.meta.url).href,
    localBounds: { minX: -1.2, maxX: 1.2, minZ: -0.00973227, maxZ: 0.08126772 },
  },
  'patio-doors-bifold-three-pane-open': {
    name: 'Three-pane Bifold Doors (Open)',
    width: 2.4, height: 2.08, depth: 0.80562534,
    openingWidth: 2.4, openingCenterOffset: 0, objectType: 'patio-door',
    previewUrl: new URL('./assets/patio_doors_bifold_three_pane_open.png', import.meta.url).href,
    localBounds: { minX: -1.2, maxX: 1.2, minZ: -0.72435762, maxZ: 0.08126772 },
  },
  'panel-interior-door-closed': {
    depth: 0.19917,
    height: 2.124037,
    openingWidth: 0.975141,
    width: 0.975141,
  },
  'simple-stairs': {
    depth: 2.640001,
    height: 2.377067,
    objectType: 'stairs',
    width: 0.85,
  },
  'simple-floating-stairs-simple-banister': {
    materialRegions: stairMaterialRegions,
  },
}

const discoveredModels: ModelDefinition[] = Object.entries(discoveredModelFiles).map(
  ([path, sourceUrl], index) => {
    const fileName = path.split('/').pop() ?? `model-${index + 1}.glb`
    const modelId = getModelId(fileName)
    const isWindow = modelId.includes('window')
    const isInteriorDoor = modelId.includes('interior-door')
    const isPatioDoor =
      modelId.includes('patio-door') || modelId.includes('patio-doors')
    const isExteriorDoor =
      !isInteriorDoor && !isPatioDoor && modelId.includes('door')
    const isPatioDoorWithSideLights = isPatioDoor && modelId.includes('side-lights')
    const isOpenInteriorDoor = isInteriorDoor && modelId.includes('open')
    const isThreePaneWindow = isWindow && modelId.includes('three-pane')
    const isStairs = modelId.includes('stairs')

    const baseDefinition: ModelDefinition = {
      id: modelId || `model-${index + 1}`,
      name: formatModelName(fileName),
      category:
        isPatioDoor || isInteriorDoor || isExteriorDoor
          ? 'Doors'
          : isWindow
            ? 'Windows'
            : 'Imported',
      color: '#2563eb',
      height:
        isInteriorDoor || isExteriorDoor
          ? 2.1
          : isPatioDoor
            ? 2.08
            : isWindow
              ? 1.1
              : 1,
      openingWidth: isInteriorDoor ? 0.97 : undefined,
      objectType: isStairs ? 'stairs' : undefined,
      sourceUrl: sourceUrl as string,
      shape: 'box',
      wallMount: isInteriorDoor
        ? 'interior-door'
        : isPatioDoor
          ? 'patio-door'
          : isExteriorDoor
            ? 'exterior-door'
            : isWindow
              ? 'window'
              : undefined,
      width: isInteriorDoor
        ? isOpenInteriorDoor
          ? 1.14
          : 0.97
        : isExteriorDoor
          ? 0.97
        : isPatioDoorWithSideLights
        ? 2.54
        : isPatioDoor
          ? 1.62
          : isThreePaneWindow
            ? 1.64
            : isWindow
              ? 1.09
              : 1,
      depth: isInteriorDoor
        ? isOpenInteriorDoor
          ? 0.84
          : 0.13
        : isExteriorDoor || isPatioDoor || isWindow
          ? 0.08
          : 1,
    }

    return {
      ...baseDefinition,
      ...modelDefinitionOverrides[baseDefinition.id],
    }
  },
)

const builtInModels: ModelDefinition[] = [
  {
    id: 'dormer-window',
    name: 'Dormer Window',
    category: 'Windows',
    color: '#e5e7eb',
    depth: 1.35,
    height: 1.35,
    objectType: 'dormer-window',
    roofMount: 'dormer',
    shape: 'box',
    width: 1.25,
  },
  {
    id: 'point-light',
    name: 'Point Light',
    category: 'Lighting',
    color: '#facc15',
    depth: 0.25,
    height: 0.25,
    isLight: true,
    lightColor: '#fff3c4',
    lightDistance: 10,
    lightFalloff: 1.15,
    lightKind: 'point',
    lightPower: 120,
    shape: 'light',
    width: 0.25,
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    category: 'Lighting',
    color: '#fde68a',
    depth: 0.3,
    height: 0.3,
    isLight: true,
    lightColor: '#fff7d6',
    lightDistance: 9,
    lightFalloff: 1.15,
    lightKind: 'spot',
    lightPower: 180,
    lightSpread: 36,
    shape: 'light',
    width: 0.3,
  },
]

const fallbackModels: ModelDefinition[] = [
  {
    id: 'dining-table',
    name: 'Dining Table',
    category: 'Furniture',
    color: '#a16207',
    height: 0.75,
    shape: 'box',
    width: 1.8,
    depth: 0.9,
  },
  {
    id: 'sofa',
    name: 'Sofa',
    category: 'Furniture',
    color: '#2563eb',
    height: 0.8,
    shape: 'box',
    width: 2.1,
    depth: 0.85,
  },
  {
    id: 'bed',
    name: 'Bed',
    category: 'Furniture',
    color: '#7c3aed',
    height: 0.55,
    shape: 'box',
    width: 2,
    depth: 1.5,
  },
  {
    id: 'round-table',
    name: 'Round Table',
    category: 'Furniture',
    color: '#0f766e',
    height: 0.72,
    shape: 'round',
    width: 1,
    depth: 1,
  },
  {
    id: 'kitchen-island',
    name: 'Kitchen Island',
    category: 'Kitchen',
    color: '#475569',
    height: 0.92,
    shape: 'box',
    width: 2.4,
    depth: 0.95,
  },
]

export const modelLibrary =
  discoveredModels.length > 0
    ? [...builtInModels, ...discoveredModels]
    : [...builtInModels, ...fallbackModels]

export const modelsById = new Map(
  modelLibrary.map((model) => [model.id, model]),
)

/** Updating personal windows must not replace the manufacturer's catalog. */
export function registerWindowModels(models: ModelDefinition[], replace = false) {
  const ids = new Set(models.map(m => m.id))
  const removed = modelLibrary.filter(m => ids.has(m.id) || (replace && m.windowDesign))
  removed.forEach(m => modelsById.delete(m.id))
  modelLibrary.splice(0, modelLibrary.length, ...modelLibrary.filter(m => !removed.includes(m)), ...models)
  models.forEach(m => modelsById.set(m.id, m))
}

export function registerRuntimeModels(models: ModelDefinition[]) {
  const mergedModels = models.map((model) => {
    const existingModel = modelsById.get(model.id)

    return {
      ...existingModel,
      ...model,
      materialRegions:
        model.materialRegions ??
        existingModel?.materialRegions ??
        (model.objectType === 'stairs' ? stairMaterialRegions : undefined),
    }
  })
  const mergedModelIds = new Set(mergedModels.map((model) => model.id))

  modelLibrary.splice(
    0,
    modelLibrary.length,
    ...[
      ...modelLibrary.filter(
        (model) =>
          !model.id.startsWith('portal-model-') &&
          !mergedModelIds.has(model.id),
      ),
      ...mergedModels,
    ].sort((firstModel, secondModel) =>
      firstModel.category === secondModel.category
        ? firstModel.name.localeCompare(secondModel.name)
        : firstModel.category.localeCompare(secondModel.category),
    ),
  )
  Array.from(modelsById.keys()).forEach((modelId) => {
    if (modelId.startsWith('portal-model-')) {
      modelsById.delete(modelId)
    }
  })
  mergedModels.forEach((model) => {
    modelsById.set(model.id, model)
  })
}

export function getModelAssetUrl(sourceUrl: string, version = 0) {
  if (version <= 0) {
    return sourceUrl
  }

  const separator = sourceUrl.includes('?') ? '&' : '?'
  return `${sourceUrl}${separator}hdModelRefresh=${version}`
}
