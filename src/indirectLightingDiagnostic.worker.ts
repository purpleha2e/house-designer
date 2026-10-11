import { Vector3 } from 'three'
import { restoreIndirectField, type IndirectFieldData } from './indirectLighting.ts'
import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'
import { inspectIndirectPoint } from './indirectLightingDiagnostic.ts'
import { sampleIndirectFloorCandidate } from './indirectFloorLighting.ts'

export type IndirectInspectionRequest = { field: IndirectFieldData; coefficients: Uint16Array[]; volume: Uint16Array;
  floorLayer?: Uint16Array;
  geometry: IndirectGeometrySnapshot; point: number[]; normal: number[]; direct?: Uint16Array[];
  lights: { position: number[]; color: string }[] }
self.onmessage = (event: MessageEvent<IndirectInspectionRequest>) => {
  const request = event.data, field = restoreIndirectField(request.field)
  const visibility = createIndirectVisibilityFromSnapshot(request.geometry)
  try {
    request.coefficients.forEach((data, i) => field.coefficients[i].set(data)); field.volume.data.set(request.volume)
    if (request.floorLayer) { field.floorLayer.data.set(request.floorLayer); field.floorLayer.ready = true }
    const point = new Vector3().fromArray(request.point), normal = new Vector3().fromArray(request.normal)
    const result = inspectIndirectPoint(field, visibility, point, normal, request.lights, request.direct)
    const floor = field.floors.findIndex(f => f.id === result.floorId)
    self.postMessage({ ok: true, result: { ...result, floorCandidates: [.08, .06, .04, .02].map(spacing =>
      sampleIndirectFloorCandidate(field, visibility, floor, point, normal, spacing)) } })
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
  finally { field.dispose(); visibility.dispose() }
}
