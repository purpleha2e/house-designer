import { DataUtils } from 'three'
import type { IndirectField } from './indirectLighting.ts'
import { createIndirectVolume } from './indirectVolume.ts'
import { createIndirectFloorLayer } from './indirectFloorLighting.ts'

/** Share immutable layout/atlases, but own smaller display-only lighting textures.
 * Never use these textures as bounce inputs or save them as a completed bake. */
export function createIndirectPreviewField(field: IndirectField): IndirectField {
  const volume = createIndirectVolume(field.bounds.size, field.floors.length, .64, 32)
  const floorLayer = createIndirectFloorLayer(field.bounds.size, field.floors.length, .16, 128)
  return { ...field, volume, floorLayer, dispose() { volume.dispose(); floorLayer.dispose() } }
}

export type IndirectPreviewBaseline = { field: IndirectField; direct?: Uint16Array[]; final: Uint16Array[] }

/** Retain unchanged support. During bounce one, add the measured direct-light
 * change to the previous final result; bounce two replaces this approximation. */
export function indirectPreviewCoefficients(field: IndirectField, updated: ReadonlySet<number>, pass: number,
  previous?: IndirectPreviewBaseline | null) {
  const coefficients = field.coefficients.map(data => data.slice())
  const positions = field.positionData.slice()
  const old = new Map(previous?.field.probes.map(probe => [probe.index, probe]))
  for (const probe of field.probes) {
    const before = old.get(probe.index), offset = probe.index * 4
    const retained = before?.region.floorId === probe.region.floorId && before.position.distanceToSquared(probe.position) < 1e-8
    if (retained && (!updated.has(probe.index) || (pass === 1 && previous?.direct))) {
      coefficients.forEach((data, colour) => {
        for (let i = 0; i < 4; i++) {
          const final = previous!.final[colour][offset + i]
          data[offset + i] = updated.has(probe.index) ? DataUtils.toHalfFloat(
            DataUtils.fromHalfFloat(final) + DataUtils.fromHalfFloat(data[offset + i]) -
            DataUtils.fromHalfFloat(previous!.direct![colour][offset + i])) : final
        }
      })
    } else if (pass === 1 && !updated.has(probe.index)) positions[offset + 3] = 0
  }
  return { coefficients, positions }
}

/** One request at a time; periodically publish the latest captures, not a backlog. */
export function shouldPublishLivePreview(completed: number, previousCompleted: number, now: number, previousTime: number) {
  return completed >= 4 && completed - previousCompleted >= 4 && now - previousTime >= 300
}

/** Navigation keeps one occasional face. A stationary view can fill a cubemap
 * within its time budget, even when a previous GI batch made that frame slow. */
export function liveIndirectFaceBudget(frameSeconds: number, moving: boolean, now: number, lastCapture: number, legacy = false) {
  if (moving && (frameSeconds > 1 / 28 || now - lastCapture < 50)) return 0
  return moving || (legacy && frameSeconds > 1 / 35) ? 1 : 6
}

export function liveIndirectTimeBudget(frameSeconds: number, moving: boolean) {
  return moving ? 3 : frameSeconds > 1 / 25 ? 4 : 8
}
