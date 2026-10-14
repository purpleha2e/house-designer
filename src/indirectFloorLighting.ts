import { Data3DTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector3 } from 'three'
import type { IndirectField } from './indirectLighting.ts'
import { createIndirectVolumeLookup, sampleIndirectCoefficients } from './indirectVolume.ts'
import { INDIRECT_MASK_SIZE } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'

export const INDIRECT_FLOOR_SAMPLE_HEIGHT = .016
export const INDIRECT_FLOOR_LAYER_VERSION = 2
// A lone probe at the edge of its influence must retain its small contribution.
// Dividing by arbitrarily tiny support otherwise restores its full brightness.
export const INDIRECT_FLOOR_MIN_SUPPORT = .1
export function indirectFloorConfidence(support: number) { return Math.min(1, Math.max(0, support / INDIRECT_FLOOR_MIN_SUPPORT)) }
export function indirectFloorSize(size: number, spacing = .04) { return Math.max(2, Math.min(512, Math.ceil(size / spacing) + 1)) }

/** Four SH slabs, with one isolated plane per storey. Floor receivers never blend vertically. */
export function createIndirectFloorLayer(size: number, floors: number, spacing = .04, limit = 512) {
  const n = Math.min(limit, indirectFloorSize(size, spacing)), height = Math.max(1, floors)
  const data = new Uint16Array(n * n * height * 4 * 4)
  const texture = new Data3DTexture(data, n, height * 4, n)
  texture.type = HalfFloatType; texture.format = RGBAFormat; texture.colorSpace = NoColorSpace
  texture.minFilter = texture.magFilter = LinearFilter; texture.unpackAlignment = 1; texture.generateMipmaps = false; texture.needsUpdate = true
  return { n, height, data, texture, ready: false, dispose() { texture.dispose() } }
}

export function createIndirectFloorLookup(field: IndirectField, visibility: IndirectVisibility) {
  return createIndirectVolumeLookup(field, visibility, field.floorLayer.n ** 2 * field.floors.length)
}

export function writeIndirectFloorLayer(field: IndirectField, visibility: IndirectVisibility, lookup?: ReturnType<typeof createIndirectFloorLookup>) {
  for (let row = 0; row < field.floors.length * field.floorLayer.n; row++) writeIndirectFloorRow(field, row, visibility, lookup)
  field.floorLayer.ready = true; field.floorLayer.texture.needsUpdate = true
}

/** The same receiver positions are used for background visibility and final lighting. */
export function writeIndirectFloorRow(field: IndirectField, row: number, visibility: IndirectVisibility,
  lookup?: ReturnType<typeof createIndirectFloorLookup>, visibilityOnly = false) {
  const layer = field.floorLayer, result = new Float64Array(12), mask = field.mask.image.data as Uint8Array
  const floor = Math.floor(row / layer.n), z = row % layer.n
  for (let x = 0; x < layer.n; x++) {
    const px = field.bounds.minX + x / (layer.n - 1) * field.bounds.size, pz = field.bounds.minZ + z / (layer.n - 1) * field.bounds.size
    const mx = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(x / (layer.n - 1) * INDIRECT_MASK_SIZE))
    const mz = Math.min(INDIRECT_MASK_SIZE - 1, Math.floor(z / (layer.n - 1) * INDIRECT_MASK_SIZE))
    result.fill(0)
    const y = field.floors[floor].elevation + INDIRECT_FLOOR_SAMPLE_HEIGHT
    if (visibilityOnly) {
      if (mask[((floor * INDIRECT_MASK_SIZE + mz) * INDIRECT_MASK_SIZE + mx) * 4])
        lookup!.warm(floor, px, y, pz, (floor * layer.n + z) * layer.n + x)
      continue
    }
    const support = mask[((floor * INDIRECT_MASK_SIZE + mz) * INDIRECT_MASK_SIZE + mx) * 4] ?
      (lookup ? lookup(floor, px, y, pz, (floor * layer.n + z) * layer.n + x, result)
        : sampleIndirectCoefficients(field, floor, px, y, pz, result, visibility)) : 0
    const confidence = indirectFloorConfidence(support)
    for (let coefficient = 0; coefficient < 4; coefficient++) {
      const offset = ((z * layer.height * 4 + coefficient * layer.height + floor) * layer.n + x) * 4
      for (let colour = 0; colour < 3; colour++) layer.data[offset + colour] = DataUtils.toHalfFloat(result[colour * 4 + coefficient] * confidence)
      // Coverage excludes unsupported cells; it must not undo confidence attenuation.
      layer.data[offset + 3] = DataUtils.toHalfFloat(support > 0 ? 1 : 0)
    }
  }
}

