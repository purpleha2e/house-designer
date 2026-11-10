import type { WallMeshFace } from './wallMesh.ts'
import type { WallSelectionInput } from './wallSelectionPreparation.ts'
import type { WallBufferGeometryPayload } from './wallBuffer.ts'
import type { WallRenderJob, prepareWallRendering } from './wallRenderPreparation.ts'
import { createWallRoofClipInputJob, createWallRoofClipJob, type WallRoofClipInput, type WallRoofClipInputJob, type WallRoofClipJob, type WallRoofClipOptions } from './wallRoofClipJob.ts'
import { wallWorkerMessages } from './wallWorkerMessages.ts'
import { waitForViewportIdle } from '../viewportScheduling.ts'

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
  return requestClipJob(createWallRoofClipJob(faces, options), signal)
}
export function clipWallFacesForRoofsInWorker(faces: WallMeshFace[], input: WallRoofClipInput, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  if (!faces.length) return Promise.resolve(faces)
  return requestClipJob(createWallRoofClipInputJob(faces, input), signal)
}
export type PreparedWallSelection = { faces: WallMeshFace[]; pickPayload: WallBufferGeometryPayload;
  rendering?: ReturnType<typeof prepareWallRendering> }
export function prepareWallFacesForRoofsInWorker(faces: WallMeshFace[], input: WallRoofClipInput,
  selection: WallSelectionInput, signal: AbortSignal, render?: Omit<WallRenderJob, 'kind' | 'faces'>): Promise<PreparedWallSelection> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return requestClipJob<PreparedWallSelection>({ ...createWallRoofClipInputJob(faces, input), selection, render }, signal)
}
export function prepareWallRenderingInWorker(job: WallRenderJob, signal: AbortSignal) {
  if(signal.aborted)return Promise.reject(signal.reason)
  return requestClipJob<ReturnType<typeof prepareWallRendering>>(job,signal)
}
function requestClipJob<T = WallMeshFace[]>(job: WallRenderJob | WallRoofClipJob | WallRoofClipInputJob | (WallRoofClipInputJob & { selection: WallSelectionInput; render?: Omit<WallRenderJob, 'kind' | 'faces'> }), signal: AbortSignal): Promise<T> {
  changePendingJobs(1)
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined
    let settled = false
    const receivedFaces: WallMeshFace[] = []
    const receivedRenderFaces: WallMeshFace[] = []
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
        if (data.stream === 'faces') { receivedFaces.push(...data.faces); return }
        if (data.stream === 'renderFaces') { receivedRenderFaces.push(...data.faces); return }
        if (data.streamedFaces) {
          if (data.result) data.result.renderFaces = receivedFaces
          else data.faces = receivedFaces
        }
        cleanup(data.ok)
        if (data.ok) resolve('kind' in job ? data.result : 'selection' in job ? { faces: data.faces, pickPayload: data.pickPayload,
          rendering: data.renderPayload ? { renderFaces: receivedRenderFaces, payload: data.renderPayload } : undefined } as T : data.faces)
        else reject(new Error(data.error))
      }
      worker.onerror = event => fail(event.error ?? new Error(event.message))
      worker.onmessageerror = () => fail(new Error('Wall clipping worker response could not be read.'))
      const messages = wallWorkerMessages(job)
      const first = messages.next()
      if (!first.done) worker.postMessage(first.value)
      if (!first.done && 'stream' in first.value) void (async () => {
        for (const message of messages) {
          if (!await waitForViewportIdle(() => signal.aborted || settled)) return
          worker!.postMessage(message)
        }
      })().catch(fail)
    } catch (error) { fail(error) }
  })
}
