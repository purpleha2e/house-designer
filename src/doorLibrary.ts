import type { ModelDefinition } from './models/modelLibrary'
import { createParametricObjectLibrary, registerParametricModels } from './parametricObjectLibrary'
import { doorDefinition, validateDoorDesign } from './doorDesign'

const library = createParametricObjectLibrary('house-designer-doors', 'doors', validateDoorDesign, doorDefinition)
export const loadDoorLibrary = library.load
export const removeDoorsFromLibrary = library.remove

export function registerDoorModels(models: ModelDefinition[], replace = false) {
  registerParametricModels(models, replace ? model => Boolean(model.doorDesign) : undefined)
}

export function saveDoorToLibrary(definition: ModelDefinition) {
  return library.save(definition.id, definition.name, definition.doorDesign)
}
