import { prepareIndirectCache } from './indirectLightingCache.ts'
import { restoreIndirectField, type IndirectFloor, type IndirectFieldData } from './indirectLighting.ts'
import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'
import { createIndirectFloorLookup, writeIndirectFloorLayer } from './indirectFloorLighting.ts'
import type { IndirectZoneChange, IndirectZoneProbe } from './indirectLightingZones.ts'

export type IndirectWorkerRequest = { id: number } & (
  { kind: 'prepare'; floors: IndirectFloor[]; lights: [number, number, number][]; geometry: IndirectGeometrySnapshot; obstacles: { min: number[]; max: number[] }[];
    zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[]; captureNewOnly?: boolean } } |
  { kind: 'volume'; coefficients: Uint16Array[]; positions: Float32Array } |
  { kind: 'floor'; field: IndirectFieldData; coefficients: Uint16Array[]; geometry: IndirectGeometrySnapshot })
let cache: ReturnType<typeof prepareIndirectCache> | null = null
self.onmessage = (event: MessageEvent<IndirectWorkerRequest>) => {
  const request = event.data
  try {
    if (request.kind === 'prepare') {
      cache?.dispose()
      cache = prepareIndirectCache(request.floors, request.lights, request.geometry, request.obstacles, request.zones)
      self.postMessage({ id: request.id, ok: true, value: cache.snapshot() })
    } else if (request.kind === 'floor') {
      const field = restoreIndirectField(request.field), visibility = createIndirectVisibilityFromSnapshot(request.geometry)
      try {
        request.coefficients.forEach((data, i) => field.coefficients[i].set(data))
        const lookup = createIndirectFloorLookup(field, visibility)
        lookup.refreshCoefficients(); writeIndirectFloorLayer(field, visibility, lookup)
        const data = field.floorLayer.data
        self.postMessage({ id: request.id, ok: true, value: data }, { transfer: [data.buffer] })
      } finally { field.dispose(); visibility.dispose() }
    } else {
      if (!cache) throw new Error('GI geometry has not been prepared')
      const data = cache.volume(request.coefficients, request.positions)
      const floor = cache.field.floorLayer.data.slice()
      self.postMessage({ id: request.id, ok: true, value: { volume: data, floor } }, { transfer: [data.buffer, floor.buffer] })
    }
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
