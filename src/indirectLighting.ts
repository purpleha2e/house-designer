import { DataTexture, FloatType, HalfFloatType, DataUtils, LinearFilter, NearestFilter, NoColorSpace,
  RedFormat, RGBAFormat, UnsignedByteType, Vector3, SphericalHarmonics3, type BufferGeometry } from 'three'
import { createRoomLightMask, pointIsInsideRoomPolygon } from './roomLightMask.ts'
import type { Point } from './types.ts'
import { createIndirectVolume } from './indirectVolume.ts'
import { createIndirectFloorLayer } from './indirectFloorLighting.ts'

export const INDIRECT_MAX_FLOORS = 8
export const INDIRECT_MASK_SIZE = 512
export const INDIRECT_ATLAS_SIZE = 64
export const INDIRECT_DISTANCE_SIZE = 512
export const INDIRECT_MAX_LOCAL_LIGHTS = 128
export const INDIRECT_MAX_ROOMS = 254

export type IndirectFloor = {
  id: string; elevation: number; height: number
  rooms: { signature: string; polygon: Point[] }[]
}
export type IndirectRegion = {
  id: number; floorId: string; polygon: Point[]
  minX: number; minZ: number; width: number; depth: number
  bottom: number; top: number; y: number; centre: Vector3
}
export type IndirectProbe = { index: number; position: Vector3; region: IndirectRegion; kind?: 'floor' }
export type IndirectField = ReturnType<typeof createIndirectField>

const geometryFingerprints = new WeakMap<BufferGeometry, { positions: unknown; index: unknown; version: string; fingerprint: string }>()
/** React can rebuild identical geometry on a navigation-mode change. */
export function indirectGeometryFingerprint(geometry: BufferGeometry) {
  const positions = geometry.attributes.position, index = geometry.index
  if (!positions) return ''
  const positionVersion = 'data' in positions ? positions.data.version : positions.version
  const version = `${positionVersion}:${positions.count}:${index?.version}:${index?.count}`
  const cached = geometryFingerprints.get(geometry)
  if (cached?.version === version && cached.positions === positions && cached.index === index) return cached.fingerprint
  let hash = 2166136261
  for (let i = 0; i < positions.count; i++) {
    hash = Math.imul(hash ^ Math.round(positions.getX(i) * 100000), 16777619)
    hash = Math.imul(hash ^ Math.round(positions.getY(i) * 100000), 16777619)
    hash = Math.imul(hash ^ Math.round(positions.getZ(i) * 100000), 16777619)
  }
  if (index) for (let i = 0; i < index.count; i++) hash = Math.imul(hash ^ index.getX(i), 16777619)
  const fingerprint = `${positions.count}:${index?.count ?? 0}:${hash >>> 0}`
  geometryFingerprints.set(geometry, { positions, index, version, fingerprint })
  return fingerprint
}

/** Prefer a point with clearance, including in L-shaped and narrow rooms. */
export function roomProbePoint(polygon: Point[], requested: Point, inset = 0.18): Point {
  const clearance = (point: Point) => Math.min(...polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dz = b.y - a.y
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dz) / (dx * dx + dz * dz || 1)))
    return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dz * t)
  }))
  if (pointIsInsideRoomPolygon(requested, polygon) && clearance(requested) >= inset) return requested
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
  const minZ = Math.min(...polygon.map(p => p.y)), maxZ = Math.max(...polygon.map(p => p.y))
  let best = polygon[0], score = Infinity
  for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) {
    const point = { x: minX + (x + .5) / 24 * (maxX - minX), y: minZ + (z + .5) / 24 * (maxZ - minZ) }
    if (!pointIsInsideRoomPolygon(point, polygon)) continue
    const margin = clearance(point)
    const next = Math.hypot(point.x - requested.x, point.y - requested.y) + Math.max(0, inset - margin) * 100
    if (next < score) { best = point; score = next }
  }
  return best
}

function texture(data: Uint8Array | Uint16Array | Float32Array, width: number, height: number, linear = false) {
  const result = new DataTexture(data, width, height, RGBAFormat,
    data instanceof Float32Array ? FloatType : data instanceof Uint16Array ? HalfFloatType : UnsignedByteType)
  result.colorSpace = NoColorSpace
  result.magFilter = result.minFilter = linear ? LinearFilter : NearestFilter
  result.generateMipmaps = false
  result.needsUpdate = true
  return result
}

