import { DataUtils, Vector3 } from 'three'
import { INDIRECT_MASK_SIZE, type IndirectField } from './indirectLighting.ts'
import { INDIRECT_VOLUME_HEIGHT, INDIRECT_VOLUME_STRIDE, sampleIndirectCoefficients } from './indirectVolume.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'
import { indirectSHIrradianceBasis, type IndirectSHOrder } from './indirectSH.ts'
import { indirectFloorConfidence, sampleBakedIndirectFloor, usesIndirectFloorLayer } from './indirectFloorLighting.ts'

type RGB = [number, number, number]
export type IndirectPointInspection = ReturnType<typeof inspectIndirectPoint>
const clamp = (x: number, max: number) => Math.max(0, Math.min(max, x))
function irradiance(coefficients: ArrayLike<number>, normal: Vector3, order: IndirectSHOrder = 1): RGB {
  const basis = indirectSHIrradianceBasis(normal, order)
  return [0, 1, 2].map(colour => Math.max(0, basis.reduce((sum, b, i) => sum + b * coefficients[colour * basis.length + i], 0))) as RGB
}

/** CPU equivalent of the display's packed 3D texture reads, including coverage normalization. */
export function sampleDisplayedIndirect(field: IndirectField, floor: number, point: Vector3, normal: Vector3) {
  if (usesIndirectFloorLayer(field, floor, point, normal)) return sampleBakedIndirectFloor(field, floor, point, normal)
  const { volume, bounds } = field, range = field.ranges[floor]
  const x = clamp((point.x - bounds.minX) / bounds.size, 1) * (volume.n - 1)
  const z = clamp((point.z - bounds.minZ) / bounds.size, 1) * (volume.n - 1)
  const y = floor * INDIRECT_VOLUME_STRIDE + 1 + clamp((point.y - range.bottom) / (range.top - range.bottom), 1) * (INDIRECT_VOLUME_HEIGHT - 1)
  const result = new Float64Array(field.coefficientCount * 3)
  let coverage = 0
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const weight = (dx ? x % 1 : 1 - x % 1) * (dy ? y % 1 : 1 - y % 1) * (dz ? z % 1 : 1 - z % 1)
    const ix = Math.min(volume.n - 1, Math.floor(x) + dx), iz = Math.min(volume.n - 1, Math.floor(z) + dz)
    const iy = Math.min(volume.height - 1, Math.floor(y) + dy)
    for (let coefficient = 0; coefficient < field.coefficientCount; coefficient++) {
      const offset = ((iz * volume.height * field.coefficientCount + coefficient * volume.height + iy) * volume.n + ix) * 4
      for (let colour = 0; colour < 3; colour++) result[colour * field.coefficientCount + coefficient] += DataUtils.fromHalfFloat(volume.data[offset + colour]) * weight
      if (!coefficient) coverage += DataUtils.fromHalfFloat(volume.data[offset + 3]) * weight
    }
  }
  for (let i = 0; i < field.coefficientCount * 3; i++) result[i] /= Math.max(.00001, coverage)
  return { rgb: irradiance(result, normal, field.shOrder), coverage }
}

