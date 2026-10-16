import { packIndirectBuffer, unpackIndirectBuffer, type PackedBuffer } from './indirectBufferCodec.ts'
export type IndirectCodecRequest = { id: number } & ({ kind: 'pack'; data: Uint8Array } | { kind: 'unpack'; data: PackedBuffer; byteLength: number })
self.onmessage = async ({ data }: MessageEvent<IndirectCodecRequest>) => {
  try {
    const result = data.kind === 'pack' ? await packIndirectBuffer(data.data) : await unpackIndirectBuffer(data.data, data.byteLength)
    self.postMessage({ id: data.id, ok: true, result }, { transfer: result instanceof ArrayBuffer ? [result] : [] })
  } catch (error) { self.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) }) }
}
