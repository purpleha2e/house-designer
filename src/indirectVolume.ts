import { Data3DTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector3 } from 'three'
import { INDIRECT_MASK_SIZE, type IndirectField } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'

export const INDIRECT_VOLUME_HEIGHT = 12
export const INDIRECT_VOLUME_STRIDE = INDIRECT_VOLUME_HEIGHT + 2

/** Four coefficient slabs share one texture; L0 alpha stores valid-sample coverage. */
export function createIndirectVolume(size: number, floors: number) {
  const n = Math.max(2, Math.min(128, Math.ceil(size / .16) + 1))
  const height = Math.max(1, floors) * INDIRECT_VOLUME_STRIDE
  const data = new Uint16Array(n * n * height * 4 * 4)
  const maps = [(() => {
    const texture = new Data3DTexture(data, n, height * 4, n)
    texture.type = HalfFloatType; texture.format = RGBAFormat; texture.colorSpace = NoColorSpace
    texture.magFilter = texture.minFilter = LinearFilter; texture.generateMipmaps = false
    texture.unpackAlignment = 1; texture.needsUpdate = true
    return texture
  })()]
  return { n, height, data, maps, rows: n * floors * INDIRECT_VOLUME_HEIGHT,
    dispose() { maps.forEach(map => map.dispose()) } }
}

const origin = new Vector3(), direction = new Vector3()

/** Visibility depends on geometry, not illumination. Reuse it across previews and bounce passes. */
export function createIndirectVolumeLookup(field: IndirectField, visibility: IndirectVisibility, voxels = field.volume.rows * field.volume.n) {
  const bins = new Map<string, typeof field.probes>()
  for (const original of field.probes) {
    const probe = { ...original, position: new Vector3().fromArray(field.positionData, original.index * 4) }
    const key = `${probe.region.floorId}:${Math.floor(probe.position.x / field.spacing)}:${Math.floor(probe.position.z / field.spacing)}`
    const bin = bins.get(key) ?? []; bin.push(probe); bins.set(key, bin)
  }
  const offsets = new Uint32Array(voxels).fill(0xffffffff), counts = new Uint16Array(voxels)
  let indices = new Uint16Array(65536), weights = new Float32Array(65536), states = new Uint8Array(65536), used = 0
  const positions = field.positionData.slice()
  const radiusSquared = (field.spacing * 1.75) ** 2, rayOrigin = new Vector3(), rayDirection = new Vector3()
  let decoded: Float32Array[] | null = null
  const sample = (floor: number, x: number, y: number, z: number, voxel: number, result: Float64Array) => {
    if (offsets[voxel] === 0xffffffff) {
      offsets[voxel] = used
      const bx = Math.floor(x / field.spacing), bz = Math.floor(z / field.spacing)
      for (let iz = bz - 2; iz <= bz + 2; iz++) for (let ix = bx - 2; ix <= bx + 2; ix++) {
        for (const probe of bins.get(`${field.floors[floor].id}:${ix}:${iz}`) ?? []) {
          rayOrigin.copy(probe.position); rayDirection.set(x - rayOrigin.x, y - rayOrigin.y, z - rayOrigin.z)
          const distanceSquared = rayDirection.lengthSq()
          if (distanceSquared >= radiusSquared) continue
          if (used === indices.length) {
            const nextIndices = new Uint16Array(indices.length * 2), nextWeights = new Float32Array(weights.length * 2)
            const nextStates = new Uint8Array(states.length * 2)
            nextIndices.set(indices); nextWeights.set(weights); nextStates.set(states)
            indices = nextIndices; weights = nextWeights; states = nextStates
          }
          indices[used] = probe.index; weights[used++] = (1 - distanceSquared / radiusSquared) ** 2; counts[voxel]++
        }
      }
    }
    result.fill(0)
    let total = 0
    const start = offsets[voxel], end = start + counts[voxel]
    for (let i = start; i < end; i++) {
      const index = indices[i]
      // Startup previews omit uncaptured samples, but measured black samples remain valid.
      if (field.positionData[index * 4 + 3] < .5) continue
      // Defer geometry rays until this probe has data. Each ray is still evaluated only once.
      if (states[i] === 0) {
        rayOrigin.fromArray(positions, index * 4); rayDirection.set(x - rayOrigin.x, y - rayOrigin.y, z - rayOrigin.z)
        const distance = rayDirection.length(), max = Math.max(0, distance - .001)
        states[i] = max > .025 && visibility.distance(rayOrigin, rayDirection.multiplyScalar(1 / distance), max) < max ? 1 : 2
      }
      if (states[i] === 1) continue
      const weight = weights[i]; total += weight
      for (let colour = 0; colour < 3; colour++) for (let coefficient = 0; coefficient < 4; coefficient++) {
        result[colour * 4 + coefficient] += (decoded ? decoded[colour][index * 4 + coefficient]
          : DataUtils.fromHalfFloat(field.coefficients[colour][index * 4 + coefficient])) * weight
      }
    }
    if (total > 0) for (let i = 0; i < 12; i++) result[i] /= total
    return total
  }
  return Object.assign(sample, { refreshCoefficients() {
    decoded ??= field.coefficients.map(data => new Float32Array(data.length))
    field.coefficients.forEach((data, colour) => { for (let i = 0; i < data.length; i++) decoded![colour][i] = DataUtils.fromHalfFloat(data[i]) })
  } })
}

