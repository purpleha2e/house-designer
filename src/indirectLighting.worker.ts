import type { IndirectProbeObstacle } from './indirectProbeObstacles.ts'
import { prepareIndirectCache, prepareIndirectCacheSteps } from './indirectLightingCache.ts'
import { restoreIndirectField, INDIRECT_MASK_SIZE, type IndirectFloor, type IndirectFieldData } from './indirectLighting.ts'
import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'
import { createIndirectFloorLookup, writeIndirectFloorLayer } from './indirectFloorLighting.ts'
import type { IndirectZoneChange, IndirectZoneProbe } from './indirectLightingZones.ts'
import { applyIndirectLampRows } from './indirectLampPreparation.ts'
import type { IndirectLampQuery } from './indirectLampPreparation.ts'
import { traceIndirectLampPorts } from './indirectLampPool.ts'
import { Vector3 } from 'three'
import { writeIndirectVisibility } from './indirectVisibility.ts'
import { createIndirectVolumeLookup, writeIndirectCeilingRow, writeIndirectVolumeRow } from './indirectVolume.ts'

export type IndirectWorkerRequest = { id: number } & (
  { kind: 'prepare'; floors: IndirectFloor[]; lights: [number, number, number][]; geometry: IndirectGeometrySnapshot; obstacles: IndirectProbeObstacle[];
    parallelLamps?: boolean; zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[]; captureNewOnly?: boolean } } |
  { kind: 'lampResult'; data?: Float32Array } |
  { kind: 'lampPorts'; ports: MessagePort[] } |
  { kind: 'volume' | 'preview'; coefficients: Uint16Array[]; positions: Float32Array } |
  { kind: 'plan'; previous: IndirectZoneProbe[]; changes: IndirectZoneChange[] } |
  { kind: 'lights'; positions: [number, number, number][]; zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[] } } |
  { kind: 'floor'; field: IndirectFieldData; coefficients: Uint16Array[]; geometry: IndirectGeometrySnapshot; refineVolume?: boolean })
let cache: ReturnType<typeof prepareIndirectCache> | null = null
let lampPending: { id: number; query: IndirectLampQuery; resolve: (data?: Float32Array) => void; cancel?: () => void } | undefined
let warmVersion = 0
let warmRows: Generator<void> | null = null
const warmChannel = new MessageChannel()
function stopWarming() { warmVersion++; warmRows = null }
// Message tasks yield to incoming previews without the nested timer's 4 ms
// minimum delay between batches. No second BVH or extra worker copy is needed.
warmChannel.port1.onmessage = (event: MessageEvent<number>) => {
  if (event.data !== warmVersion || !warmRows) return
  const end = performance.now() + 8
  try {
    do { if (warmRows.next().done) { warmRows = null; return } } while (performance.now() < end)
    warmChannel.port2.postMessage(warmVersion)
  } catch (error) {
    warmRows = null
    console.warn('GI background visibility unavailable:', error)
  }
}
function warmVisibility(prepared: NonNullable<typeof cache>) {
  warmRows = prepared.warmVisibility()
  warmChannel.port2.postMessage(warmVersion)
}
self.onmessage = async (event: MessageEvent<IndirectWorkerRequest>) => {
  const request = event.data
  try {
    if (request.kind === 'lampResult') {
      if (lampPending?.id === request.id) { lampPending.cancel?.(); lampPending.resolve(request.data); lampPending = undefined }
    } else if (request.kind === 'lampPorts') {
      if (lampPending?.id !== request.id) { request.ports.forEach(port => port.close()); return }
      const pending = lampPending, work = traceIndirectLampPorts(pending.query, request.ports)
      pending.cancel = work.cancel
      const data = await work.result
      if (lampPending === pending) { pending.resolve(data); lampPending = undefined }
    } else if (request.kind === 'prepare') {
      stopWarming()
      cache?.dispose()
      cache = null
      const steps = prepareIndirectCacheSteps(request.floors, request.lights, request.geometry, request.obstacles, request.zones,
        progress => self.postMessage({ id: request.id, progress }))
      let step = steps.next()
      while (!step.done) {
        const { field, visibility, lights } = step.value
        const data = request.parallelLamps ? await new Promise<Float32Array | undefined>(resolve => {
          lampPending = { id: request.id, resolve, query: { visibility: visibility.snapshot(), lights, size: field.distanceSize } }
          self.postMessage({ id: request.id, lampQuery: true, lampRows: field.distanceSize * lights.length })
        }) : undefined
        if (data) { applyIndirectLampRows(field, 0, data); field.distances.needsUpdate = true }
        else lights.forEach((light, index) => writeIndirectVisibility(field, index, new Vector3(...light), visibility))
        step = steps.next()
      }
      cache = step.value
      self.postMessage({ id: request.id, ok: true, value: cache.snapshot() })
      warmVisibility(cache)
    } else if (request.kind === 'lights') {
      if (!cache) throw new Error('GI geometry has not been prepared')
      const data = cache.updateLights(request.positions)
      const zonePlan = request.zones ? cache.plan(request.zones.previous, request.zones.changes) : undefined
      self.postMessage({ id: request.id, ok: true, value: { ...data, zonePlan } }, { transfer: [data.distances.buffer, data.positions.buffer] })
    } else if (request.kind === 'plan') {
      if (!cache) throw new Error('GI geometry has not been prepared')
      self.postMessage({ id: request.id, ok: true, value: cache.plan(request.previous, request.changes) })
    } else if (request.kind === 'floor') {
      const field = restoreIndirectField(request.field), visibility = createIndirectVisibilityFromSnapshot(request.geometry)
      try {
        request.coefficients.forEach((data, i) => field.coefficients[i].set(data))
        if (request.refineVolume) {
          const structure = createIndirectVisibilityFromSnapshot(request.geometry.filter(part => part.structural))
          try {
            for (let row = 0; row < field.floors.length * INDIRECT_MASK_SIZE; row++) writeIndirectCeilingRow(field, row, structure)
          } finally { structure.dispose() }
          const volumeLookup = createIndirectVolumeLookup(field, visibility), result = new Float64Array(12)
          volumeLookup.refreshCoefficients()
          for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility, volumeLookup)
        }
        const lookup = createIndirectFloorLookup(field, visibility)
        lookup.refreshCoefficients(); writeIndirectFloorLayer(field, visibility, lookup)
        const data = field.floorLayer.data
        if (request.refineVolume) {
          const volume = field.volume.data, mask = field.mask.image.data as Uint8Array
          self.postMessage({ id: request.id, ok: true, value: { floor: data, volume, mask } }, { transfer: [data.buffer, volume.buffer, mask.buffer] })
        } else self.postMessage({ id: request.id, ok: true, value: data }, { transfer: [data.buffer] })
      } finally { field.dispose(); visibility.dispose() }
    } else {
      if (!cache) throw new Error('GI geometry has not been prepared')
      // Once final evaluation starts it finishes any remaining weights itself.
      if (request.kind === 'volume') stopWarming()
      const data = request.kind === 'preview' ? cache.preview(request.coefficients, request.positions) :
        { volume: cache.volume(request.coefficients, request.positions), floor: cache.field.floorLayer.data.slice() }
      self.postMessage({ id: request.id, ok: true, value: data }, { transfer: [data.volume.buffer, data.floor.buffer] })
    }
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
