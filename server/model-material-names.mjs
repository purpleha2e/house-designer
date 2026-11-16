import { open, readFile } from 'node:fs/promises'
import { extname } from 'node:path'

/** Names of materials actually assigned to mesh primitives, in authored order. */
export function modelMaterialNamesFromJson(json) {
  const used = new Set((json.meshes ?? []).flatMap(mesh =>
    (mesh.primitives ?? []).map(primitive => primitive.material)))
  return [...new Set((json.materials ?? []).flatMap((material, index) =>
    used.has(index) && typeof material.name === 'string' ? [material.name] : []))]
}

/** Read only the JSON chunk: discovering slots must not decode textures or
 * copy a model's potentially large binary geometry into the catalogue server. */
export async function readModelMaterialNames(path) {
  const extension = extname(path).toLowerCase()
  if (extension === '.gltf') return modelMaterialNamesFromJson(JSON.parse(await readFile(path, 'utf8')))
  if (extension !== '.glb') return []
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(20)
    const { bytesRead } = await file.read(header, 0, 20, 0)
    if (bytesRead !== 20 || header.toString('ascii',0,4) !== 'glTF' || header.readUInt32LE(4) !== 2 || header.readUInt32LE(16) !== 0x4e4f534a)
      throw Error('Invalid GLB JSON header')
    const length = header.readUInt32LE(12), size = (await file.stat()).size
    if (length > size - 20 || length > 32 * 1024 * 1024) throw Error('Invalid GLB JSON length')
    const bytes = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await file.read(bytes, offset, length-offset, 20+offset)
      if (!read.bytesRead) throw Error('Truncated GLB JSON')
      offset += read.bytesRead
    }
    return modelMaterialNamesFromJson(JSON.parse(bytes.toString('utf8')))
  } finally { await file.close() }
}
