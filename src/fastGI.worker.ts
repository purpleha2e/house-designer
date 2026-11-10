/// <reference lib="webworker" />
import { voxelizeFastGeometry } from './fastGIGeometry.ts'
self.onmessage = event => {
  const { id, parts, min, size, n } = event.data
  try {
    const started = performance.now(), result = voxelizeFastGeometry(parts, min, size, n)
    self.postMessage({ id, ...result, ms: performance.now() - started }, { transfer: [result.data.buffer] })
  } catch (error) { self.postMessage({ id, error: String(error) }) }
}
