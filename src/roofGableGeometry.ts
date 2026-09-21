import type { FloorLevel, Point, Wall } from './types.ts'
import type { BuildingRoof } from './roofBuildingGeometry.ts'
import { getRoofSupportLocalPoint, getRoofWorldPointFromLocal } from './roofBuildingGeometry.ts'
import { clipRoofFace, getRoofRenderableOuterFaces, roofBoundsPolygon, roofFaceHeight } from './roofJunctions.ts'
import { getRoofThickness } from './roofThickness.ts'
import { buildRoomCeilingEnvelope } from './roofRoomEnvelope.ts'
import type { BuildingRoomVolumes } from './buildingRoomVolumes.ts'
import { getCanonicalWallUvDistance } from './wallEngine/wallUv.ts'
import { getWallPolygon } from './wallGeometry.ts'
import { buildWallTopology } from './wallTopology.ts'
import { buildWallBodyPerimeters } from './wallEngine/wallBodyPerimeter.ts'
import { footprintPlanes } from './wallEngine/wallRoofClip.ts'
import { buildCeilingSlabFootprints } from './ceilingSlabFootprint.ts'
import type { FloorAssembly } from './storeyGeometry.ts'
import { ShapeUtils, Vector2 } from 'three'
import {
  intersectSolid, prismSolid, solidBoundaryFaces, subtractSolid, clipSolidPolygon, planeDistance,
  type ConvexSolid, type SolidPlane, type SolidPoint, type SolidFace,
} from './convexSolid.ts'

export type GableWall = { wall: Wall; floorId: string; elevation: number; roomHeight: number }
export type RoofGable = {
  id: string; roofId: string; floorId: string; end: 'minY' | 'maxY'
  solids: ConvexSolid[]; faces: RoofGableFace[]; walls: GableWall[]
}
export type RoofGableFace = SolidFace & {
  interior: boolean; wall?: Wall; wallSide?: -1 | 1; wallFloorId?: string
  spaceFloorId?: string
  uvs: [number, number][]
}

export function getGableWallClipData(gables: RoofGable[], roofs: BuildingRoof[], floorId: string, _elevation: number) {
  const floorGables = gables.filter(gable => gable.walls.some(source =>
    source.floorId === floorId && (gable.floorId === floorId ||
      source.wall.height > source.roomHeight + 0.001)))
  const walls = floorGables.flatMap(gable => gable.walls.filter(wall => wall.floorId === floorId))
  const roofIds = new Set(floorGables.map(gable => gable.roofId))
  const points = walls.flatMap(({ wall }) => wallFootprint(wall, wall.thickness))
  const bounds = points.length ? [{ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) },
    { x: Math.max(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) },
    { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) },
    { x: Math.min(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) }] : []
  // Only roofs whose gables actually use this floor's walls may height-clip
  // them. Including every lower roof lets a stepped roof on another part of
  // the building erase an unrelated inter-storey facade strip.
  const ceiling = bounds.length ? buildRoomCeilingEnvelope(roofs.filter(roof =>
    roof.floorId === floorId || roofIds.has(roof.roof.id))
    .map(candidate => {
      // Overhangs project past the supported attic. They must not trim a
      // neighbouring facade (including its continuation between storeys).
      const support = footprintPlanes(roofBoundsPolygon(candidate.resolved, candidate.resolved.support))
      return { roofId: candidate.roof.id, faces: getRoofRenderableOuterFaces(candidate.resolved)
        .map(face => support.reduce(clipRoofFace, face)).filter(face => face.length),
        thickness: getRoofThickness(candidate.roof) - 0.005 }
    }), [bounds]) : []
  return { gableWallIds: [...new Set(walls.map(source => source.wall.id))],
    gableCeilingFaces: ceiling.map(item => item.face),
  }
}

