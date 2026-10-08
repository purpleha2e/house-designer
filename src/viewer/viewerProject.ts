import type { FloorLevel, SunPosition, SurfaceMaterialAssignment, SurfaceMaterialProduct, SavedThreeDViewState, ThreeDViewCameraState } from '../types'
import type { ModelDefinition } from '../models/modelLibrary'

export type PublishedHouse = {
  title: string
  startCamera?: ThreeDViewCameraState
  project: {
    activeFloorId?: string
    floors: FloorLevel[]
    modelDefinitions?: ModelDefinition[]
    surfaceAssignments?: SurfaceMaterialAssignment[]
    sunPosition?: SunPosition
    threeDView?: SavedThreeDViewState
  }
  materials: SurfaceMaterialProduct[]
}

export function parsePublishedHouse(value: unknown): PublishedHouse {
  const house = value as Partial<PublishedHouse> | null
  if (!house || typeof house.title !== 'string' || !Array.isArray(house.materials) ||
    !house.project || !Array.isArray(house.project.floors) || !house.project.floors.length ||
    !house.project.floors.every(floor => typeof floor.id === 'string' &&
      typeof floor.name === 'string' && Number.isFinite(floor.elevation) && Array.isArray(floor.walls))) {
    throw new Error('This house could not be loaded. Please ask its owner to publish it again.')
  }
  return house as PublishedHouse
}
