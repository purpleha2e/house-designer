import { getRoofWithExternalWallSupportExtents } from './roofBuildingGeometry.ts'
import { createDormerStructuralAssembly, getAttachedDormerPlacement, getDormerOpeningPolygon } from './dormerPlacement.ts'
import { getRoofThickness } from './roofThickness.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'
import type { FloorLevel, Point } from './types.ts'
import { clipSolidPolygon, prismSolid, subtractSolid } from './convexSolid.ts'
import type { SolidPlane } from './convexSolid.ts'

export type DormerWallContact = {
  wallId: string
  side: -1 | 1
  height: number
  overlap: number
}

export type DormerFloorRecess = {
  modelId: string
  floorId: string
  polygon: Point[]
  roomProbe: Point
}

function insideFloor(point: Point, floor: FloorLevel) {
  // Slab-only lofts have an explicit enclosure; their partition walls are not
  // a closed boundary and must not determine which storey hosts the dormer.
  if (floor.floorFootprints?.length) {
    return floor.floorFootprints.some(ring => {
      let inside = false
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index], b = ring[(index + 1) % ring.length]
        if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
      }
      return inside
    })
  }
  let inside = false
  const external = floor.walls.filter(wall => wall.kind === 'external')
  for (const wall of external.length ? external : floor.walls) {
    const a = wall.start, b = wall.end
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Derived scene openings only: moving/deleting a dormer restores the saved walls. */
export function prepareDormerInteriors(floors: FloorLevel[], definitions: ReadonlyMap<string, ModelDefinition>) {
  const baseElevations = new Map<string, number>()
  const roomClipPlanes = new Map<string, SolidPlane[]>()
  const wallContacts = new Map<string, DormerWallContact[]>()
  const floorRecesses: DormerFloorRecess[] = []
  const wallJunctionSolids = new Map<string, SolidPlane[][]>()
  const openings = new Map<string, NonNullable<FloorLevel['walls'][number]['openings']>>()
  for (const owner of floors) for (const model of owner.models) {
    const definition = definitions.get(model.modelId)
    const roof = owner.roofs?.map(roof => getRoofWithExternalWallSupportExtents(roof, owner.walls)).find(roof => roof.id === model.roofAttachment?.roofId)
    if (definition?.roofMount !== 'dormer' || !roof || !model.roofAttachment) continue
    const placement = getAttachedDormerPlacement(roof, model.roofAttachment)
    if (!placement) continue
    const mountY = owner.elevation + owner.roomHeight + (roof.heightOffset ?? 0) + placement.surfaceHeight
    const windowDefinition = definitions.get(model.dormerWindowModelId ?? '') ??
      [...definitions.values()].find(candidate => candidate.wallMount === 'window')
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id, windowDefinition,
      windowOpenings: model.dormerWindowOpenings,
      width: model.dormerWidth, height: model.dormerHeight })
    // A roof-mounted front can lie at/outside the eave or just below the loft
    // slab. Find the floor occupied by the recess, not only its mounting point.
    const probe = (depth: number): Point => ({
      x: placement.position.x + Math.sin(placement.rotation) * depth,
      y: placement.position.y - Math.cos(placement.rotation) * depth,
    })
    const ceilingY = mountY + (assembly.wallHeight + assembly.roofRise - getRoofThickness(roof)) * (model.scale ?? 1)
    const floor = floors.filter(candidate => candidate.elevation < ceilingY - 1e-6 &&
      candidate.elevation >= owner.elevation &&
      [0, assembly.depth * (model.scale ?? 1) * 0.25, assembly.depth * (model.scale ?? 1) * 0.75]
        .some(depth => insideFloor(probe(depth), candidate)))
      .sort((a, b) => b.elevation - a.elevation)[0] ?? owner
    baseElevations.set(model.id, floor.elevation)
    const scale = model.scale ?? 1
    const cos = Math.cos(placement.rotation), sin = Math.sin(placement.rotation)
    const local = (p: Point) => ({
      x: cos * (p.x - placement.position.x) + sin * (p.y - placement.position.y),
      z: -sin * (p.x - placement.position.x) + cos * (p.y - placement.position.y),
    })
    // Use the entire aperture, including the triangular valley behind the
    // cheeks. A low, wide dormer's knee wall can intersect only this region.
    const front = assembly.walls[0].thickness / 2 * scale * (model.depthScale ?? 1)
    const footprint = getDormerOpeningPolygon(model, definition, roof, windowDefinition)
      .map((point, index) => ({ ...local(point), ...(index < 2 ? { z: front } : {}) }))
    const footprintPlanes: SolidPlane[] = footprint.map((a, index) => {
      const b = footprint[(index + 1) % footprint.length]
      const dx = b.x - a.x, dz = b.z - a.z
      return [dz, 0, -dx, dx * a.z - dz * a.x]
    })
    const externalRoomPlanes: SolidPlane[] = []
    for (const wall of floor.walls) {
      // The loft's eaves wall may also cross the recess when its front is
      // outside the footprint. Preserve the roof owner's supporting facade.
      if (wall.kind !== 'internal' && floor.id === owner.id) continue
      const a = local(wall.start), b = local(wall.end)
      const dx = b.x - a.x, dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      if (length < 1e-6) continue
      const ux = dx / length, uz = dz / length
      const halfThickness = wall.thickness / 2
      // Intersect the wall solid's footprint, including its thickness. Centre
      // lines alone miss walls straddling the dormer's front or rear boundary.
      let intersection = [[0, -halfThickness], [length, -halfThickness],
        [length, halfThickness], [0, halfThickness]].map(([along, across]): [number, number, number] =>
        [a.x + ux * along - uz * across, 0, a.z + uz * along + ux * across])
      for (const plane of footprintPlanes) {
        intersection = clipSolidPolygon(intersection, plane)
        if (!intersection.length) break
      }
      if (!intersection.length) continue
      const distances = intersection.map(([x, , z]) => (x - a.x) * ux + (z - a.z) * uz)
      const start = Math.max(0, Math.min(...distances)), end = Math.min(length, Math.max(...distances))
      if (end - start < 1e-6) continue
      // Existing wall owns the visible surface outside the derived opening.
      // Supply its remaining solid to trim coincident dormer end faces, while
      // retaining the portion of each return that is exposed inside the opening.
      const wallSolid = (from: number, to: number, bottom: number, top: number) => prismSolid(
        [[from, -halfThickness], [to, -halfThickness], [to, halfThickness], [from, halfThickness]]
          .map(([along, across]) => ({
            x: (a.x + ux * along - uz * across) / (scale * (model.widthScale ?? 1)),
            y: (a.z + uz * along + ux * across) / (scale * (model.depthScale ?? 1)),
          })),
        (floor.elevation + bottom - mountY) / scale, (floor.elevation + top - mountY) / scale, 'host-wall')
      let remainingWall = [[0, start], [end, length]].filter(([from, to]) => to - from > 1e-6)
        .map(([from, to]) => wallSolid(from, to, 0, wall.height))
      for (const opening of wall.openings ?? []) {
        const cutter = wallSolid(opening.center - opening.width / 2, opening.center + opening.width / 2,
          opening.bottom, opening.bottom + opening.height)
        remainingWall = remainingWall.flatMap(solid => subtractSolid(solid, cutter.planes, 'opening'))
      }
      wallJunctionSolids.set(model.id, [...(wallJunctionSolids.get(model.id) ?? []), ...remainingWall.map(solid => solid.planes)])
      // The finish facing the loft, independent of the wall's endpoint order.
      const side: -1 | 1 = (Math.abs(dx) > 1e-6 ? -dx : dz * a.x) < 0 ? -1 : 1
      if (wall.kind === 'internal') wallContacts.set(model.id, [...(wallContacts.get(model.id) ?? []), {
        wallId: wall.id, side, height: wall.height, overlap: end - start,
      }])
      // Model-space plane pointing into the room, at the inner face of the
      // knee wall. It also handles rotated dormers and angled knee walls.
      const nx = Math.sign(dx) * dz / length, nz = -Math.abs(dx) / length
      const roomPlane: SolidPlane = [
        nx * scale * (model.widthScale ?? 1), 0,
        nz * scale * (model.depthScale ?? 1),
        -nx * a.x - nz * a.z - wall.thickness / 2,
      ]
      if (Math.abs(dx) > 1e-6) {
        if (wall.kind === 'internal') roomClipPlanes.set(model.id, [...(roomClipPlanes.get(model.id) ?? []), roomPlane])
        else externalRoomPlanes.push(roomPlane)
      }
      const key = `${floor.id}:${wall.id}`
      openings.set(key, [...(openings.get(key) ?? []), {
        id: `${model.id}:dormer-recess`, modelId: model.modelId,
        center: (start + end) / 2, width: end - start,
        bottom: 0, height: wall.height,
      }])
    }
    // A recessed external eaves wall also needs a floor-height front and
    // returns after its opening is cut. An internal knee wall, when present,
    // remains the room boundary; the outer wall must not shorten those returns.
    if (!roomClipPlanes.has(model.id) && externalRoomPlanes.length) {
      roomClipPlanes.set(model.id, externalRoomPlanes)
    }
    const boundaries = roomClipPlanes.get(model.id)
    if (boundaries?.length) {
      const widthScale = model.widthScale ?? 1, depthScale = model.depthScale ?? 1
      const halfWidth = Math.abs(assembly.walls[0].start.x)
      // Extend through the wall centre lines so the finish meets the enclosure,
      // and slightly into the room so it joins its existing floor without a slit.
      let patch: [number, number, number][] = [
        [-halfWidth, 0, 0], [halfWidth, 0, 0],
        [halfWidth, 0, -assembly.depth / depthScale], [-halfWidth, 0, -assembly.depth / depthScale],
      ]
      for (const plane of boundaries) patch = clipSolidPolygon(patch,
        [-plane[0], 0, -plane[2], -plane[3] + 0.02])
      const world = (x: number, z: number): Point => ({
        x: placement.position.x + scale * (cos * x * widthScale - sin * z * depthScale),
        y: placement.position.y + scale * (sin * x * widthScale + cos * z * depthScale),
      })
      const rear = Math.min(...boundaries.map(p => -p[3] / p[2]))
      if (patch.length >= 3) floorRecesses.push({ modelId: model.id, floorId: floor.id,
        polygon: patch.map(([x, , z]) => world(x, z)),
        roomProbe: world(0, rear - 0.05 / (scale * depthScale)),
      })
    }
  }
  return {
    baseElevations,
    roomClipPlanes,
    wallContacts,
    floorRecesses,
    wallJunctionSolids,
    floors: openings.size ? floors.map(floor => ({ ...floor, walls: floor.walls.map(wall => {
      const extra = openings.get(`${floor.id}:${wall.id}`)
      return extra ? { ...wall, openings: [...(wall.openings ?? []), ...extra] } : wall
    }) })) : floors,
  }
}
