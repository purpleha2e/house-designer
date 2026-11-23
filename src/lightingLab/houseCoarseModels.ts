import { MeshoptSimplifier } from 'meshoptimizer/simplifier'
import { Box3, Matrix4, Vector3 } from 'three'
import type { HousePart } from './houseGeometry'

/** Topology-preserving edge collapse, not a bounding box: table legs, chair
 * openings and separate components stay separate. Material boundaries and
 * actual mesh borders are locked. Only lighting copies are modified. */
function coarseModel(part: HousePart): HousePart | undefined {
  const remap = MeshoptSimplifier.generatePositionRemap(part.position, 3)
  const ranges: HousePart['ranges'] = [], indices: number[] = []
  for (const range of part.ranges) {
    const original = Uint32Array.from({ length: range.count }, (_, i) => remap[part.index?.[range.start + i] ?? range.start + i])
    const target = Math.max(36, Math.min(1536, Math.floor(original.length * .08 / 3) * 3))
    const reduced = original.length > 192
      // Each material uses a sparse subset of the shared position buffer.
      // Ignore unused UV-seam duplicates while still locking actual borders.
      ? MeshoptSimplifier.simplify(original, part.position, 3, target, .005, ['Sparse', 'LockBorder'])[0] : original
    const chosen = reduced.length >= 3 ? reduced : original
    ranges.push({ ...range, start: indices.length, count: chosen.length })
    for (const id of chosen) indices.push(id)
  }
  const originalCount = part.ranges.reduce((sum, range) => sum + range.count, 0)
  if (indices.length >= originalCount * .8) return
  const position = new Float32Array(indices.length * 3), normal = new Float32Array(position.length), uv = new Float32Array(indices.length * 2)
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3()
  for (let i = 0; i < indices.length; i += 3) {
    a.fromArray(part.position, indices[i] * 3); b.fromArray(part.position, indices[i + 1] * 3); c.fromArray(part.position, indices[i + 2] * 3)
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize()
    for (let v = 0; v < 3; v++) {
      const id = indices[i + v]; position.set(part.position.subarray(id * 3, id * 3 + 3), (i + v) * 3)
      normal.set(n.toArray(), (i + v) * 3)
      if (part.uv) uv.set(part.uv.subarray(id * 2, id * 2 + 2), (i + v) * 2)
    }
  }
  return { ...part, position, normal, uv, index: undefined, ranges, lightingProxy: undefined, transport: undefined }
}

export async function prepareCoarseHouseParts(parts: HousePart[], progress: (message: string) => void) {
  if (!parts.some(part => part.lightingProxy === 'coarse-model' || part.lightingProxy === 'shared-detail')) return parts
  if (parts.some(part => part.lightingProxy === 'coarse-model')) await MeshoptSimplifier.ready
  progress('Preparing simple lighting geometry for furnishings')
  const cache = new Map<string | HousePart, HousePart | undefined>()
  return parts.map(part => {
    if (part.lightingProxy !== 'coarse-model' && part.lightingProxy !== 'shared-detail') return part
    const bounds = new Box3().setFromArray(part.position)
    const scale = Math.max(...part.matrices.map(matrix => new Matrix4().fromArray(matrix).getMaxScaleOnAxis()))
    const shared = part.lightingProxy === 'shared-detail' || bounds.getSize(new Vector3()).length() * scale < .2
    const key = part.geometryKey ? `${part.geometryKey}:${shared}` : part
    if (!cache.has(key)) cache.set(key, shared
      ? { ...part, position: new Float32Array(), normal: new Float32Array(), uv: new Float32Array(), index: undefined,
        ranges: part.ranges.map(range => ({ ...range, start: 0, count: 0 })), transport: undefined }
      : MeshoptSimplifier.supported ? coarseModel(part) : undefined)
    const proxy = cache.get(key)
    return proxy ? { ...part, transport: { ...proxy, matrices: part.matrices,
      ranges: proxy.ranges.map((range, i) => ({ ...range, material: part.ranges[i].material })) } } : part
  })
}
