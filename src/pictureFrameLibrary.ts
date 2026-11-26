import type { ModelDefinition } from './models/modelLibrary'
import { createParametricObjectLibrary, registerParametricModels } from './parametricObjectLibrary'
import { pictureFrameDefinition, validatePictureFrameDesign } from './pictureFrameDesign'

const library = createParametricObjectLibrary('house-designer-picture-frames', 'frames', validatePictureFrameDesign, pictureFrameDefinition)

export const loadPictureFrameLibrary = library.load
export const removePictureFramesFromLibrary = library.remove

export function registerPictureFrameModels(models: ModelDefinition[], replace = false) {
  registerParametricModels(models, replace ? model => Boolean(model.pictureFrameDesign) : undefined)
}

export function savePictureFrameToLibrary(definition: ModelDefinition) {
  return library.save(definition.id, definition.name, definition.pictureFrameDesign)
}
