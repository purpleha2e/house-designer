import type { ModelDefinition } from './modelLibrary'
import type { FloorLevel } from '../types'

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
      const saved = registered.get(placement.modelId)
      if (saved) {
        const current = definitions.get(saved.id)
        // Older saved houses predate discovery of hd_ slots. Enrich only missing
        // metadata for the identical asset; preserve authored saved definitions.
        definitions.set(saved.id, saved.materialRegions === undefined && current?.sourceUrl === saved.sourceUrl && current?.materialRegions
          ? { ...saved, materialRegions: current.materialRegions } : saved)
      }
    }
  }
  return [...definitions.values()]
}
