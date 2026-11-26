import type { ModelDefinition } from './modelLibrary'
import type { FloorLevel } from '../types'

const originalModelUrl = (url: string | undefined) => url?.replace(/\/processed\/([^/?#]+)(?=[?#]|$)/, '/$1')

export function withCataloguePlacement(saved: ModelDefinition, current: ModelDefinition | undefined) {
  return saved.id.startsWith('portal-model-') && current?.placement && current.placement !== saved.placement && saved.sourceUrl &&
    originalModelUrl(current.sourceUrl) === originalModelUrl(saved.sourceUrl)
    ? { ...saved, placement: current.placement } : saved
}

/** A house embeds definitions it uses. The public catalogue remains available to browse. */
export function mergeProjectModelDefinitions(catalog: ModelDefinition[], embedded: ModelDefinition[]) {
  const definitions = new Map(catalog.map(model => [model.id, model]))
  for (const saved of embedded) {
    definitions.set(saved.id, withCataloguePlacement(saved, definitions.get(saved.id)))
  }
  return [...definitions.values()]
}

/** A catalogue refresh may remove uploads that a saved house still references. */
export function retainProjectModels(
  catalog: ModelDefinition[],
  floors: Pick<FloorLevel, 'models'>[],
  registered: ReadonlyMap<string, ModelDefinition>,
  preserveSavedDefinitions = false,
): ModelDefinition[] {
  const definitions = new Map(catalog.map(model => [model.id, model]))
  for (const floor of floors) {
    for (const placement of floor.models ?? []) {
      if (!placement.modelId.startsWith('portal-model-') || (!preserveSavedDefinitions && definitions.has(placement.modelId))) continue
      const registeredModel = registered.get(placement.modelId)
      if (registeredModel) {
        const current = definitions.get(registeredModel.id)
        const saved = withCataloguePlacement(registeredModel, current)
        // Enrich older saved definitions with metadata for the identical asset.
        if (!current || current.sourceUrl !== saved.sourceUrl) {
          definitions.set(saved.id, saved)
          continue
        }
        const materialRegions = saved.materialRegions === undefined ? current.materialRegions : undefined
        const tags = saved.tags === undefined ? current.tags : undefined
        definitions.set(saved.id, materialRegions || tags ? {
          ...saved, ...(materialRegions && { materialRegions }), ...(tags && { tags }),
        } : saved)
      }
    }
  }
  return [...definitions.values()]
}
