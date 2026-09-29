import type { ModelDefinition } from './modelLibrary'

export type ModelLibrarySection = 'objects' | 'openings'

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
