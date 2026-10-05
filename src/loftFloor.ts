import type { FloorLevel, Point } from './types.ts'
import { buildCeilingSlabFootprints } from './ceilingSlabFootprint.ts'
import { getFloorEnvelopeWalls } from './floorEnvelope.ts'
import { buildWallTopology } from './wallTopology.ts'

function getLoftFootprints(source: FloorLevel): Point[][] {
  if (source.floorFootprints?.length) return source.floorFootprints
  if (!buildWallTopology(source.walls).rooms.length) return []
  return buildCeilingSlabFootprints(getFloorEnvelopeWalls(source.walls))
}

export function getAddLoftFloorDisabledReason(floors: FloorLevel[], sourceId: string): string | null {
  const source = floors.find(floor => floor.id === sourceId)
  if (!source) return 'Select a level first.'
  if (floors.some(floor => floor.elevation > source.elevation)) {
    return 'This level already has a floor above it.'
  }
  if (!getLoftFootprints(source).length) return 'Enclose the level with walls first.'
  return null
}

/** A new editable level, with its own boundary and no copied walls or roof. */
export function createCeilingLoftFloor(floors: FloorLevel[], sourceId: string, id: string): FloorLevel | null {
  if (getAddLoftFloorDisabledReason(floors, sourceId)) return null
  const source = floors.find(floor => floor.id === sourceId)!
  return {
    id,
    name: `Loft above ${source.name}`,
    elevation: source.elevation + source.roomHeight + source.slabThickness,
    roomHeight: source.roomHeight,
    slabThickness: source.slabThickness,
    ceilingMode: 'open',
    floorFootprints: getLoftFootprints(source).map(ring => ring.map(point => ({ ...point }))),
    walls: [],
    rooms: [],
    roofs: [],
    models: [],
  }
}
