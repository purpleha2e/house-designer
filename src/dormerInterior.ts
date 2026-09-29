import { getRoofWithExternalWallSupportExtents } from './roofBuildingGeometry.ts'
import { createDormerStructuralAssembly, getAttachedDormerPlacement } from './dormerPlacement.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'
import type { FloorLevel, Point } from './types.ts'
import type { SolidPlane } from './convexSolid.ts'

function insideFloor(point: Point, floor: FloorLevel) {
  let inside = false
  for (const wall of floor.walls.filter(wall => wall.kind === 'external')) {
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
  const openings = new Map<string, NonNullable<FloorLevel['walls'][number]['openings']>>()
  for (const owner of floors) for (const model of owner.models) {
    const definition = definitions.get(model.modelId)
    const roof = owner.roofs?.map(roof => getRoofWithExternalWallSupportExtents(roof, owner.walls)).find(roof => roof.id === model.roofAttachment?.roofId)
    if (definition?.roofMount !== 'dormer' || !roof || !model.roofAttachment) continue
    const placement = getAttachedDormerPlacement(roof, model.roofAttachment)
    if (!placement) continue
    const mountY = owner.elevation + owner.roomHeight + (roof.heightOffset ?? 0) + placement.surfaceHeight
    const floor = floors.filter(candidate => candidate.elevation <= mountY &&
      candidate.elevation >= owner.elevation && insideFloor(placement.position, candidate))
      .sort((a, b) => b.elevation - a.elevation)[0] ?? owner
    baseElevations.set(model.id, floor.elevation)
    const windowDefinition = definitions.get(model.dormerWindowModelId ?? '') ??
      [...definitions.values()].find(candidate => candidate.wallMount === 'window')
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id, windowDefinition })
    const scale = model.scale ?? 1
    const halfWidth = definition.width * scale * (model.widthScale ?? 1) / 2
    const slope = Math.tan(roof.pitchDegrees * Math.PI / 180)
    const back = -(assembly.wallHeight + assembly.roofRise - definition.width / 2 * slope) * scale / slope
    const cos = Math.cos(placement.rotation), sin = Math.sin(placement.rotation)
    const local = (p: Point) => ({
      x: cos * (p.x - placement.position.x) + sin * (p.y - placement.position.y),
      z: -sin * (p.x - placement.position.x) + cos * (p.y - placement.position.y),
    })
    for (const wall of floor.walls) {
      if (wall.kind !== 'internal') continue
      const a = local(wall.start), b = local(wall.end)
      const dx = b.x - a.x, dz = b.z - a.z
      // Only transverse knee walls obstruct the recess; preserve partitions
      // running alongside it and walls beyond the roof junction.
      if (Math.abs(dx) < Math.abs(dz) || Math.abs(dx) < 1e-6) continue
      let lo = Math.max(0, Math.min((-halfWidth - a.x) / dx, (halfWidth - a.x) / dx))
      let hi = Math.min(1, Math.max((-halfWidth - a.x) / dx, (halfWidth - a.x) / dx))
      if (Math.abs(dz) > 1e-6) {
        lo = Math.max(lo, Math.min((back - a.z) / dz, -a.z / dz))
        hi = Math.min(hi, Math.max((back - a.z) / dz, -a.z / dz))
      } else if (a.z < back || a.z > 0) continue
      if (hi <= lo) continue
      const length = Math.hypot(dx, dz)
      // Model-space plane pointing into the room, at the inner face of the
      // knee wall. It also handles rotated dormers and angled knee walls.
      const nx = Math.sign(dx) * dz / length, nz = -Math.abs(dx) / length
      const roomPlane: SolidPlane = [
        nx * scale * (model.widthScale ?? 1), 0,
        nz * scale * (model.depthScale ?? 1),
        -nx * a.x - nz * a.z - wall.thickness / 2,
      ]
      roomClipPlanes.set(model.id, [...(roomClipPlanes.get(model.id) ?? []), roomPlane])
      const key = `${floor.id}:${wall.id}`
      openings.set(key, [...(openings.get(key) ?? []), {
        id: `${model.id}:dormer-recess`, modelId: model.modelId,
        center: (lo + hi) * length / 2, width: (hi - lo) * length,
        bottom: 0, height: wall.height,
      }])
    }
  }
  return {
    baseElevations,
    roomClipPlanes,
    floors: openings.size ? floors.map(floor => ({ ...floor, walls: floor.walls.map(wall => {
      const extra = openings.get(`${floor.id}:${wall.id}`)
      return extra ? { ...wall, openings: [...(wall.openings ?? []), ...extra] } : wall
    }) })) : floors,
  }
}
