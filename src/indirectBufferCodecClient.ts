import { packIndirectBuffer, unpackIndirectBuffer, type PackedBuffer } from './indirectBufferCodec.ts'
import type { IndirectCodecRequest } from './indirectBufferCodec.worker.ts'

let worker: Worker | undefined, nextId = 0
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
function request<T>(message: Omit<Extract<IndirectCodecRequest, { kind: 'pack' }>, 'id'> | Omit<Extract<IndirectCodecRequest, { kind: 'unpack' }>, 'id'>) {
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId
    try {
      if (!worker) {
        worker = new Worker(new URL('./indirectBufferCodec.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = ({ data }) => {
          const job = pending.get(data.id); pending.delete(data.id)
          if (data.ok) job?.resolve(data.result); else job?.reject(new Error(data.error))
          if (!pending.size) { worker?.terminate(); worker = undefined }
        }
        const fail = () => {
          worker?.terminate(); worker = undefined
          pending.forEach(job => job.reject(new Error('Lighting cache worker failed'))); pending.clear()
        }
        worker.onerror = fail; worker.onmessageerror = fail
      }
      pending.set(id, { resolve: value => resolve(value as T), reject })
      worker.postMessage({ ...message, id })
    } catch (error) {
      pending.delete(id)
      if (!pending.size) { worker?.terminate(); worker = undefined }
      reject(error)
    }
  })
}
export function pack(data: ArrayBufferView): Promise<PackedBuffer> {
  if (typeof Worker === 'undefined') return packIndirectBuffer(data)
  // The live textures keep ownership of their arrays. Only the worker's decoded
  // results are transferred; source buffers must never be detached.
  return request({ kind: 'pack', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
}
export function unpack(data: PackedBuffer, byteLength: number): Promise<ArrayBuffer> {
  if (typeof Worker === 'undefined') return unpackIndirectBuffer(data, byteLength)
  return request({ kind: 'unpack', data, byteLength })
}
