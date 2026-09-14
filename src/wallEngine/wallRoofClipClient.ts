import type { WallMeshFace } from './wallMesh.ts'
import { createWallRoofClipJob, type WallRoofClipOptions } from './wallRoofClipJob.ts'

export function clipWallFacesInWorker(faces: WallMeshFace[], options: WallRoofClipOptions, signal: AbortSignal): Promise<WallMeshFace[]> {
  if (signal.aborted) return Promise.reject(signal.reason)
  if (!options.volumes.length || !faces.length) return Promise.resolve(faces)
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined
    const cleanup = () => { signal.removeEventListener('abort', abort); worker?.terminate() }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const abort = () => fail(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      worker = new Worker(new URL('./wallRoofClip.worker.ts', import.meta.url), { type: 'module' })
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => {
        if (signal.aborted) return
        cleanup()
        if (data.ok) resolve(data.faces)
        else reject(new Error(data.error))
      }
      worker.onerror = event => fail(event.error ?? new Error(event.message))
      worker.onmessageerror = () => fail(new Error('Wall clipping worker response could not be read.'))
      worker.postMessage(createWallRoofClipJob(faces, options))
    } catch (error) { fail(error) }
  })
}
