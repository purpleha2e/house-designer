import { buildRoomLightOcclusion, type RoomOcclusionLight } from './roomLightOcclusion.ts'
import type { IndirectGeometrySnapshot } from './indirectVisibility.ts'

self.onmessage = (event: MessageEvent<{ geometry: IndirectGeometrySnapshot; lights: RoomOcclusionLight[] }>) => {
  try {
    const result = buildRoomLightOcclusion(event.data.geometry, event.data.lights)
    self.postMessage({ ok: true, result }, { transfer: [result.records.buffer] })
  } catch (error) { self.postMessage({ ok: false, error: String(error) }) }
}
