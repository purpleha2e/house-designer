import { Box3, Vector3 } from 'three'
import { createIndirectField, INDIRECT_ATLAS_SIZE, INDIRECT_MASK_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, serializeIndirectField,
  writeIndirectPosition, type IndirectFloor } from './indirectLighting.ts'
import { createIndirectVisibilityFromSnapshot, writeIndirectVisibility, type IndirectGeometrySnapshot } from './indirectVisibility.ts'
import { createIndirectVolumeLookup, writeIndirectCeilingRow, writeIndirectVolumeRow } from './indirectVolume.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'
import { createIndirectFloorLookup, writeIndirectFloorLayer } from './indirectFloorLighting.ts'
import { planIndirectZones, type IndirectZoneChange, type IndirectZoneProbe } from './indirectLightingZones.ts'
import { addIndirectFurnitureProbes } from './indirectFurnitureProbes.ts'

export const INDIRECT_MIN_PROBE_SPACING = 0.6

/** Relocation can collapse several grid nodes onto one wall inset or clear
 * furniture position. Keep the least-displaced sample, but never combine
 * samples across an occluder or on separate storeys. Atlas indices stay stable. */
export function pruneRedundantIndirectProbes(field: ReturnType<typeof createIndirectField>,
  visibility: Pick<ReturnType<typeof createIndirectVisibilityFromSnapshot>, 'distance'>) {
  const spacing = INDIRECT_MIN_PROBE_SPACING
  const cells = new Map<string, typeof field.probes>()
  const direction = new Vector3()
  const cellKey = (floor: string, x: number, y: number, z: number) => `${floor}:${x}:${y}:${z}`
  const displacement = (probe: typeof field.probes[number]) => {
    const floorIndex = field.floors.findIndex(floor => floor.id === probe.region.floorId)
    const grid = field.grids[floorIndex], slot = probe.index - grid.start
    if (slot < 0 || slot >= 2 * field.n * field.n) return probe.position.distanceToSquared(probe.region.centre)
    const layer = Math.floor(slot / (field.n * field.n)), planar = slot % (field.n * field.n)
    return (probe.position.x - field.bounds.minX - (planar % field.n) * field.spacing) ** 2 +
      (probe.position.z - field.bounds.minZ - Math.floor(planar / field.n) * field.spacing) ** 2 +
      (probe.position.y - (layer ? grid.upper : grid.lower)) ** 2
  }
  const candidates = field.probes.map(probe => ({ probe, moved: displacement(probe) }))
    .sort((a, b) => a.moved - b.moved || a.probe.index - b.probe.index)
  const retained = new Set<number>()
  for (const { probe } of candidates) {
    const { x, y, z } = probe.position, floor = probe.region.floorId
    const cx = Math.floor(x / spacing), cy = Math.floor(y / spacing), cz = Math.floor(z / spacing)
    let redundant = false
    neighbours: for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of cells.get(cellKey(floor, cx + dx, cy + dy, cz + dz)) ?? []) {
        direction.subVectors(probe.position, other.position)
        const distance = direction.length()
        if (distance >= spacing) continue
        if (distance < .00001 || visibility.distance(other.position, direction.multiplyScalar(1 / distance), distance) >= distance) {
          redundant = true; break neighbours
        }
      }
    }
    if (redundant) { field.positionData[probe.index * 4 + 3] = 0; continue }
    retained.add(probe.index)
    const key = cellKey(floor, cx, cy, cz), bucket = cells.get(key) ?? []
    bucket.push(probe); cells.set(key, bucket)
  }
  const count = field.probes.length
  field.probes.splice(0, count, ...field.probes.filter(probe => retained.has(probe.index)))
  field.positions.needsUpdate = true
  return count - field.probes.length
}

