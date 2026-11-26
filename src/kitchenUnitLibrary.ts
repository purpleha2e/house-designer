import type { ModelDefinition } from './models/modelLibrary'
import { createParametricObjectLibrary, registerParametricModels } from './parametricObjectLibrary'
import { kitchenUnitDefinition, validateKitchenUnitDesign } from './kitchenUnitDesign'

const library = createParametricObjectLibrary('house-designer-kitchen-units', 'units', validateKitchenUnitDesign, kitchenUnitDefinition)

export const loadKitchenUnitLibrary = library.load
export const removeKitchenUnitsFromLibrary = library.remove

export function registerKitchenUnitModels(models: ModelDefinition[], replace = false) {
  registerParametricModels(models, replace ? model => Boolean(model.kitchenUnitDesign) : undefined)
}

export function saveKitchenUnitToLibrary(definition: ModelDefinition) {
  return library.save(definition.id, definition.name, definition.kitchenUnitDesign)
}
