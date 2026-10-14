import type { WallMeshFace } from './wallMesh.ts'
import { createWallRoofClipJob, type WallRoofClipOptions } from './wallRoofClipJob.ts'

let pendingJobs = 0
const listeners = new Set<() => void>()
// Keep a small warm pool: reloading the geometry modules and warming the JIT
// for every mouse release costs more than a typical opening cut itself.
const idleWorkers: Worker[] = []
export function disposeIdleWallClippingWorkers() {
  idleWorkers.splice(0).forEach(worker => worker.terminate())
}
export const isWallClippingPending = () => pendingJobs > 0
export function subscribeWallClipping(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function changePendingJobs(delta: number) {
  const wasPending = pendingJobs > 0
  pendingJobs += delta
  if (wasPending !== (pendingJobs > 0)) listeners.forEach(listener => listener())
}

export function clipWallFacesInWorker(faces: WallMeshFace[], options: WallRoofClipOptions, signal: AbortSignal): Promise<WallMeshFace[]> {
  if (signal.aborted) return Promise.reject(signal.reason)
  if (!options.volumes.length || !faces.length) return Promise.resolve(faces)
  changePendingJobs(1)
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined
    let settled = false
    const cleanup = (reuse = false) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (worker) {
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
        if (reuse && idleWorkers.length < 2) idleWorkers.push(worker)
        else worker.terminate()
      }
      changePendingJobs(-1)
    }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const abort = () => fail(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      worker = idleWorkers.pop() ?? new Worker(new URL('./wallRoofClip.worker.ts', import.meta.url), { type: 'module' })
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => {
        if (signal.aborted || settled) return
        cleanup(data.ok)
        if (data.ok) resolve(data.faces)
        else reject(new Error(data.error))
      }
      worker.onerror = event => fail(event.error ?? new Error(event.message))
      worker.onmessageerror = () => fail(new Error('Wall clipping worker response could not be read.'))
      worker.postMessage(createWallRoofClipJob(faces, options))
    } catch (error) { fail(error) }
  })
}