export function polygonPrismPlanes(polygon: Point[], bottom: number, top: number) {
  return prismSolid(polygon, bottom, top, '').planes
}
function intersection(solid: ConvexSolid, planes: SolidPlane[], tag: string) {
  let result: ConvexSolid | null = solid
  for (const plane of planes) {
    result = intersectSolid(result, plane, tag)
    if (!result) break
  }
  return result
}
export function roofUnderPlanes(face: SolidPoint[], bottom: number): SolidPlane[] {
  const height = roofFaceHeight(face)
  if (!height) return []
  const h = height({ x: 0, y: 0 })
  return [...polygonPrismPlanes(face.map(([x, , y]) => ({ x, y })), bottom, Math.max(...face.map(p => p[1])) + 1).slice(2),
    [0, 1, 0, -bottom], [height({ x: 1, y: 0 }) - h, -1, height({ x: 0, y: 1 }) - h, h]]
}
function contains(polygon: Point[], point: Point) {
  let inside = false
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  })
  return inside
}
function wallFootprint(wall: Wall, extension = 0) {
  return getWallPolygon({ wall, startExtension: extension, endExtension: extension })
}

/** Roof ends own closed solids across storeys. Joined roof voids suppress
 * automatic interior gables; explicitly drawn external walls are preserved
 * and continue to the combined ceiling. Openings belong to the building, so
 * they cut the gable even when they were authored on a different floor. */