/** Rooms place probes indoors; only geometry visibility governs their blending. */
export function createIndirectField(input: IndirectFloor[], localLightCount = 1) {
  const floors = [...input].sort((a, b) => a.elevation - b.elevation).slice(0, INDIRECT_MAX_FLOORS)
  const points = floors.flatMap(f => f.rooms.flatMap(r => r.polygon))
  const minX = (points.length ? Math.min(...points.map(p => p.x)) : 0) - .25
  const minZ = (points.length ? Math.min(...points.map(p => p.y)) : 0) - .25
  const size = Math.max(1, ...points.map(p => p.x - minX + .25), ...points.map(p => p.y - minZ + .25))
  const maskData = new Uint8Array(INDIRECT_MASK_SIZE * INDIRECT_MASK_SIZE * Math.max(1, floors.length) * 4)
  const regions: IndirectRegion[] = []
  const ranges = Array.from({ length: INDIRECT_MAX_FLOORS }, () => ({ bottom: 1e8, top: -1e8 }))
  for (const [index, floor] of floors.entries()) {
    const top = floors[index + 1]?.elevation ?? floor.elevation + floor.height
    ranges[index] = { bottom: floor.elevation - .06, top: top - .005 }
    const mask = createRoomLightMask(floor.rooms, { minX, minZ, size }, INDIRECT_MASK_SIZE)
    const ids = new Map<number, number>()
    for (const room of floor.rooms) {
      const localId = mask.roomIdsBySignature.get(room.signature)
      if (!localId || ids.has(localId) || regions.length >= INDIRECT_MAX_ROOMS) continue
      const id = regions.length + 1
      const x = Math.min(...room.polygon.map(p => p.x)), z = Math.min(...room.polygon.map(p => p.y))
      const width = Math.max(.1, Math.max(...room.polygon.map(p => p.x)) - x)
      const depth = Math.max(.1, Math.max(...room.polygon.map(p => p.y)) - z)
      const y = floor.elevation + Math.min(1.2, floor.height * .5)
      const centre = roomProbePoint(room.polygon, { x: x + width / 2, y: z + depth / 2 })
      const region: IndirectRegion = { id, floorId: floor.id, polygon: room.polygon, minX: x, minZ: z, width, depth,
        bottom: floor.elevation, top, y, centre: new Vector3(centre.x, y, centre.y) }
      regions.push(region); ids.set(localId, id)
    }
    mask.data.forEach((localId, pixel) => {
      // This is occupancy, never a room ID: adjoining rooms have identical values.
      maskData[(index * INDIRECT_MASK_SIZE ** 2 + pixel) * 4] = ids.has(localId) ? 255 : 0
    })
  }
  let spacing = 2
  while ((Math.ceil(size / spacing) + 1) ** 2 * 2 * floors.length + regions.length * 2 > INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS) spacing *= 1.25
  const n = Math.ceil(size / spacing) + 1
  const grids = Array.from({ length: INDIRECT_MAX_FLOORS }, () => ({ lower: 0, upper: 1, start: 0 }))
  const probes: IndirectProbe[] = []
  const positionData = new Float32Array(INDIRECT_ATLAS_SIZE ** 2 * 4)
  for (const [floorIndex, floor] of floors.entries()) {
    const height = Math.max(.2, Math.min(floor.height, ranges[floorIndex].top - floor.elevation))
    const grid = { lower: floor.elevation + height * .25, upper: floor.elevation + height * .75, start: floorIndex * n * n * 2 }
    grids[floorIndex] = grid
    const candidates = regions.filter(region => region.floorId === floor.id)
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const requested = { x: minX + x * spacing, y: minZ + z * spacing }
      const inside = candidates.find(region => pointIsInsideRoomPolygon(requested, region.polygon))
      const nearest = inside ? { region: inside, point: roomProbePoint(inside.polygon, requested), distance: 0 }
        : candidates.map(region => {
          const point = roomProbePoint(region.polygon, requested)
          return { region, point, distance: Math.hypot(point.x - requested.x, point.y - requested.y) }
        }).sort((a, b) => a.distance - b.distance)[0]
      if (!nearest || nearest.distance > spacing) continue
      for (let y = 0; y < 2; y++) {
        const index = grid.start + y * n * n + z * n + x
        const position = new Vector3(nearest.point.x, y ? grid.upper : grid.lower, nearest.point.y)
        probes.push({ index, position, region: nearest.region })
        writeIndirectPosition(positionData, index, position)
      }
    }
  }
  // A narrow enclosed space can fall entirely between regular grid nodes.
  // Give it support without making its label a boundary in the interpolation.
  let extraIndex = floors.length * n * n * 2
  for (const region of regions) {
    if (probes.some(probe => probe.region === region &&
      Math.hypot(probe.position.x - region.centre.x, probe.position.z - region.centre.z) < .7)) continue
    const grid = grids[floors.findIndex(floor => floor.id === region.floorId)]
    for (const y of [grid.lower, grid.upper]) {
      const position = new Vector3(region.centre.x, y, region.centre.z), index = extraIndex++
      probes.push({ index, position, region }); writeIndirectPosition(positionData, index, position)
    }
  }
  // G/B pack the first structural ceiling height; 65535 means no restriction.
  for (let i = 0; i < maskData.length; i += 4) maskData[i + 1] = maskData[i + 2] = 255
  const coefficients = Array.from({ length: 3 }, () => new Uint16Array(INDIRECT_ATLAS_SIZE ** 2 * 4))
  const maps = coefficients.map(data => texture(data, INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE))
  const positions = texture(positionData, INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE)
  // Only lamps need angular visibility maps; diffuse probes use exact BVH segments.
  const distanceColumns = Math.ceil(Math.sqrt(Math.max(1, Math.min(INDIRECT_MAX_LOCAL_LIGHTS, localLightCount))))
  const distanceRows = Math.ceil(Math.max(1, Math.min(INDIRECT_MAX_LOCAL_LIGHTS, localLightCount)) / distanceColumns)
  const distanceSize = localLightCount <= 8 ? INDIRECT_DISTANCE_SIZE : localLightCount <= 32 ? 256 : 128
  const distanceWidth = distanceColumns * distanceSize, distanceHeight = distanceRows * distanceSize
  const distanceData = new Float32Array(distanceWidth * distanceHeight)
  const distances = new DataTexture(distanceData, distanceWidth, distanceHeight, RedFormat, FloatType)
  distances.magFilter = distances.minFilter = NearestFilter
  distances.generateMipmaps = false; distances.needsUpdate = true
  const mask = texture(maskData, INDIRECT_MASK_SIZE, INDIRECT_MASK_SIZE * Math.max(1, floors.length))
  const volume = createIndirectVolume(size, floors.length)
  const floorLayer = createIndirectFloorLayer(size, floors.length)
  return { floors, ranges, grids, probes, regions, spacing, n, floorProbeLayoutVersion: 0, bounds: { minX, minZ, size }, mask, maps, coefficients,
    positions, positionData, distances, distanceData, distanceColumns, distanceRows, distanceSize, distanceWidth, volume, floorLayer,
    dispose() { mask.dispose(); positions.dispose(); distances.dispose(); volume.dispose(); floorLayer.dispose(); maps.forEach(map => map.dispose()) } }
}

