export type ModelObjectType =
  | 'appliance'
  | 'bathroom'
  | 'decor'
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

export type ModelDefinition = {
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
  openingCenterOffset?: number
  openingWidth?: number
  previewUrl?: string
  normalizeToDimensions?: boolean
  objectType?: ModelObjectType
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
}

const discoveredModels: ModelDefinition[] = Object.entries(discoveredModelFiles).map(
  ([path, sourceUrl], index) => {
    const fileName = path.split('/').pop() ?? `model-${index + 1}.glb`
    const modelId = getModelId(fileName)
    const isWindow = modelId.includes('window')
    const isInteriorDoor = modelId.includes('interior-door')
    const isPatioDoor =
      modelId.includes('patio-door') || modelId.includes('patio-doors')
    const isPatioDoorWithSideLights = isPatioDoor && modelId.includes('side-lights')
    const isOpenInteriorDoor = isInteriorDoor && modelId.includes('open')
    const isThreePaneWindow = isWindow && modelId.includes('three-pane')
    const isStairs = modelId.includes('stairs')

    const baseDefinition: ModelDefinition = {
      id: modelId || `model-${index + 1}`,
      name: formatModelName(fileName),
      category: isPatioDoor || isInteriorDoor ? 'Doors' : isWindow ? 'Windows' : 'Imported',
      color: '#2563eb',
      height: isInteriorDoor ? 2.1 : isPatioDoor ? 2.08 : isWindow ? 1.1 : 1,
      openingWidth: isInteriorDoor ? 0.97 : undefined,
      objectType: isStairs ? 'stairs' : undefined,
      sourceUrl: sourceUrl as string,
      shape: 'box',
      wallMount: isInteriorDoor
        ? 'interior-door'
        : isPatioDoor
          ? 'patio-door'
          : isWindow
            ? 'window'
            : undefined,
      width: isInteriorDoor
        ? isOpenInteriorDoor
          ? 1.14
          : 0.97
        : isPatioDoorWithSideLights
        ? 2.54
        : isPatioDoor
          ? 1.62
          : isThreePaneWindow
            ? 1.64
            : isWindow
              ? 1.09
              : 1,
      depth: isInteriorDoor ? (isOpenInteriorDoor ? 0.84 : 0.13) : isPatioDoor || isWindow ? 0.08 : 1,
    }

    return {
      ...baseDefinition,
      ...modelDefinitionOverrides[baseDefinition.id],
    }
  },
)

const builtInModels: ModelDefinition[] = [
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

export function registerRuntimeModels(models: ModelDefinition[]) {
  modelLibrary.splice(
    0,
    modelLibrary.length,
    ...[
      ...modelLibrary.filter((model) => !model.id.startsWith('portal-model-')),
      ...models,
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
  models.forEach((model) => {
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