export function usesIndirectFloorLayer(field: IndirectField, floor: number, point: Vector3, normal: Vector3) {
  const elevation = field.floors[floor].elevation
  return field.floorLayer.ready && normal.y > .9 && point.y >= elevation - .02 && point.y <= elevation + .08
}

export function sampleBakedIndirectFloor(field: IndirectField, floor: number, point: Vector3, normal: Vector3) {
  const layer = field.floorLayer, step = field.bounds.size / (layer.n - 1)
  const x = Math.max(0, Math.min(layer.n - 1, (point.x - field.bounds.minX) / step))
  const z = Math.max(0, Math.min(layer.n - 1, (point.z - field.bounds.minZ) / step))
  const result = new Float64Array(12)
  let coverage = 0
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
    const weight = (dx ? x % 1 : 1 - x % 1) * (dz ? z % 1 : 1 - z % 1)
    const ix = Math.min(layer.n - 1, Math.floor(x) + dx), iz = Math.min(layer.n - 1, Math.floor(z) + dz)
    for (let coefficient = 0; coefficient < 4; coefficient++) {
      const offset = ((iz * layer.height * 4 + coefficient * layer.height + floor) * layer.n + ix) * 4
      for (let colour = 0; colour < 3; colour++) result[colour * 4 + coefficient] += DataUtils.fromHalfFloat(layer.data[offset + colour]) * weight
      if (!coefficient) coverage += DataUtils.fromHalfFloat(layer.data[offset + 3]) * weight
    }
  }
  const basis = [.886227, 1.023328 * normal.y, 1.023328 * normal.z, 1.023328 * normal.x]
  const rgb = [0, 1, 2].map(colour => Math.max(0, basis.reduce((sum, b, i) => sum + b * result[colour * 4 + i], 0) / Math.max(.00001, coverage))) as [number, number, number]
  return { rgb, coverage }
}

/** Local prototype of a filtered floor layer, using the exact same visibility as the bake. */
export function sampleIndirectFloorCandidate(field: IndirectField, visibility: IndirectVisibility, floor: number,
  point: Vector3, normal: Vector3, spacing = .04) {
  const n = indirectFloorSize(field.bounds.size, spacing), step = field.bounds.size / (n - 1)
  const x = Math.max(0, Math.min(n - 1, (point.x - field.bounds.minX) / step))
  const z = Math.max(0, Math.min(n - 1, (point.z - field.bounds.minZ) / step))
  const coefficients = new Float64Array(12), sample = new Float64Array(12)
  let coverage = 0
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
    const weight = (dx ? x % 1 : 1 - x % 1) * (dz ? z % 1 : 1 - z % 1)
    const px = field.bounds.minX + Math.min(n - 1, Math.floor(x) + dx) * step
    const pz = field.bounds.minZ + Math.min(n - 1, Math.floor(z) + dz) * step
    const support = sampleIndirectCoefficients(field, floor, px, field.floors[floor].elevation + INDIRECT_FLOOR_SAMPLE_HEIGHT, pz, sample, visibility)
    if (support <= 0) continue
    coverage += weight
    for (let i = 0; i < 12; i++) coefficients[i] += sample[i] * weight * indirectFloorConfidence(support)
  }
  const basis = [.886227, 1.023328 * normal.y, 1.023328 * normal.z, 1.023328 * normal.x]
  const rgb = [0, 1, 2].map(colour => Math.max(0, basis.reduce((sum, b, i) => sum + b * coefficients[colour * 4 + i], 0) / Math.max(.00001, coverage)))
  return { step, rgb, coverage }
}
