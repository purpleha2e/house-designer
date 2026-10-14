import type { IndirectLampQuery } from './indirectLampPreparation.ts'

/** Owned by the renderer client, so cancelling GI immediately kills every helper. */
export class IndirectLampPool {
  private workers: Worker[] = []
  private reject: ((error: Error) => void) | undefined
  constructor(count: number) {
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./indirectLamp.worker.ts', import.meta.url), { type: 'module' })
        worker.onerror = event => this.dispose(new Error(event.message || 'GI lamp helper failed'))
        this.workers.push(worker)
      }
    } catch (error) { this.dispose(); throw error }
  }
  trace(query: IndirectLampQuery) {
    return new Promise<Float32Array>((resolve, reject) => {
      this.reject = reject
      const rows = query.size * query.lights.length, data = new Float32Array(rows * query.size)
      const workers = this.workers.slice()
      let remaining = workers.length
      if (!remaining) { reject(new Error('GI lamp pool is closed')); return }
      for (const [index, worker] of workers.entries()) {
        const firstRow = Math.floor(index * rows / workers.length), end = Math.floor((index + 1) * rows / workers.length)
        worker.onerror = event => this.dispose(new Error(event.message || 'GI lamp helper failed'))
        worker.onmessage = event => {
          if (!event.data.ok) { this.dispose(new Error(event.data.error)); return }
          data.set(event.data.data, firstRow * query.size)
          if (--remaining === 0) { this.reject = undefined; this.dispose(); resolve(data) }
        }
        try { worker.postMessage({ ...query, firstRow, rowCount: end - firstRow }) }
        catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); break }
      }
    })
  }
  dispose(error = new Error('GI work superseded')) {
    this.workers.forEach(worker => worker.terminate()); this.workers = []
    this.reject?.(error); this.reject = undefined
  }
}