/** Exact segments are affordable during the bake and avoid angular moment-map wedges. */
export function sampleIndirectCoefficients(field: IndirectField, floor: number, x: number, y: number, z: number,
  result: Float64Array, visibility: IndirectVisibility) {
  result.fill(0)
  const radiusSquared = (field.spacing * 1.75) ** 2
  let total = 0
  for (const probe of field.probes) {
    if (probe.region.floorId !== field.floors[floor].id) continue
    const index = probe.index, offset = index * 4
    if (field.positionData[offset + 3] < .5) continue
    origin.fromArray(field.positionData, offset)
    direction.set(x - origin.x, y - origin.y, z - origin.z)
    const distanceSquared = direction.lengthSq()
    if (distanceSquared >= radiusSquared) continue
    // These are volume samples, not surface receivers. A centimetre-scale
    // endpoint bias can see through a wall into a voxel inside the solid.
    const distance = Math.sqrt(distanceSquared), max = Math.max(0, distance - .001)
    if (max > .025 && visibility.distance(origin, direction.multiplyScalar(1 / distance), max) < max) continue
    // A compact, smooth kernel uses the actual relocated position, avoiding
    // grid-cell diagonals and abrupt changes when a nominal corner disappears.
    const weight = (1 - distanceSquared / radiusSquared) ** 2
    total += weight
    for (let colour = 0; colour < 3; colour++) for (let coefficient = 0; coefficient < 4; coefficient++) {
      result[colour * 4 + coefficient] += DataUtils.fromHalfFloat(field.coefficients[colour][index * 4 + coefficient]) * weight
    }
  }
  if (total > 0) for (let i = 0; i < 12; i++) result[i] /= total
  return total
}

/** Cache actual headroom in the existing mask; no extra display texture fetch. */
export function writeIndirectCeilingRow(field: IndirectField, row: number, structure: IndirectVisibility) {
  const floor = Math.floor(row / INDIRECT_MASK_SIZE), z = row % INDIRECT_MASK_SIZE
  const range = field.ranges[floor], data = field.mask.image.data as Uint8Array
  direction.set(0, 1, 0)
  for (let x = 0; x < INDIRECT_MASK_SIZE; x++) {
    const offset = (row * INDIRECT_MASK_SIZE + x) * 4
    if (!data[offset]) continue
    origin.set(field.bounds.minX + (x + .5) / INDIRECT_MASK_SIZE * field.bounds.size,
      field.floors[floor].elevation + .08, field.bounds.minZ + (z + .5) / INDIRECT_MASK_SIZE * field.bounds.size)
    const max = Math.max(0, range.top - origin.y), ceiling = origin.y + structure.distance(origin, direction, max)
    const packed = Math.round(Math.max(0, Math.min(1, (ceiling - range.bottom) / (range.top - range.bottom))) * 65535)
    data[offset + 1] = packed >> 8; data[offset + 2] = packed & 255
  }
}

/** One row is a small, bounded unit of background CPU work. */
export function writeIndirectVolumeRow(field: IndirectField, row: number, result: Float64Array, visibility: IndirectVisibility,
  lookup?: ReturnType<typeof createIndirectVolumeLookup>) {
  const volume = field.volume, floor = Math.floor(row / (volume.n * INDIRECT_VOLUME_HEIGHT))
  const iz = Math.floor(row / INDIRECT_VOLUME_HEIGHT) % volume.n, iy = row % INDIRECT_VOLUME_HEIGHT
  const range = field.ranges[floor]
  const y = Math.max(field.floors[floor].elevation + .06,
    range.bottom + iy / (INDIRECT_VOLUME_HEIGHT - 1) * (range.top - range.bottom))
  const z = field.bounds.minZ + iz / (volume.n - 1) * field.bounds.size
  for (let ix = 0; ix < volume.n; ix++) {
    const x = field.bounds.minX + ix / (volume.n - 1) * field.bounds.size
    const mx = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(ix / (volume.n - 1) * INDIRECT_MASK_SIZE))
    const mz = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(iz / (volume.n - 1) * INDIRECT_MASK_SIZE))
    const mask = field.mask.image.data as Uint8Array, m = ((floor * INDIRECT_MASK_SIZE + mz) * INDIRECT_MASK_SIZE + mx) * 4
    const ceiling = range.bottom + (mask[m + 1] * 256 + mask[m + 2]) / 65535 * (range.top - range.bottom)
    // Extend interior radiance into the border above the ceiling. Occupancy
    // still excludes exterior receivers; filtering never mixes with attic black.
    const sampleY = mask[m] ? Math.max(field.floors[floor].elevation + .06, Math.min(y, ceiling - .06)) : y
    const supported = (lookup ? lookup(floor, x, sampleY, z, row * volume.n + ix, result)
      : sampleIndirectCoefficients(field, floor, x, sampleY, z, result, visibility)) > 0
    const rows = [floor * INDIRECT_VOLUME_STRIDE + iy + 1]
    if (iy === 0) rows.push(floor * INDIRECT_VOLUME_STRIDE)
    if (iy === INDIRECT_VOLUME_HEIGHT - 1) rows.push(floor * INDIRECT_VOLUME_STRIDE + INDIRECT_VOLUME_STRIDE - 1)
    for (const targetRow of rows) {
      for (let coefficient = 0; coefficient < 4; coefficient++) {
        const offset = ((iz * volume.height * 4 + coefficient * volume.height + targetRow) * volume.n + ix) * 4
        for (let colour = 0; colour < 3; colour++) volume.data[offset + colour] = DataUtils.toHalfFloat(result[colour * 4 + coefficient])
        volume.data[offset + 3] = DataUtils.toHalfFloat(supported ? 1 : 0)
      }
    }
  }
}
