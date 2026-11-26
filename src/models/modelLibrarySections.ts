import type { ModelDefinition, ModelObjectType } from './modelLibrary'

export type ModelLibrarySection = 'objects' | 'openings'
export type ModelLibraryRoot = 'public' | 'mine'

const modelTypeLabels: Partial<Record<ModelObjectType, string>> = {
  appliance: 'Appliances', bathroom: 'Bathroom', decor: 'Decoration', 'dormer-window': 'Dormers',
  'exterior-door': 'Exterior doors', furniture: 'Furniture', 'interior-door': 'Interior doors',
  kitchen: 'Kitchen', lighting: 'Lighting', 'patio-door': 'Patio doors', stairs: 'Stairs',
  structural: 'Structural', window: 'Windows',
}

export function isOpeningModel(model: ModelDefinition) {
  return Boolean(model.wallMount || model.roofMount) ||
    model.objectType === 'dormer-window' ||
    model.objectType === 'window' ||
    model.objectType === 'exterior-door' ||
    model.objectType === 'interior-door' ||
    model.objectType === 'patio-door'
}

export function getModelLibrarySection(
  model: ModelDefinition,
): ModelLibrarySection {
  return isOpeningModel(model) ? 'openings' : 'objects'
}

export function getModelLibraryRoot(model: ModelDefinition): ModelLibraryRoot {
  return model.windowDesign || model.stairDesign || model.pictureFrameDesign || model.kitchenUnitDesign ? 'mine' : 'public'
}

export function getModelTypeLabel(model: ModelDefinition) {
  const type = model.roofMount ? 'dormer-window' : model.wallMount ?? model.objectType
  return (type && modelTypeLabels[type]) ?? (model.category?.trim() || 'Other objects')
}

export function normalizeModelTag(tag: string) {
  return tag.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function getModelTags(model: ModelDefinition): string[] {
  return Array.isArray(model.tags) ? model.tags.filter(tag => typeof tag === 'string') : []
}

export function matchesModelTags(model: ModelDefinition, tags: string[]) {
  const fields = [model.name, model.category ?? '', getModelTypeLabel(model), model.objectType ?? '', ...getModelTags(model)]
    .map(field => ` ${normalizeModelTag(field)} `)
  return tags.every(tag => fields.some(field => field.includes(` ${tag} `)))
}
