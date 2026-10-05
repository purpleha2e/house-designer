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
import { getFloorSlabFootprints } from './ceilingSlabFootprint.ts'
import type { FloorAssembly } from './storeyGeometry.ts'
import { ShapeUtils, Vector2 } from 'three'
import {
  intersectSolid, prismSolid, solidBoundaryFaces, subtractSolid, clipSolidPolygon, planeDistance,
  type ConvexSolid, type SolidPlane, type SolidPoint, type SolidFace,
} from './convexSolid.ts'

export type GableWall = { wall: Wall; floorId: string; elevation: number; roomHeight: number }
export type RoofGable = {
  id: string; roofId: string; floorId: string; end: 'minY' | 'maxY' | 'minX' | 'maxX'
  solids: ConvexSolid[]; faces: RoofGableFace[]; walls: GableWall[]
}
export type RoofGableFace = SolidFace & {
  interior: boolean; wall?: Wall; wallSide?: -1 | 1; wallFloorId?: string
  spaceFloorId?: string
  uvs: [number, number][]
}

export function getGableWallClipData(gables: RoofGable[], roofs: BuildingRoof[], floorId: string, _elevation: number) {
  const clippingRoofIds = new Set(roofs.filter(roof => roof.roof.clipsGeometry !== false).map(roof => roof.roof.id))
  const floorGables = gables.filter(gable => clippingRoofIds.has(gable.roofId) && gable.walls.some(source =>
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
    roof.roof.clipsGeometry !== false && (roof.floorId === floorId || roofIds.has(roof.roof.id)))
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
  // A chamfer meeting a pitch break can repeat its corner. A zero-length
  // footprint edge creates a NaN plane and silently removes the whole infill.
  const outline = face.filter((point, i) => {
    const previous = face[(i + face.length - 1) % face.length]
    return Math.hypot(point[0] - previous[0], point[2] - previous[2]) > 1e-8
  }).map(([x, , y]) => ({ x, y }))
  return [...polygonPrismPlanes(outline, bottom, Math.max(...face.map(p => p[1])) + 1).slice(2),
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
  const roomPlans = new Map(floors.map(floor => [floor.id, buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints }).rooms]))
  const independentFloorIds = new Set(floors.filter(floor => floor.floorFootprints?.length).map(floor => floor.id))
  const loftInteriorVolumes = new Map([...independentFloorIds].map(floorId => [floorId,
    rooms.cuts.filter(cut => cut.roomVolume && cut.floorId === floorId && cut.roofId)
      .map(cut => roofUnderPlanes(cut.face.map(([x, y, z]) => [x, y - cut.thickness, z]), cut.bottomY)),
  ]))
  // Preserve the authored wall solid, including its mitres and side joins.
  // Roof closures fill only the remaining volume; existing facades keep their
  // wall selections and fragment finishes on either side of an adjoining roof.
  const wallVolumes = floors.flatMap(floor => {
    const byId = new Map(floor.walls.map(wall => [wall.id, wall]))
    return buildWallBodyPerimeters(floor.walls).wallBodies.flatMap(body => {
      const wall = byId.get(body.wallId)!
      // A loft partition terminates inside the enclosing gable. Letting it
      // replace the gable volume exposes its end finish on the brick facade.
      if (independentFloorIds.has(floor.id) && wall.kind === 'internal') return []
      return ShapeUtils.triangulateShape(body.points.map(p => new Vector2(p.x, p.y)), []).map(indices =>
        polygonPrismPlanes(indices.map(index => body.points[index]), floor.elevation, floor.elevation + wall.height))
    })
  })
  const orderedFloors = [...floors].sort((a, b) => a.elevation - b.elevation)
  const floorAssemblies = assemblies ?? orderedFloors.slice(0, -1).flatMap((floor, index) => {
    const upper = orderedFloors[index + 1], bottom = floor.elevation + floor.roomHeight
    return upper.elevation > bottom + 1e-6
      ? [{ bottom, top: upper.elevation, footprints: getFloorSlabFootprints(upper) }] : []
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
    const joinedEave = resolved.connections.some(connection => connection.state === 'joined' &&
      roofs.some(other => other.roof.id === connection.targetRoofId && other.resolved.joinedEaveFaces?.length))
    const ends: RoofGable['end'][] = ['minY', 'maxY', ...((roof.asymmetricSides && roof.fitSupportingWalls) || joinedEave ? ['minX', 'maxX'] as const : [])]
    for (const end of ends) {
      const sideInfill = end === 'minX' || end === 'maxX'
      const section = (p: Point) => sideInfill ? { x: p.y, y: p.x } : p
      const sign = end === 'minY' || end === 'minX' ? -1 : 1
      const sectionMin = sideInfill ? bounds.minY : bounds.minX
      const sectionMax = sideInfill ? bounds.maxY : bounds.maxX
      const matching = allWalls.filter(({ wall, elevation, floorId: wallFloorId }) => {
        if (sideInfill && (wallFloorId !== floorId || !candidate.supportingWallIds.includes(wall.id))) return false
        if (wall.kind !== 'external' || elevation > top || elevation + wall.height < bottom - 0.01) return false
        const a = section(getRoofSupportLocalPoint(roof, wall.start)), b = section(getRoofSupportLocalPoint(roof, wall.end))
        return Math.abs(a.y - b.y) < 0.01 &&
          Math.abs((a.y + b.y) / 2 - bounds[end]) <= wall.thickness / 2 + 0.025 &&
          Math.min(a.x, b.x) < sectionMax && Math.max(a.x, b.x) > sectionMin
      }).sort((a, b) => Number(b.floorId === floorId) - Number(a.floorId === floorId) || b.wall.thickness - a.wall.thickness)
      const support = matching[0]
      if (sideInfill && !support) continue
      const thickness = support?.wall.thickness ?? 0.3
      const center = support ? (section(getRoofSupportLocalPoint(roof, support.wall.start)).y +
        section(getRoofSupportLocalPoint(roof, support.wall.end)).y) / 2 : bounds[end] - sign * thickness / 2
      const polygon = [
        { x: sectionMin, y: center - thickness / 2 }, { x: sectionMax, y: center - thickness / 2 },
        { x: sectionMax, y: center + thickness / 2 }, { x: sectionMin, y: center + thickness / 2 },
      ].map(point => getRoofWorldPointFromLocal(roof, section(point)))
      const id = `${roof.id}:${end}`
      const blank = prismSolid(polygon, bottom, top + 0.01, id)
      const outer = getRoofWorldPointFromLocal(roof, section({ x: 0, y: center + sign * thickness / 2 }))
      const normal = sideInfill ? { x: sign * Math.cos(roof.rotation), y: -sign * Math.sin(roof.rotation) }
        : { x: sign * Math.sin(roof.rotation), y: sign * Math.cos(roof.rotation) }
      // Test the end boundary against the adjoining space, then carry that
      // opening through the gable's thickness. Simply subtracting overlapping
      // roof footprints leaves two internal gables at a flush end-to-end join.
      const atEnd = ([a, b, c, d]: SolidPlane): SolidPlane => {
        const along = a * normal.x + c * normal.y
        const offset = outer.x * normal.x + outer.y * normal.y + 1e-6
        return [a - along * normal.x, b, c - along * normal.y, d + along * offset]
      }
      const blanks = sideInfill ? matching.map(source => intersection(blank,
        polygonPrismPlanes(wallFootprint(source.wall, source.wall.thickness / 2), bottom, top + 0.01), id))
        .filter((solid): solid is ConvexSolid => Boolean(solid)) : [blank]
      let solids = blanks.flatMap(base => roofFaces.flatMap(face => {
        const piece = intersection(base, roofUnderPlanes(face, bottom), id)
        return piece ? [piece] : []
      }))
      // Suppress any roof end within the supported space of another roof.
      // Overhangs do not turn an exterior end into an interior partition.
      for (const other of roofSurfaces) {
        if (other.candidate.roof.id === roof.id) continue
        const joinedEnd = !sideInfill && resolved.connections.some(connection => connection.state === 'joined' &&
          connection.end === (end === 'minY' ? 'ridgeStart' : 'ridgeEnd') &&
          connection.targetRoofId === other.candidate.roof.id)
        if (other.candidate.roof.clipsGeometry === false && !joinedEnd) continue
        // An overhang does not consume the wall below surviving incoming
        // tiles. Keep that low infill; only the supported attic is a void.
        const footprint = polygonPrismPlanes(roofBoundsPolygon(other.candidate.resolved,
          other.candidate.resolved.support), -100, 100).slice(2)
        for (const face of other.faces) {
          const planes = [...roofUnderPlanes(face, other.candidate.floorTopElevation + (other.candidate.roof.heightOffset ?? 0)), ...footprint].map(atEnd)
          solids = solids.flatMap(solid => subtractSolid(solid, planes, id))
        }
      }
      // A drawn external wall is intentional, including one that
      // divides two joined roof spaces. It uses the highest ceiling there.
      for (const source of matching) {
        const footprint = wallFootprint(source.wall, source.wall.thickness / 2)
        const joinsThisEnd = (other: BuildingRoof) => sideInfill
          ? Boolean(other.resolved.joinedEaveFaces?.length) && resolved.connections.some(connection =>
            connection.state === 'joined' && connection.targetRoofId === other.roof.id)
          : (
          resolved.connections.some(connection => connection.state === 'joined' &&
            connection.end === (end === 'minY' ? 'ridgeStart' : 'ridgeEnd') && connection.targetRoofId === other.roof.id) ||
          other.resolved.connections.some(connection => connection.state === 'joined' && connection.targetRoofId === roof.id))
        const ceiling = buildRoomCeilingEnvelope(roofSurfaces.filter(other => (other.candidate.roof.clipsGeometry !== false ||
          joinsThisEnd(other.candidate)) &&
          (other.candidate.floorId === source.floorId || other.candidate.floorTopElevation <= source.elevation + 0.001)).map(other => {
          const surface = { roofId: other.candidate.roof.id, faces: other.faces, thickness: 0 }
          if (!joinsThisEnd(other.candidate) || sideInfill) return surface
          // The receiving gable owns its facade plane. Carrying this return
          // out beneath the receiver's overhang makes a brick tooth project
          // in front of it, even though the incoming tiles stop at the join.
          const supportPlanes = footprintPlanes(roofBoundsPolygon(other.candidate.resolved, other.candidate.resolved.support))
          return { ...surface, faces: surface.faces.map(face => supportPlanes.reduce(clipRoofFace, face)).filter(face => face.length) }
        }), [footprint])
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
        // A loft slab reaches the outside facade; its outline is not an inset
        // room enclosure that can replace the existing gable. Actual roof
        // joins, authored walls, openings and floor assemblies own their cuts.
        if (independentFloorIds.has(cut.floorId)) continue
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
      // An independent slab can also extend outside or above a lower roof.
      // Only space beneath an enclosing roof is the loft's interior; exposed
      // gable faces beside stepped roofs must retain their exterior finish.
      const loftVolumes = floor ? loftInteriorVolumes.get(floor.id) : undefined
      const insideLoft = !loftVolumes || loftVolumes.some(planes => planes.length > 0 &&
        planes.every(plane => planeDistance(plane, [sample.x, midpoint[1], sample.y]) >= -1e-6))
      const interior = !!floor && insideLoft && (roomPlans.get(floor.id) ?? []).some(room => contains(room.polygon, sample))
      const source = gable.walls.find(source => source.floorId === (interior ? floor?.id : gable.floorId)) ?? gable.walls[0]
      const wall = source?.wall
      const isVerticalWallSkin = Boolean(wall) && Math.abs(normal[1]) < 1e-7
      const side: -1 | 1 = wall && normal[0] * -(wall.end.y - wall.start.y) + normal[2] * (wall.end.x - wall.start.x) < 0 ? -1 : 1
      // Returns have a different tangent from their source wall. Project along
      // each vertical skin so brick widths do not collapse to a single texel.
      const horizontalLength = Math.hypot(normal[0], normal[2])
      const tangent = horizontalLength > 1e-7 ? { x: normal[2] / horizontalLength, y: -normal[0] / horizontalLength } : null
      if (tangent && (tangent.x < -1e-6 || (Math.abs(tangent.x) <= 1e-6 && tangent.y < -1e-6))) {
        tangent.x *= -1; tangent.y *= -1
      }
      return { ...face, interior, wall, wallSide: isVerticalWallSkin ? side : undefined, wallFloorId: source?.floorId, spaceFloorId: floor?.id,
        uvs: face.points.map(([x, y, z]) => [isVerticalWallSkin && tangent ? x * tangent.x + z * tangent.y
          : wall ? getCanonicalWallUvDistance(wall, { x, y: z }) : x + z, y]),
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
