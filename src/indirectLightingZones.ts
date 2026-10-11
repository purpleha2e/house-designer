import { Vector3 } from 'three'
import { indirectContentKey } from './indirectLightingPersistence.ts'
import type { IndirectField, IndirectRegion } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'
import type { FloorLevel, Wall, WallOpening } from './types.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'

export type IndirectZoneChange = { floorId: string; min: number[]; max: number[] }
export type IndirectZoneProbe = { index: number; position: number[]; floorId: string }
export type IndirectZonePlan = { first: number[]; second: number[]; reflections: number[]; reused: number }
export function indirectRegionKey(region: IndirectRegion) {
  return `${region.floorId}:${indirectContentKey(region.polygon)}`
}

/** Restrict incremental geometry updates to authored wall-opening edits. Other
 * edits, including global lighting, structure and finishes, need a full bake. */
export function indirectOpeningChanges(previousRevision: string, revision: string): IndirectZoneChange[] | null {
  try {
    const previous = JSON.parse(previousRevision), current = JSON.parse(revision)
    if (!Array.isArray(previous.floors) || !Array.isArray(current.floors)) return null
    const globals = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'floors' && key !== 'modelAssetVersion'))
    if (indirectContentKey(globals(previous)) !== indirectContentKey(globals(current))) return null
    const oldFloors = new Map<string, FloorLevel>(previous.floors.map((floor: FloorLevel) => [floor.id, floor]))
    if (oldFloors.size !== current.floors.length) return null
    const changes: IndirectZoneChange[] = []
    for (const floor of current.floors as FloorLevel[]) {
      const old = oldFloors.get(floor.id)
      if (!old) return null
      const metadata = (value: FloorLevel) => Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['walls', 'models', 'groundImage', 'name'].includes(key)))
      if (indirectContentKey(metadata(old)) !== indirectContentKey(metadata(floor))) return null
      const walls = new Map(old.walls.map(wall => [wall.id, wall])), editedOpenings = new Set<string>()
      if (walls.size !== floor.walls.length) return null
      for (const wall of floor.walls) {
        const before = walls.get(wall.id)
        if (!before || indirectContentKey({ ...before, openings: undefined }) !== indirectContentKey({ ...wall, openings: undefined })) return null
        const openings = new Map((before.openings ?? []).map(opening => [opening.id, opening]))
        for (const id of new Set([...openings.keys(), ...(wall.openings ?? []).map(opening => opening.id)])) {
          const a = openings.get(id), b = wall.openings?.find(opening => opening.id === id)
          if (indirectContentKey(a) === indirectContentKey(b)) continue
          editedOpenings.add(id)
          for (const opening of [a, b]) if (opening) changes.push(openingBounds(floor, wall, opening))
        }
      }
      const models = new Map(old.models.map(model => [model.id, model]))
      for (const id of new Set([...models.keys(), ...floor.models.map(model => model.id)])) {
        const a = models.get(id), b = floor.models.find(model => model.id === id)
        if (indirectContentKey(a) === indirectContentKey(b)) continue
        // Window/door meshes and their wall cutouts are one authored edit.
        if (![a, b].filter(Boolean).every(model => !!model!.wallAttachment) ||
          ![...editedOpenings].some(opening => opening === id || opening.startsWith(`${id}:`))) return null
      }
    }
    return changes.length ? changes : null
  } catch { return null }
}

function openingBounds(floor: FloorLevel, wall: Wall, opening: WallOpening): IndirectZoneChange {
  const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y, length = Math.hypot(dx, dz) || 1
  const ux = dx / length, uz = dz / length, pad = Math.max(.35, wall.thickness / 2 + .2)
  const x = wall.start.x + ux * opening.center, z = wall.start.y + uz * opening.center
  const ex = Math.abs(ux) * opening.width / 2 + Math.abs(uz) * pad
  const ez = Math.abs(uz) * opening.width / 2 + Math.abs(ux) * pad
  return { floorId: floor.id, min: [x - ex, floor.elevation + opening.bottom, z - ez],
    max: [x + ex, floor.elevation + opening.bottom + opening.height, z + ez] }
}

export function indirectZoneProbes(field: IndirectField): IndirectZoneProbe[] {
  return field.probes.map(probe => ({ index: probe.index, position: probe.position.toArray(), floorId: probe.region.floorId }))
}

/** Runs against the new geometry in the worker. Room labels select work only;
 * geometry visibility still governs illumination and cross-room propagation. */
export function planIndirectZones(field: IndirectField, visibility: Pick<IndirectVisibility, 'distance'>,
  previous: IndirectZoneProbe[], changes: IndirectZoneChange[]): IndirectZonePlan {
  const firstRegions = new Set<number>(), secondRegions = new Set<number>()
  const old = new Map(previous.map(probe => [probe.index, probe])), retained = new Set<number>()
  const direction = new Vector3(), target = new Vector3()
  const sees = (a: Vector3, b: Vector3) => {
    direction.subVectors(b, a)
    const distance = direction.length(), max = Math.max(0, distance - .001)
    return max < .025 || visibility.distance(a, direction.multiplyScalar(1 / distance), max) >= max
  }
  for (const probe of field.probes) {
    const before = old.get(probe.index)
    if (before?.floorId === probe.region.floorId && probe.position.distanceToSquared(target.fromArray(before.position)) < 1e-8) retained.add(probe.index)
    else firstRegions.add(probe.region.id)
  }
  // Removed/relocated support can change a room's interpolated direct light.
  for (const probe of previous) if (!retained.has(probe.index)) {
    const region = field.regions.find(region => region.floorId === probe.floorId &&
      pointIsInsideRoomPolygon({ x: probe.position[0], y: probe.position[2] }, region.polygon))
    if (region) firstRegions.add(region.id)
  }
  for (const change of changes) {
    const points: Vector3[] = []
    for (const x of [change.min[0], (change.min[0] + change.max[0]) / 2, change.max[0]])
      for (const z of [change.min[2], (change.min[2] + change.max[2]) / 2, change.max[2]]) {
        const regions = field.regions.filter(region => region.floorId === change.floorId &&
          pointIsInsideRoomPolygon({ x, y: z }, region.polygon))
        for (const region of regions) {
          firstRegions.add(region.id)
          for (const y of [change.min[1] + .02, (change.min[1] + change.max[1]) / 2, change.max[1] - .02])
            points.push(new Vector3(x, Math.max(region.bottom + .05, Math.min(region.top - .05, y)), z))
        }
      }
    // A window can be directly visible through a doorway or stairwell.
    for (const probe of field.probes) if (!firstRegions.has(probe.region.id) && points.some(point => sees(probe.position, point)))
      firstRegions.add(probe.region.id)
  }
  const sources = field.probes.filter(probe => firstRegions.has(probe.region.id))
  firstRegions.forEach(id => secondRegions.add(id))
  for (const probe of field.probes) if (!secondRegions.has(probe.region.id) && sources.some(source => sees(probe.position, source.position)))
    secondRegions.add(probe.region.id)
  return { first: field.probes.filter(probe => firstRegions.has(probe.region.id)).map(probe => probe.index),
    second: field.probes.filter(probe => secondRegions.has(probe.region.id)).map(probe => probe.index),
    reflections: [...secondRegions], reused: field.probes.filter(probe => !secondRegions.has(probe.region.id)).length }
}
