import type { RoofAssemblyInput } from './roofAssembly.ts'
import { createRoofAssemblyJob, restoreRoofAssemblyResult, type RoofAssemblyResult } from './roofAssemblyJob.ts'

let pending = 0
const listeners = new Set<() => void>()
export const isRoofAssemblyPending = () => pending > 0
export function subscribeRoofAssembly(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function update(delta: number) { pending += delta; listeners.forEach(listener => listener()) }
export function prepareRoofAssembly(inputs: RoofAssemblyInput[], signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  update(1)
  return new Promise<ReturnType<typeof restoreRoofAssemblyResult>>((resolve, reject) => {
    let worker: Worker | undefined, settled = false
    const finish = (error?: unknown, result?: RoofAssemblyResult) => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', abort); worker?.terminate(); update(-1)
      if (error) reject(error)
      else { try { resolve(restoreRoofAssemblyResult(result!)) } catch (error) { reject(error) } }
    }
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    try {
      worker = new Worker(new URL('./roofAssembly.worker.ts', import.meta.url), { type: 'module' })
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => data.ok ? finish(undefined, data.result) : finish(new Error(data.error))
      worker.onerror = event => finish(new Error(event.message || 'Roof preparation failed'))
      worker.onmessageerror = () => finish(new Error('Roof preparation response could not be read'))
      worker.postMessage(createRoofAssemblyJob(inputs))
    } catch (error) { finish(error) }
  })
}