/** Read-only comparison: no lighting cache, captures or probe coefficients are changed. */
export function inspectIndirectPoint(field: IndirectField, visibility: IndirectVisibility, point: Vector3, normal: Vector3,
  lights: { position: number[]; color: string }[], direct?: Uint16Array[]) {
  normal = normal.clone().normalize()
  const occupancy = point.clone().addScaledVector(normal, .08)
  const floor = field.floors.findIndex((_, i) => occupancy.y >= field.ranges[i].bottom && occupancy.y < field.ranges[i].top)
  const px = (occupancy.x - field.bounds.minX) / field.bounds.size, pz = (occupancy.z - field.bounds.minZ) / field.bounds.size
  if (floor < 0 || px < 0 || pz < 0 || px >= 1 || pz >= 1) throw new Error('Choose a surface inside the baked building.')
  const m = ((floor * INDIRECT_MASK_SIZE + Math.floor(pz * INDIRECT_MASK_SIZE)) * INDIRECT_MASK_SIZE + Math.floor(px * INDIRECT_MASK_SIZE)) * 4
  const mask = field.mask.image.data as Uint8Array, range = field.ranges[floor]
  const ceiling = range.bottom + (mask[m + 1] * 256 + mask[m + 2]) / 65535 * (range.top - range.bottom)
  if (!mask[m] || occupancy.y > ceiling) throw new Error('This point does not receive indoor GI. Choose the carpet inside the room.')
  const step = new Vector3(field.bounds.size / (field.volume.n - 1), (range.top - range.bottom) / (INDIRECT_VOLUME_HEIGHT - 1), field.bounds.size / (field.volume.n - 1))
  const floorLayer = usesIndirectFloorLayer(field, floor, point, normal)
  const bias = floorLayer ? .004 : .02 + Math.abs(normal.x) * step.x + Math.abs(normal.y) * step.y + Math.abs(normal.z) * step.z
  const shifted = point.clone().addScaledVector(normal, bias), surface = point.clone().addScaledVector(normal, .004)
  const exact = (p: Vector3, source = field) => {
    const coefficients = new Float64Array(field.coefficientCount * 3)
    const support = sampleIndirectCoefficients(source, floor, p.x, p.y, p.z, coefficients, visibility)
    const unboundedRGB = irradiance(coefficients, normal, field.shOrder), confidence = floorLayer ? indirectFloorConfidence(support) : 1
    return { rgb: unboundedRGB.map(value => value * confidence) as RGB, support, confidence, unboundedRGB }
  }
  const exactAtSurface = exact(surface)
  const firstAtSurface = direct ? exact(surface, { ...field, coefficients: direct.map(channel => new Uint16Array(channel)) }) : null
  // Both estimates use identical positions, normals, visibility and support.
  // Subtract after evaluation, retaining signed differences rather than hiding
  // reductions caused by the finite capture/SH approximation.
  const brightness = (rgb: RGB) => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  const bounces = firstAtSurface ? (() => {
    const firstRGB = firstAtSurface.rgb, finalRGB = exactAtSurface.rgb
    const additionalRGB = finalRGB.map((value, channel) => value - firstRGB[channel]) as RGB
    const firstBrightness = brightness(firstRGB), finalBrightness = brightness(finalRGB)
    const additionalBrightness = finalBrightness - firstBrightness
    return { firstRGB, additionalRGB, finalRGB, firstBrightness, additionalBrightness, finalBrightness,
      gain: firstBrightness > 0 ? finalBrightness / firstBrightness : null,
      additionalPercent: finalBrightness > 0 ? additionalBrightness / finalBrightness * 100 : null }
  })() : null
  const visible = (origin: Vector3, target: Vector3) => {
    const direction = target.clone().sub(origin), distance = direction.length(), max = Math.max(0, distance - .001)
    return max <= .025 || visibility.distance(origin, direction.multiplyScalar(1 / distance), max) >= max
  }
  const probeRGB = (data: Uint16Array[], index: number) => irradiance(data.flatMap(channel =>
    Array.from(channel.subarray(index * field.coefficientCount, (index + 1) * field.coefficientCount), value => DataUtils.fromHalfFloat(value))), normal, field.shOrder)
  const probes = field.probes.filter(probe => probe.region.floorId === field.floors[floor].id && field.positionData[probe.index * 4 + 3] > .5)
    .map(probe => {
      const p = new Vector3().fromArray(field.positionData, probe.index * 4)
      return { index: probe.index, position: p.toArray(), distance: p.distanceTo(surface),
        visibleAtSurface: visible(p, surface), visibleAtShiftedSample: visible(p, shifted),
        finalRGB: probeRGB(field.coefficients, probe.index), firstPassRGB: direct ? probeRGB(direct, probe.index) : null }
    }).filter(probe => probe.distance < field.spacing * 1.75 + step.length()).sort((a, b) => a.distance - b.distance)
  return { floorId: field.floors[floor].id, point: point.toArray(), normal: normal.toArray(), shiftedPoint: shifted.toArray(),
    bias, gridStep: step.toArray(), floorLayer, floorGridStep: floorLayer ? field.bounds.size / (field.floorLayer.n - 1) : null,
    displayed: sampleDisplayedIndirect(field, floor, shifted, normal),
    exactAtSurface, exactAtShiftedSample: exact(shifted), bounces, probes,
    lamps: lights.map((light, index) => ({ index, ...light, visibleAtSurface: visible(new Vector3().fromArray(light.position), surface) })),
    note: 'RGB values are linear diffuse irradiance using the surface geometry normal, before material normal maps, colour, ambient fill and tone mapping. Exact blends use geometry visibility and the same baked probe coefficients; they are not fresh environment captures. Floor blends preserve weak probe support through confidence attenuation; unboundedRGB shows the blend before this attenuation.' }
}
