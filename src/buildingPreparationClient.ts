import type { BuildingPreparationRequest } from './buildingPreparation.ts'

// Geometry, gables and cache-key checks share the same worker module. Preserve
// its loaded modules and warm JIT across edits instead of restarting each job.
const idleWorkers: Worker[] = []
export function disposeIdleBuildingPreparationWorkers() {
  idleWorkers.splice(0).forEach(worker => worker.terminate())
}

export function requestBuildingPreparation<T>(data: BuildingPreparationRequest, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker | undefined, settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (worker) {
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
        if (!error && idleWorkers.length < 2) idleWorkers.push(worker)
        else worker.terminate()
      }
      if (error) reject(error); else resolve(value!)
    }
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      if (signal.aborted) { abort(); return }
      worker = idleWorkers.pop() ?? new Worker(new URL('./buildingPreparation.worker.ts', import.meta.url), { type: 'module' })
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => data.ok ? finish(undefined, data.result) : finish(new Error(data.error))
      worker.onerror = event => finish(new Error(event.message || 'Building preparation failed'))
      worker.onmessageerror = () => finish(new Error('Building preparation response could not be read'))
      worker.postMessage(data)
    } catch (error) { finish(error) }
  })
}

if (import.meta.hot) import.meta.hot.dispose(disposeIdleBuildingPreparationWorkers)
