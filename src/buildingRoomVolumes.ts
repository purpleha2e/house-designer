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
import { getFloorSlabFootprints } from './ceilingSlabFootprint.ts'
import { getRoofCeilingCutouts } from './roofCeilingClipping.ts'
import { subtractPlanCutouts } from './planarCutouts.ts'
import { ShapeUtils, Vector2 } from 'three'

export type BuildingRoomVolumes = {
  cuts: RoomRoofCut[]
  /** Room space that exterior roof fittings must never occupy. */
  exteriorTrimCuts: RoomRoofCut[]
  ceilingFaces: RoomCeilingFace[]
  roomPolygonsByFloor: Map<string, Point[][]>
}

/** Build room voids in world coordinates, across every floor and every roof.
 * The void extends through the ceiling space to the highest inner roof skin.
 * This removes other roofs inside that space without cutting the outer skin. */
export function buildBuildingRoomVolumes(floors: FloorLevel[], roofs: BuildingRoof[]): BuildingRoomVolumes {
  const cuts: RoomRoofCut[] = []
  const exteriorTrimCuts: RoomRoofCut[] = []
  const ceilingFaces: RoomCeilingFace[] = []
  const roomPolygonsByFloor = new Map<string, Point[][]>()
  const orderedFloors = [...floors].sort((a, b) => a.elevation - b.elevation)

  // A floor can consume roof fragments inside the building, but its cutter
  // must stop at the same enclosing roof boundary as the rendered slab.
  // An untrimmed footprint cuts a horizontal slot through a loft's roof.
  for (let index = 1; index < orderedFloors.length; index++) {
    const lower = orderedFloors[index - 1]
    const upper = orderedFloors[index]
    const bottomY = lower.elevation + lower.roomHeight
    if (upper.elevation <= bottomY + 1e-6) continue
    const footprints = getFloorSlabFootprints(upper, lower)
    const roofCutouts = getRoofCeilingCutouts(roofs.map(roof => roof.resolved), upper.elevation)
    const triangles = footprints.flatMap(footprint => subtractPlanCutouts(footprint, roofCutouts))
      .flatMap(({ outline, holes }) => {
        const points = [outline, ...holes].flat()
        return ShapeUtils.triangulateShape(outline.map(p => new Vector2(p.x, p.y)),
          holes.map(hole => hole.map(p => new Vector2(p.x, p.y))))
          .map(indices => indices.map(index => points[index]))
      })
    cuts.push(...triangles.map(footprint => ({
      face: footprint.map(({ x, y }): RoofVertex => [x, upper.elevation, y]),
      thickness: 0,
      bottomY,
      floorId: upper.id,
      floorAssembly: true,
    })))
  }

  for (const [index, floor] of orderedFloors.entries()) {
    const rooms = buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints }).rooms
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
    // A fitted roof already bounds this floor's walls and ceilings. Its room
    // void must stop at the same inner skin, even when general clipping is off;
    // a flat fallback can otherwise cut through a lower joined roof at a valley.
    const roofSurfaces: RoomRoofSurface[] = roofs
      .filter(candidate => candidate.floorId === floor.id || candidate.floorTopElevation <= floor.elevation + 0.001)
      .map(candidate => {
        const support = roofBoundsPolygon(candidate.resolved, candidate.resolved.support)
        return {
          roofId: candidate.roof.id,
          thickness: 0,
          faces: getRoofRenderableOuterFaces(candidate.resolved).flatMap(face => {
            const inner = face.map(([x, y, z]): RoofVertex =>
              [x, y - getRoofThickness(candidate.roof), z])
            // Keep coverage below the room base too. Dropping it lets the
            // horizontal fallback create a void outside the roof at the eaves.
            const { inside, outside } = partitionRoofFacesByRooms([inner], [support])
            // An overhang above a room must not raise its void through an
            // adjoining roof. Below the ceiling, however, it encloses actual
            // room space: trim its boxed eave to this inner skin as well.
            return [...inside, ...outside.map(face => clipRoofFace(face,
              ([, y]) => Math.min(horizontalY, candidate.floorTopElevation) - y))
              .filter(face => face.length)]
          }).map(face => candidate.roof.clipsGeometry === false && !candidate.roof.fitSupportingWalls
            // A passive roof can enclose space above the declared ceiling,
            // but cannot lower a room's ceiling to protect its own intrusion.
            ? clipRoofFace(face, ([, y]) => y - horizontalY) : face)
            .filter(face => face.length),
        }
      }).filter(surface => surface.faces.length)
    // Rooms can have re-entrant corners. The roof subtraction and solid cutter
    // use convex faces; feeding a whole concave room loses narrow hall returns.
    const horizontalFaces = polygons.flatMap(polygon =>
      ShapeUtils.triangulateShape(polygon.map(({ x, y }) => new Vector2(x, y)), [])
        .map(indices => indices.map(index => {
          const { x, y } = polygon[index]
          return [x, horizontalY, y] as RoofVertex
        })))
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
    // Exterior fittings cannot become a ceiling boundary. Include the full
    // horizontal room as well as any vaulted space above it, independently of
    // the roof's wall-clipping and fitting options. Structural roof skins still
    // use the inner roof envelope in `cuts` so joined valleys remain intact.
    const exteriorTrimCap = buildRoomCeilingEnvelope(roofs
      .filter(candidate => candidate.floorId === floor.id || candidate.floorTopElevation <= floor.elevation + 0.001)
      .map(candidate => ({
        roofId: candidate.roof.id,
        thickness: getRoofThickness(candidate.roof),
        faces: getRoofRenderableOuterFaces(candidate.resolved),
      })), polygons)
    exteriorTrimCuts.push(...[...horizontalFaces, ...exteriorTrimCap.map(piece => piece.face)]
      .map(face => ({ face, thickness: 0, bottomY, floorId: floor.id, footprintOverlap: 0.003 })))

    // Room floor polygons stop at wall finishes. A doorway or window is also
    // interior space, and must not leave roof fragments between those polygons.
    for (const wall of floor.walls) {
      const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y
      const length = Math.hypot(dx, dz)
      if (length < 1e-6) continue
      const nx = -dz / length, nz = dx / length
      for (const opening of wall.openings ?? []) {
        const left = Math.max(0, opening.center - opening.width / 2)
        const right = Math.min(length, opening.center + opening.width / 2)
        if (right <= left || opening.height <= 0) continue
        const top = floor.elevation + Math.min(wall.height, opening.bottom + opening.height)
        const halfDepth = wall.thickness / 2 + 0.01
        const face: RoofVertex[] = [[left, -1], [right, -1], [right, 1], [left, 1]].map(([distance, side]) => [
          wall.start.x + dx * distance / length + nx * halfDepth * side, top,
          wall.start.y + dz * distance / length + nz * halfDepth * side,
        ])
        if (!partitionRoofFacesByRooms([face], polygons).inside.length) continue
        const cut: RoomRoofCut = { face, thickness: 0, bottomY: floor.elevation + opening.bottom - 0.01,
          floorId: floor.id, openingVolume: true }
        cuts.push(cut)
        exteriorTrimCuts.push({ ...cut, footprintOverlap: 0.003 })
      }
    }
  }

  // A roof's supported interior extends beyond detected room polygons at
  // junctions and gable ends. Remove panels entering that space as well, but
  // stop at the inner skin so the outer roof and its full thickness survive.
  for (const candidate of roofs) {
    if (candidate.roof.clipsGeometry === false) continue
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

  return { cuts, exteriorTrimCuts, ceilingFaces, roomPolygonsByFloor }
}
