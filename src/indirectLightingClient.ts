import type { IndirectWorkerRequest } from './indirectLighting.worker.ts'
import type { IndirectInterpolationProfile,PreparedIndirectCache } from './indirectLightingCache.ts'
import type { IndirectZoneChange, IndirectZonePlan, IndirectZoneProbe } from './indirectLightingZones.ts'
import type { IndirectPreparationProgress } from './indirectPreparation.ts'
import { IndirectLampPool } from './indirectLampPool.ts'
import type { IndirectInterpolationGraph } from './indirectVolume.ts'
import type {IndirectContactReceiverQuery} from './indirectContactReceivers.ts'

/** Cancel obsolete active work, while retaining an idle worker's loaded modules
 * and warm ray-tracing code for the next edit. */
export class IndirectLightingClient {
  private worker: Worker | null = null
  private lampPool: IndirectLampPool | null = null
  private lampWorkerCount = 0
  private nextId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void;
    progress?: (progress: IndirectPreparationProgress) => void }>()
  private async request<T>(request: Omit<Extract<IndirectWorkerRequest, { kind: 'prepare' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'volume' | 'preview' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'plan' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'gpuPreview' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'contactReceivers' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'lights' }>, 'id'> |
    Omit<Extract<IndirectWorkerRequest, { kind: 'floor' }>, 'id'>,
    progress?: (progress: IndirectPreparationProgress) => void): Promise<T> {
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./indirectLighting.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = event => {
        if (this.worker !== worker) return
        const { id, ok, value, error, progress, lampQuery } = event.data, pending = this.pending.get(id)
        if (!pending) return
        if (progress) {
          // Loading helpers before the coordinator's module delays its startup
          // in development. Overlap their imports with the expensive BVH build.
          if (progress.stage === 'geometry' && this.lampWorkerCount && !this.lampPool) {
            try { this.lampPool = new IndirectLampPool(this.lampWorkerCount) } catch { /* serial worker fallback */ }
          }
          pending?.progress?.(progress); return
        }
        if (lampQuery) {
          const worker = this.worker, pool = this.lampPool
          if (lampQuery === true && pool) { pool.connect(worker!, id); return }
          const finish = (data?: Float32Array) => {
            if (this.worker !== worker || !this.pending.has(id)) return
            worker!.postMessage({ id, kind: 'lampResult', data }, data ? [data.buffer] : [])
            pool?.dispose()
            if (this.lampPool === pool) this.lampPool = null
          }
          if (pool && lampQuery !== true) pool.trace(lampQuery).then(finish, () => finish())
          else finish()
          return
        }
        this.pending.delete(id)
        if (this.lampPool) { this.lampPool.dispose(); this.lampPool = null }
        if (ok) pending?.resolve(value); else pending?.reject(new Error(error))
      }
      worker.onerror = event => {
        if (this.worker !== worker) return
        const reason = event.message || event.error?.message || 'GI worker failed to load or stopped unexpectedly'
        const location = event.filename ? ` (${event.filename}${event.lineno ? `:${event.lineno}:${event.colno || 0}` : ''})` : ''
        this.dispose(new Error(`${reason}${location}`))
      }
      worker.onmessageerror = () => {
        if (this.worker === worker) this.dispose(new Error('GI worker response could not be decoded'))
      }
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject, progress })
      this.worker!.postMessage({ ...request, id })
    })
  }
  prepare(request: Omit<Extract<IndirectWorkerRequest, { kind: 'prepare' }>, 'id' | 'kind'>,
    onProgress?: (progress: IndirectPreparationProgress) => void) {
    if (this.pending.size) this.dispose()
    // Reserve cores for rendering and the coordinator.
    const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1
    const count = Math.min(3, Math.max(0, cores - 2))
    const triangles = request.geometry.reduce((sum, part) => sum + part.matrices.length *
      part.ranges.reduce((total, range) => total + Math.floor(range.count / 3), 0), 0)
    // Small scenes finish their rays before helper imports/copies pay for themselves.
    this.lampWorkerCount = count > 1 && request.lights.length && triangles >= 25000 ? count : 0
    return this.request<PreparedIndirectCache>({ ...request, kind: 'prepare', parallelLamps: !!this.lampWorkerCount }, onProgress)
  }
  volume(coefficients: Uint16Array[], positions: Float32Array) {
    return this.request<{ volume: Uint16Array; floor: Uint16Array;interpolationProfile?:IndirectInterpolationProfile }>({ kind: 'volume', coefficients, positions })
  }
  preview(coefficients: Uint16Array[], positions: Float32Array) {
    return this.request<{ volume: Uint16Array; floor: Uint16Array }>({ kind: 'preview', coefficients, positions })
  }
  plan(previous: IndirectZoneProbe[], changes: IndirectZoneChange[]) {
    return this.request<IndirectZonePlan>({ kind: 'plan', previous, changes })
  }
  gpuPreview() {
    return this.request<{ volume: IndirectInterpolationGraph; floor: IndirectInterpolationGraph }>({ kind: 'gpuPreview' })
  }
  contactReceivers(query:IndirectContactReceiverQuery){return this.request<Int16Array>({...query,kind:'contactReceivers'})}
  lights(positions: [number, number, number][], zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[] }) {
    return this.request<{ distances: Float32Array; positions: Float32Array; zonePlan?: IndirectZonePlan }>({ kind: 'lights', positions, zones })
  }
  floor(request: Omit<Extract<IndirectWorkerRequest, { kind: 'floor' }>, 'id' | 'kind'>) {
    return this.request<Uint16Array>({ ...request, kind: 'floor' })
  }
  refineVolume(request: Omit<Extract<IndirectWorkerRequest, { kind: 'floor' }>, 'id' | 'kind' | 'refineVolume'>) {
    return this.request<{ floor: Uint16Array; volume: Uint16Array; mask: Uint8Array }>({ ...request, kind: 'floor', refineVolume: true })
  }
  dispose(error = new Error('GI work superseded')) {
    this.lampPool?.dispose(error); this.lampPool = null
    this.lampWorkerCount = 0
    this.worker?.terminate(); this.worker = null
    this.pending.forEach(pending => pending.reject(error)); this.pending.clear()
  }
}
