import type { IndirectWorkerRequest } from './indirectLighting.worker.ts'
import type { PreparedIndirectCache } from './indirectLightingCache.ts'

/** Replacing the worker cancels obsolete geometry work, rather than queueing edits behind it. */
export class IndirectLightingClient {
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private request<T>(request: Omit<Extract<IndirectWorkerRequest, { kind: 'prepare' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'volume' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'floor' }>, 'id'>): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./indirectLighting.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = event => {
        const { id, ok, value, error } = event.data, pending = this.pending.get(id)
        this.pending.delete(id)
        if (ok) pending?.resolve(value); else pending?.reject(new Error(error))
      }
      this.worker.onerror = event => { this.dispose(new Error(event.message || 'GI worker failed')) }
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      this.worker!.postMessage({ ...request, id })
    })
  }
  prepare(request: Omit<Extract<IndirectWorkerRequest, { kind: 'prepare' }>, 'id' | 'kind'>) {
    this.dispose()
    return this.request<PreparedIndirectCache>({ ...request, kind: 'prepare' })
  }
  volume(coefficients: Uint16Array[], positions: Float32Array) {
    return this.request<{ volume: Uint16Array; floor: Uint16Array }>({ kind: 'volume', coefficients, positions })
  }
  floor(request: Omit<Extract<IndirectWorkerRequest, { kind: 'floor' }>, 'id' | 'kind'>) {
    return this.request<Uint16Array>({ ...request, kind: 'floor' })
  }
  dispose(error = new Error('GI work superseded')) {
    this.worker?.terminate(); this.worker = null
    this.pending.forEach(pending => pending.reject(error)); this.pending.clear()
  }
}
