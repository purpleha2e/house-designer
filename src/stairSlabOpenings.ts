import type { FloorLevel, Point } from './types.ts'
import type {
  ModelDefinition,
  ModelHorizontalBounds,
} from './models/modelLibrary.ts'

const STAIR_SLAB_REACH_TOLERANCE_METERS = 0.1

export function getStairOpeningPolygon(
  position: Point,
  rotation: number,
  width: number,
  depth: number,
  scale: number,
  localBounds?: ModelHorizontalBounds,
) {
  const minX = (localBounds?.minX ?? -width / 2) * scale
  const maxX = (localBounds?.maxX ?? width / 2) * scale
  const minZ = (localBounds?.minZ ?? -depth / 2) * scale
  const maxZ = (localBounds?.maxZ ?? depth / 2) * scale
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)

  return [
    { x: minX, y: minZ },
    { x: maxX, y: minZ },
    { x: maxX, y: maxZ },
    { x: minX, y: maxZ },
  ].map((point) => ({
    x: position.x + point.x * cosine - point.y * sine,
    y: position.y + point.x * sine + point.y * cosine,
  }))
}

export function getModelHorizontalBounds(
  definition: ModelDefinition,
): ModelHorizontalBounds | undefined {
  const bounds = definition.localBounds

  if (!bounds) {
    return undefined
  }

  const nativeWidth = bounds.maxX - bounds.minX
  const nativeDepth = bounds.maxZ - bounds.minZ
  const scaleX = definition.normalizeToDimensions
    ? definition.width / Math.max(nativeWidth, 0.0001)
    : 1
  const scaleZ = definition.normalizeToDimensions
    ? definition.depth / Math.max(nativeDepth, 0.0001)
    : 1

  return {
    maxX: bounds.maxX * scaleX,
    maxZ: bounds.maxZ * scaleZ,
    minX: bounds.minX * scaleX,
    minZ: bounds.minZ * scaleZ,
  }
}

export function getStairSlabOpenings(
  lowerFloor: FloorLevel,
  upperFloor: FloorLevel | null,
  floors: FloorLevel[],
  modelDefinitions: ReadonlyMap<string, ModelDefinition>,
) {
  if (!upperFloor) {
    return []
  }

  const slabBottom = lowerFloor.elevation + lowerFloor.roomHeight

  return floors.flatMap((modelFloor) => {
    if (modelFloor.elevation > lowerFloor.elevation + 0.0001) {
      return []
    }

    return modelFloor.models.flatMap((model) => {
      const definition = modelDefinitions.get(model.modelId)

      if (definition?.objectType !== 'stairs') {
        return []
      }

      const scale = model.scale || 1
      const stairTop = modelFloor.elevation + definition.height * scale
      const isOnLowerFloor = modelFloor.id === lowerFloor.id

      if (
        !isOnLowerFloor &&
        stairTop < slabBottom - STAIR_SLAB_REACH_TOLERANCE_METERS
      ) {
        return []
      }

      return [
        getStairOpeningPolygon(
          model.position,
          model.rotation,
          definition.width,
          definition.depth,
          scale,
          getModelHorizontalBounds(definition),
        ),
      ]
    })
  })
}
