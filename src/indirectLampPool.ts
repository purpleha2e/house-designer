import type { IndirectLampQuery } from './indirectLampPreparation.ts'

/** Owned by the renderer client, so cancelling GI immediately kills every helper. */
export class IndirectLampPool {
  private workers: Worker[] = []
  private reject: ((error: Error) => void) | undefined
  private connectionFailed: (() => void) | undefined
  constructor(count: number) {
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./indirectLamp.worker.ts', import.meta.url), { type: 'module' })
        worker.onerror = event => this.dispose(new Error(event.message || 'GI lamp helper failed'))
        this.workers.push(worker)
      }
    } catch (error) { this.dispose(); throw error }
  }
  /** Send only ports through the UI. The large visibility tree and lamp pixels
   * travel directly between the coordinator and helpers, off the main thread. */
  connect(coordinator: Worker, id: number) {
    const ports: MessagePort[] = []
    this.connectionFailed = () => coordinator.postMessage({ id, kind: 'lampResult' })
    try {
      if (!this.workers.length) throw new Error('GI lamp pool is closed')
      for (const worker of this.workers) {
        const channel = new MessageChannel()
        worker.postMessage({ port: channel.port1 }, [channel.port1])
        ports.push(channel.port2)
      }
      coordinator.postMessage({ id, kind: 'lampPorts', ports }, ports)
    } catch (error) {
      ports.forEach(port => port.close())
      this.dispose(error instanceof Error ? error : new Error(String(error)))
    }
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
    this.connectionFailed?.(); this.connectionFailed = undefined
  }
}

/** Runs in the coordinator worker. Cancellation closes every message port. */
export function traceIndirectLampPorts(query: IndirectLampQuery, ports: MessagePort[]) {
  const rows = query.size * query.lights.length, data = new Float32Array(rows * query.size)
  let finish: (data: Float32Array | undefined) => void
  const result = new Promise<Float32Array | undefined>(resolve => { finish = resolve })
  let remaining = ports.length, settled = false
  const close = (value?: Float32Array) => {
    if (settled) return
    settled = true
    ports.forEach(port => port.close())
    finish(value)
  }
  if (!remaining) close()
  ports.forEach((port, index) => {
    const firstRow = Math.floor(index * rows / ports.length), end = Math.floor((index + 1) * rows / ports.length)
    port.onmessageerror = () => close()
    port.onmessage = ({ data: response }) => {
      if (settled) return
      if (!response.ok) { close(); return }
      data.set(response.data, firstRow * query.size)
      if (--remaining === 0) close(data)
    }
    try { port.postMessage({ ...query, firstRow, rowCount: end - firstRow }) }
    catch { close() }
  })
  return { result, cancel: () => close() }
}