export function writeIndirectPosition(data: Float32Array, index: number, position: Vector3) {
  position.toArray(data, index * 4)
  data[index * 4 + 3] = 1
}

/** Worker result contains plain data; GPU textures are created only on the renderer thread. */
export function serializeIndirectField(field: IndirectField) {
  return {
    floors: field.floors, ranges: field.ranges, grids: field.grids, spacing: field.spacing, n: field.n, bounds: field.bounds,
    floorProbeLayoutVersion: field.floorProbeLayoutVersion,
    regions: field.regions.map(region => ({ ...region, centre: region.centre.toArray() })),
    probes: field.probes.map(probe => ({ index: probe.index, position: probe.position.toArray(), regionId: probe.region.id, kind: probe.kind })),
    maskData: field.mask.image.data as Uint8Array, positionData: field.positionData,
    distanceData: field.distanceData, distanceColumns: field.distanceColumns, distanceRows: field.distanceRows,
    distanceSize: field.distanceSize, distanceWidth: field.distanceWidth,
  }
}
export type IndirectFieldData = Omit<ReturnType<typeof serializeIndirectField>, 'floorProbeLayoutVersion'> & { floorProbeLayoutVersion?: number }

export function restoreIndirectField(data: IndirectFieldData): IndirectField {
  const regions = data.regions.map(region => ({ ...region, centre: new Vector3().fromArray(region.centre) }))
  const probes = data.probes.map(probe => ({ index: probe.index, position: new Vector3().fromArray(probe.position),
    region: regions.find(region => region.id === probe.regionId)!, kind: probe.kind }))
  const coefficients = Array.from({ length: 3 }, () => new Uint16Array(INDIRECT_ATLAS_SIZE ** 2 * 4))
  const maps = coefficients.map(channel => texture(channel, INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE))
  const positions = texture(data.positionData, INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE)
  const distanceHeight = data.distanceRows * data.distanceSize
  const distances = new DataTexture(data.distanceData, data.distanceWidth, distanceHeight, RedFormat, FloatType)
  distances.magFilter = distances.minFilter = NearestFilter; distances.generateMipmaps = false; distances.needsUpdate = true
  const mask = texture(data.maskData, INDIRECT_MASK_SIZE, INDIRECT_MASK_SIZE * Math.max(1, data.floors.length))
  const volume = createIndirectVolume(data.bounds.size, data.floors.length)
  const floorLayer = createIndirectFloorLayer(data.bounds.size, data.floors.length)
  return { ...data, floorProbeLayoutVersion: data.floorProbeLayoutVersion ?? 0, regions, probes, coefficients, maps, positions, distances, mask, volume, floorLayer,
    dispose() { mask.dispose(); positions.dispose(); distances.dispose(); volume.dispose(); floorLayer.dispose(); maps.forEach(map => map.dispose()) } }
}

export function writeIndirectProbe(field: IndirectField, index: number, sh: SphericalHarmonics3) {
  const channels = ['x', 'y', 'z'] as const
  channels.forEach((channel, colour) => {
    for (let coefficient = 0; coefficient < 4; coefficient++) {
      field.coefficients[colour][index * 4 + coefficient] = DataUtils.toHalfFloat(sh.coefficients[coefficient][channel])
    }
  })
  field.maps.forEach(map => { map.needsUpdate = true })
}

export function evaluateIndirectSH(sh: SphericalHarmonics3, normal: Vector3) {
  return sh.coefficients[0].clone().multiplyScalar(.886227)
    .addScaledVector(sh.coefficients[1], 1.023328 * normal.y)
    .addScaledVector(sh.coefficients[2], 1.023328 * normal.z)
    .addScaledVector(sh.coefficients[3], 1.023328 * normal.x).max(new Vector3())
}
