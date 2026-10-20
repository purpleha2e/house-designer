import { normalizeFloor } from '../modelPlacement.ts'
import type { ModelDefinition } from '../models/modelLibrary.ts'
import type { PublishedHouse } from './viewerProject.ts'

export function prepareViewerFloors(project: PublishedHouse['project'], definitions: ReadonlyMap<string, ModelDefinition>) {
  // Published bakes already contain the saved wall openings. Recomputing their
  // floating-point dimensions on another browser can invalidate an exact cache
  // key even though nobody has edited the house. Unbaked fixtures still migrate.
  return project.floors.map(floor => project.indirectLighting ? floor : normalizeFloor(floor, definitions))
    .sort((a, b) => a.elevation - b.elevation)
}
