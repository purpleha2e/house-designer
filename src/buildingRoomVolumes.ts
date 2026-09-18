import type { BuildingRoof } from './roofBuildingGeometry.ts'
import { clipRoofFace, getRoofRenderableOuterFaces, roofBoundsPolygon } from './roofJunctions.ts'
import { buildRoomCeilingEnvelope, type RoomCeilingFace, type RoomRoofSurface } from './roofRoomEnvelope.ts'
import type { RoomRoofCut } from './roofRoomCsg.ts'
import { partitionRoofFacesByRooms, type RoofVertex } from './roofSolidGeometry.ts'
import { getRoofThickness } from './roofThickness.ts'
import type { FloorLevel, Point } from './types.ts'
import { getRenderedWalls } from './wallGeometry.ts'
import { buildRoomSurfaceFloorPolygons } from './wallEngine/roomSurfaceMesh.ts'
import { buildWallTopology } from './wallTopology.ts'
import { footprintPlanes } from './wallEngine/wallRoofClip.ts'

export type BuildingRoomVolumes = {
  cuts: RoomRoofCut[]
  ceilingFaces: RoomCeilingFace[]
  roomPolygonsByFloor: Map<string, Point[][]>
}

/** Build room voids in world coordinates, across every floor and every roof.
 * The void extends through the ceiling space to the highest inner roof skin.
 * This removes other roofs inside that space without cutting the outer skin. */
export function buildBuildingRoomVolumes(floors: FloorLevel[], roofs: BuildingRoof[]): BuildingRoomVolumes {
  const cuts: RoomRoofCut[] = []
  const ceilingFaces: RoomCeilingFace[] = []
  const roomPolygonsByFloor = new Map<string, Point[][]>()
  const orderedFloors = [...floors].sort((a, b) => a.elevation - b.elevation)

  for (const [index, floor] of orderedFloors.entries()) {
    const rooms = buildWallTopology(floor.walls).rooms
    const innerPolygons = buildRoomSurfaceFloorPolygons({
      renderedWalls: getRenderedWalls(floor.walls), rooms,
    })
    const polygons = rooms.map(room => innerPolygons.get(room.signature) ?? room.polygon)
      .filter(polygon => polygon.length >= 3)
    roomPolygonsByFloor.set(floor.id, polygons)
    if (!polygons.length) continue

    // Include the inter-storey slab in the upper room's void. A lower roof
    // must not leave a small fragment inside that slab at the room edge.
    const lowerFloor = orderedFloors[index - 1]
    const bottomY = floor.elevation - (lowerFloor?.slabThickness ?? 0) - 0.01
    const horizontalY = floor.elevation + floor.roomHeight
    // A roof on a higher storey cannot be the ceiling of a room below it.
    // Including it would raise that room's cutter through the intervening
    // floor and remove a lower roof where it meets the upper facade.
    const roofSurfaces: RoomRoofSurface[] = roofs
      .filter(candidate => candidate.floorId === floor.id ||
        candidate.floorTopElevation <= floor.elevation + 0.001)
      .map(candidate => {
        // An eave may project over another room without becoming that room's
        // ceiling. Only the roof's supported interior can cap a room volume.
        const supportPlanes = footprintPlanes(roofBoundsPolygon(
          candidate.resolved, candidate.resolved.support))
        return {
          roofId: candidate.roof.id,
          thickness: 0,
          faces: getRoofRenderableOuterFaces(candidate.resolved).map(face => {
            const inner = face.map(([x, y, z]): RoofVertex =>
              [x, y - getRoofThickness(candidate.roof), z])
            return [...supportPlanes, ([, y]: RoofVertex) => y - bottomY - 0.001]
              .reduce(clipRoofFace, inner)
          }).filter(face => face.length),
        }
      }).filter(surface => surface.faces.length)
    const horizontalFaces = polygons.map(polygon => polygon.map(({ x, y }): RoofVertex => [x, horizontalY, y]))
    // This is the cavity inside the combined roofs, including the space above
    // a horizontal ceiling slab. The slab still renders independently.
    const roofCap = buildRoomCeilingEnvelope(roofSurfaces, polygons)
    const flatCap = partitionRoofFacesByRooms(horizontalFaces,
      roofCap.map(({ face }) => face.map(([x, , z]) => ({ x, y: z })))).outside
    const cap: RoomCeilingFace[] = [
      ...roofCap,
      ...flatCap.map(face => ({ roofId: '', face })),
    ]

    ceilingFaces.push(...cap.filter(piece => piece.roofId))
    cuts.push(...cap.map(({ face, roofId }) => ({
      face, thickness: 0, bottomY, floorId: floor.id, roofId, roomVolume: true,
    })))
  }

  // A roof's supported interior extends beyond detected room polygons at
  // junctions and gable ends. Remove panels entering that space as well, but
  // stop at the inner skin so the outer roof and its full thickness survive.
  for (const candidate of roofs) {
    const floor = orderedFloors.find(item => item.id === candidate.floorId)
    if (!floor) continue
    const support = roofBoundsPolygon(candidate.resolved, candidate.resolved.support)
    for (const exterior of getRoofRenderableOuterFaces(candidate.resolved)) {
      const inner = exterior.map(([x, y, z]): RoofVertex =>
        [x, y - getRoofThickness(candidate.roof), z])
      const inside = partitionRoofFacesByRooms([inner], [support]).inside
      cuts.push(...inside.map(face => ({
        face, thickness: 0, bottomY: floor.elevation - 0.01,
        floorId: candidate.floorId, roofId: candidate.roof.id,
      })))
    }
  }

  return { cuts, ceilingFaces, roomPolygonsByFloor }
}