/** Runs entirely in the GI worker. No renderer, DOM, shader compilation or GPU readbacks. */
export function prepareIndirectCache(floors: IndirectFloor[], lights: [number, number, number][],
  geometry: IndirectGeometrySnapshot, obstacles: { min: number[]; max: number[] }[],
  zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[]; captureNewOnly?: boolean }) {
  const field = createIndirectField(floors, lights.length)
  const visibility = createIndirectVisibilityFromSnapshot(geometry)
  const structure = createIndirectVisibilityFromSnapshot(geometry.filter(part => part.structural))
  const boxes = obstacles.map(box => new Box3(new Vector3().fromArray(box.min), new Vector3().fromArray(box.max)))
  const up = new Vector3(0, 1, 0), origin = new Vector3()
  for (const probe of field.probes) {
    if (boxes.some(box => box.containsPoint(probe.position))) {
      findClearPosition: for (const radius of [.3, .6, 1, 1.5]) for (let direction = 0; direction < 8; direction++) {
        const point = probe.position.clone().add(new Vector3(Math.cos(direction * Math.PI / 4) * radius, 0, Math.sin(direction * Math.PI / 4) * radius))
        if (field.regions.some(region => region.floorId === probe.region.floorId && pointIsInsideRoomPolygon({ x: point.x, y: point.z }, region.polygon)) &&
          !boxes.some(box => box.containsPoint(point))) { probe.position.copy(point); break findClearPosition }
      }
    }
    origin.set(probe.position.x, probe.region.bottom + .08, probe.position.z)
    const max = Math.max(0, probe.position.y - origin.y), distance = structure.distance(origin, up, max)
    if (distance < max) probe.position.y = Math.max(probe.region.bottom + .12, origin.y + distance - .12)
    writeIndirectPosition(field.positionData, probe.index, probe.position)
  }
  pruneRedundantIndirectProbes(field, visibility)
  addIndirectFurnitureProbes(field, boxes, visibility)
  for (let row = 0; row < field.floors.length * INDIRECT_MASK_SIZE; row++) writeIndirectCeilingRow(field, row, structure)
  structure.dispose()
  lights.slice(0, INDIRECT_MAX_LOCAL_LIGHTS).forEach((light, index) => {
    const position = new Vector3(...light)
    writeIndirectVisibility(field, index, position, visibility)
    writeIndirectPosition(field.positionData, INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + index, position)
  })
  const triangles = visibility.triangleTexture()
  const lookup = createIndirectVolumeLookup(field, visibility)
  const floorLookup = createIndirectFloorLookup(field, visibility)
  const zonePlan = zones ? planIndirectZones(field, visibility, zones.previous, zones.changes) : undefined
  if (zones?.captureNewOnly && zonePlan && zones.previous.every(previous => field.probes.some(probe =>
    probe.index === previous.index && probe.region.floorId === previous.floorId && probe.position.distanceToSquared(origin.fromArray(previous.position)) < 1e-8))) {
    // Adding underside probes does not alter the existing direct-only captures.
    // Keep those and refresh only the new captures plus affected second bounces.
    const previousIndices = new Set(zones.previous.map(probe => probe.index))
    zonePlan.first = field.probes.filter(probe => !previousIndices.has(probe.index)).map(probe => probe.index)
  }
  return { field, visibility,
    snapshot() { return { field: serializeIndirectField(field), zonePlan, triangles: { data: triangles.image.data as Float32Array,
      width: triangles.image.width, height: triangles.image.height } } },
    volume(coefficients: Uint16Array[], positions: Float32Array) {
      coefficients.forEach((values, index) => field.coefficients[index].set(values)); field.positionData.set(positions)
      lookup.refreshCoefficients()
      floorLookup.refreshCoefficients()
      const result = new Float64Array(12)
      for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility, lookup)
      writeIndirectFloorLayer(field, visibility, floorLookup)
      return field.volume.data.slice()
    },
    dispose() { field.dispose(); visibility.dispose() },
  }
}
export type PreparedIndirectCache = ReturnType<ReturnType<typeof prepareIndirectCache>['snapshot']>
