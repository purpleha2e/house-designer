import type { FloorLevel, Point } from './types.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'

const STAIR_SLAB_REACH_TOLERANCE_METERS = 0.1

export function getStairOpeningPolygon(
  position: Point,
  rotation: number,
  width: number,
  depth: number,
  scale: number,
) {
  const halfWidth = (width * scale) / 2
  const halfDepth = (depth * scale) / 2
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)

  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map((point) => ({
    x: position.x + point.x * cosine - point.y * sine,
    y: position.y + point.x * sine + point.y * cosine,
  }))
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
        ),
      ]
    })
  })
}