export function buildBuildingRoofGables(floors: FloorLevel[], roofs: BuildingRoof[], rooms: BuildingRoomVolumes,
  assemblies?: Pick<FloorAssembly, 'bottom' | 'top' | 'footprints'>[]): RoofGable[] {
  const allWalls: GableWall[] = floors.flatMap(floor => floor.walls.map(wall => ({
    wall, floorId: floor.id, elevation: floor.elevation, roomHeight: floor.roomHeight,
  })))
  const roomPlans = new Map(floors.map(floor => [floor.id, buildWallTopology(floor.walls).rooms]))
  // Preserve the authored wall solid, including its mitres and side joins.
  // Roof closures fill only the remaining volume; existing facades keep their
  // wall selections and fragment finishes on either side of an adjoining roof.
  const wallVolumes = floors.flatMap(floor => {
    const byId = new Map(floor.walls.map(wall => [wall.id, wall]))
    return buildWallBodyPerimeters(floor.walls).wallBodies.flatMap(body => {
      const wall = byId.get(body.wallId)!
      return ShapeUtils.triangulateShape(body.points.map(p => new Vector2(p.x, p.y)), []).map(indices =>
        polygonPrismPlanes(indices.map(index => body.points[index]), floor.elevation, floor.elevation + wall.height))
    })
  })
  const orderedFloors = [...floors].sort((a, b) => a.elevation - b.elevation)
  const floorAssemblies = assemblies ?? orderedFloors.slice(0, -1).flatMap((floor, index) => {
    const upper = orderedFloors[index + 1], bottom = floor.elevation + floor.roomHeight
    return upper.elevation > bottom + 1e-6
      ? [{ bottom, top: upper.elevation, footprints: buildCeilingSlabFootprints(upper.walls) }] : []
  })
  // The floor assembly owns this entire solid, including facade continuations.
  // Subtract its actual footprint, so gables cannot duplicate the floor band.
  for (const assembly of floorAssemblies) for (const polygon of assembly.footprints) {
    wallVolumes.push(...ShapeUtils.triangulateShape(polygon.map(p => new Vector2(p.x, p.y)), []).map(indices =>
      polygonPrismPlanes(indices.map(index => polygon[index]), assembly.bottom, assembly.top)))
  }
  const roofSurfaces = roofs.map(candidate => ({ candidate,
    faces: getRoofRenderableOuterFaces(candidate.resolved).map(face => face.map(([x, y, z]): SolidPoint =>
      [x, y - getRoofThickness(candidate.roof), z])),
  }))
  const output: RoofGable[] = []
  for (const { candidate, faces: roofFaces } of roofSurfaces) {
    const { roof, floorId, floorTopElevation, resolved } = candidate
    if (roof.type !== 'up-and-over') continue
    const bounds = resolved.support
    const bottom = floorTopElevation + (roof.heightOffset ?? 0)
    const top = Math.max(...roofFaces.flatMap(face => face.map(p => p[1])))
    if (top <= bottom) continue
    for (const end of ['minY', 'maxY'] as const) {
      const sign = end === 'minY' ? -1 : 1
      const matching = allWalls.filter(({ wall, elevation }) => {
        if (wall.kind !== 'external' || elevation > top || elevation + wall.height < bottom - 0.01) return false
        const a = getRoofSupportLocalPoint(roof, wall.start), b = getRoofSupportLocalPoint(roof, wall.end)
        return Math.abs(a.y - b.y) < 0.01 &&
          Math.abs((a.y + b.y) / 2 - bounds[end]) <= wall.thickness / 2 + 0.025 &&
          Math.min(a.x, b.x) < bounds.maxX && Math.max(a.x, b.x) > bounds.minX
      }).sort((a, b) => Number(b.floorId === floorId) - Number(a.floorId === floorId) || b.wall.thickness - a.wall.thickness)
      const support = matching[0]
      const thickness = support?.wall.thickness ?? 0.3
      const center = support ? (getRoofSupportLocalPoint(roof, support.wall.start).y +
        getRoofSupportLocalPoint(roof, support.wall.end).y) / 2 : bounds[end] - sign * thickness / 2
      const polygon = [
        { x: bounds.minX, y: center - thickness / 2 }, { x: bounds.maxX, y: center - thickness / 2 },
        { x: bounds.maxX, y: center + thickness / 2 }, { x: bounds.minX, y: center + thickness / 2 },
      ].map(point => getRoofWorldPointFromLocal(roof, point))
      const id = `${roof.id}:${end}`
      const blank = prismSolid(polygon, bottom, top + 0.01, id)
      const outer = getRoofWorldPointFromLocal(roof, { x: 0, y: center + sign * thickness / 2 })
      const normal = { x: sign * Math.sin(roof.rotation), y: sign * Math.cos(roof.rotation) }
      // Test the end boundary against the adjoining space, then carry that
      // opening through the gable's thickness. Simply subtracting overlapping
      // roof footprints leaves two internal gables at a flush end-to-end join.
      const atEnd = ([a, b, c, d]: SolidPlane): SolidPlane => {
        const along = a * normal.x + c * normal.y
        const offset = outer.x * normal.x + outer.y * normal.y + 1e-6
        return [a - along * normal.x, b, c - along * normal.y, d + along * offset]
      }
      let solids = roofFaces.flatMap(face => {
        const piece = intersection(blank, roofUnderPlanes(face, bottom), id)
        return piece ? [piece] : []
      })
      // Suppress any roof end within the supported space of another roof.
      // Overhangs do not turn an exterior end into an interior partition.
      for (const other of roofSurfaces) {
        if (other.candidate.roof.id === roof.id) continue
        const footprint = polygonPrismPlanes(roofBoundsPolygon(other.candidate.resolved, other.candidate.resolved.support), -100, 100).slice(2)
        for (const face of other.faces) {
          const planes = [...roofUnderPlanes(face, other.candidate.floorTopElevation + (other.candidate.roof.heightOffset ?? 0)), ...footprint].map(atEnd)
          solids = solids.flatMap(solid => subtractSolid(solid, planes, id))
        }
      }
      // A drawn external wall is intentional, including one that
      // divides two joined roof spaces. It uses the highest ceiling there.
      for (const source of matching) {
        const footprint = wallFootprint(source.wall, source.wall.thickness / 2)
        const ceiling = buildRoomCeilingEnvelope(roofSurfaces.filter(other => other.candidate.floorId === source.floorId ||
          other.candidate.floorTopElevation <= source.elevation + 0.001).map(other => ({
          roofId: other.candidate.roof.id, faces: other.faces, thickness: 0,
        })), [footprint])
        const authored = prismSolid(footprint, Math.max(bottom, source.elevation),
          Math.max(top, ...ceiling.flatMap(item => item.face.map(p => p[1]))) + 0.01, id)
        const band = polygonPrismPlanes(polygon, bottom, 100)
        for (const item of ceiling) {
          const piece = intersection(authored, [...band, ...roofUnderPlanes(item.face, Math.max(bottom, source.elevation))], id)
          if (piece) solids.push(piece)
        }
      }
      // Higher rooms can consume a lower gable, but their inset wall boundary
      // leaves the real wall thickness intact. Ignore roof-only support cuts.
      for (const cut of rooms.cuts) {
        if (!cut.roomVolume || !cut.floorId || cut.floorId === floorId || cut.bottomY < bottom - 0.35) continue
        const planes = roofUnderPlanes(cut.face.map(([x, y, z]) => [x, y - cut.thickness, z]), cut.bottomY)
        solids = solids.flatMap(solid => subtractSolid(solid, planes, id))
      }
      for (const source of allWalls) for (const opening of source.wall.openings ?? []) {
        const { wall, elevation } = source
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
        if (length < 1e-6) continue
        const ux = (wall.end.x - wall.start.x) / length, uz = (wall.end.y - wall.start.y) / length
        const openingWall = { ...wall,
          start: { x: wall.start.x + ux * (opening.center - opening.width / 2), y: wall.start.y + uz * (opening.center - opening.width / 2) },
          end: { x: wall.start.x + ux * (opening.center + opening.width / 2), y: wall.start.y + uz * (opening.center + opening.width / 2) },
          thickness: wall.thickness + 0.002,
        }
        const planes = polygonPrismPlanes(wallFootprint(openingWall), elevation + opening.bottom,
          elevation + opening.bottom + opening.height)
        solids = solids.flatMap(solid => subtractSolid(solid, planes, `opening:${wall.id}`))
      }
      for (const planes of wallVolumes) solids = solids.flatMap(solid => subtractSolid(solid, planes, id))
      output.push({ id, roofId: roof.id, floorId, end, solids, faces: [], walls: matching })
    }
  }
  // One owner even when two roof ends share the same intentional partition.
  // Expose only the boundary of their union; internal caps cannot be seen.
  output.sort((a, b) => a.id.localeCompare(b.id))
  const boundaries = solidBoundaryFaces(output.flatMap(gable => gable.solids.map(solid => ({
    ...solid, faces: solid.faces.map(face => ({ ...face, tag: gable.id })),
  }))))
  for (const gable of output) {
    // Floor boundaries divide finishes, not the solid's overall height.
    let boundary = boundaries.filter(face => face.tag === gable.id)
    for (const floor of floors) {
      const plane: SolidPlane = [0, 1, 0, -floor.elevation]
      boundary = boundary.flatMap(face => {
        const parts = [plane, plane.map(value => -value) as SolidPlane].map(p => clipFaceAtFloor(face, p))
        return parts.filter((part): part is SolidFace => Boolean(part))
      })
    }
    gable.faces = boundary.map((face): RoofGableFace => {
      const midpoint = face.points.reduce((sum, p) => sum.map((v, axis) => v + p[axis] / face.points.length) as SolidPoint, [0, 0, 0] as SolidPoint)
      const floor = [...floors].sort((a, b) => b.elevation - a.elevation).find(floor => floor.elevation <= midpoint[1] + 1e-6)
      const normal = face.plane.slice(0, 3).map(value => -value)
      const sample = { x: midpoint[0] + normal[0] * 0.04, y: midpoint[2] + normal[2] * 0.04 }
      const interior = !!floor && (roomPlans.get(floor.id) ?? []).some(room => contains(room.polygon, sample))
      const source = gable.walls.find(source => source.floorId === (interior ? floor?.id : gable.floorId)) ?? gable.walls[0]
      const wall = source?.wall
      const side: -1 | 1 = wall && normal[0] * -(wall.end.y - wall.start.y) + normal[2] * (wall.end.x - wall.start.x) < 0 ? -1 : 1
      return { ...face, interior, wall, wallSide: wall ? side : undefined, wallFloorId: source?.floorId, spaceFloorId: floor?.id,
        uvs: face.points.map(([x, y, z]) => [wall ? getCanonicalWallUvDistance(wall, { x, y: z }) : x + z, y]),
      }
    })
  }
  return output
}

function clipFaceAtFloor(face: SolidFace, plane: SolidPlane): SolidFace | null {
  // Assign a coplanar face once rather than emitting it on both storeys.
  if (face.points.every(point => Math.abs(planeDistance(plane, point)) < 1e-8)) return plane[1] > 0 ? face : null
  const points = clipSolidPolygon(face.points, plane)
  return points.length ? { ...face, points } : null
}
