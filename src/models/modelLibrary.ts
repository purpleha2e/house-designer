export type ModelDefinition = {
  id: string
  name: string
  category: string
  color: string
  height: number
  sourceUrl?: string
  shape: 'box' | 'round'
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

const discoveredModels: ModelDefinition[] = Object.entries(discoveredModelFiles).map(
  ([path, sourceUrl], index) => {
    const fileName = path.split('/').pop() ?? `model-${index + 1}.glb`

    return {
      id: getModelId(fileName) || `model-${index + 1}`,
      name: formatModelName(fileName),
      category: 'Imported',
      color: '#2563eb',
      height: 1,
      sourceUrl: sourceUrl as string,
      shape: 'box',
      width: 1,
      depth: 1,
    }
  },
)

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
  discoveredModels.length > 0 ? discoveredModels : fallbackModels

export const modelsById = new Map(
  modelLibrary.map((model) => [model.id, model]),
)
