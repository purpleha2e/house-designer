export type PackedBuffer = { encoding: 'gzip-base64' | 'base64'; data: string }

export async function packIndirectBuffer(data: ArrayBufferView): Promise<PackedBuffer> {
  let bytes = new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  const encoding = typeof CompressionStream === 'undefined' ? 'base64' : 'gzip-base64'
  if (encoding === 'gzip-base64') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { encoding, data: btoa(binary) }
}
export async function unpackIndirectBuffer(buffer: PackedBuffer, byteLength: number) {
  if (!buffer || !['base64', 'gzip-base64'].includes(buffer.encoding) || typeof buffer.data !== 'string' || buffer.data.length > byteLength * 2 + 4096) throw new Error('Invalid GI buffer')
  const binary = atob(buffer.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  if (buffer.encoding === 'base64') { if (bytes.byteLength !== byteLength) throw new Error('Invalid GI buffer length'); return bytes.buffer }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const result = new Uint8Array(byteLength)
  let offset = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (offset + chunk.value.length > byteLength) throw new Error('Invalid GI decompressed length')
      result.set(chunk.value, offset); offset += chunk.value.length
    }
  } finally { await reader.cancel() }
  if (offset !== byteLength) throw new Error('Incomplete GI buffer')
  return result.buffer
}
