import { MeshBVH } from 'three-mesh-bvh'
import type { Vector3 } from 'three'

/** A static, allocation-free any-hit traversal for the millions of GI segments.
 * Copy topology through the public traversal API, so this does not depend on
 * the BVH library's private packed-node format. The original tree still serves
 * nearest-surface queries for ceiling heights and lamp triangle references. */
export function createIndirectSegmentQuery(tree: MeshBVH | null) {
  if (!tree) return () => false
  const bounds: number[] = [], metadata: number[] = [], roots: number[] = [], ancestors: number[] = []
  const rootCount = MeshBVH.serialize(tree, { cloneBuffers: false }).roots.length
  for (let root = 0; root < rootCount; root++) {
    tree.traverse((depth, leaf, box, offsetOrSplit, count) => {
      const node = metadata.length / 4
      bounds.push(...box)
      // Internal: left, right, split axis, 0. Leaf: 0, 0, triangle offset, count.
      metadata.push(-1, -1, offsetOrSplit, leaf ? count : 0)
      if (!depth) roots.push(node)
      else {
        const parent = ancestors[depth - 1] * 4
        metadata[parent + (metadata[parent] < 0 ? 0 : 1)] = node
      }
      ancestors[depth] = node
    }, root)
  }
  const boxes = new Float32Array(bounds), nodes = new Int32Array(metadata)
  const indices = tree.geometry.index!.array, vertices = tree.geometry.attributes.position.array
  const stack = new Int32Array(nodes.length / 4)
  const origins = new Float64Array(3), directions = new Float64Array(3), inverses = new Float64Array(3)
  return (origin: Vector3, direction: Vector3, max: number) => {
    if (max <= .025) return false
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = direction.x, dy = direction.y, dz = direction.z
    const length = direction.length()
    if (length === 0) return false
    const near = .025 / length, far = max / length
    origins[0] = ox; origins[1] = oy; origins[2] = oz
    directions[0] = dx; directions[1] = dy; directions[2] = dz
    inverses[0] = 1 / dx; inverses[1] = 1 / dy; inverses[2] = 1 / dz
    let pending = 0
    for (const root of roots) stack[pending++] = root
    while (pending) {
      const node = stack[--pending], box = node * 6, meta = node * 4
      let start = near, end = far
      for (let axis = 0; axis < 3; axis++) {
        const low = boxes[box + axis], high = boxes[box + axis + 3], o = origins[axis]
        if (directions[axis] === 0) {
          if (o < low || o > high) { end = -Infinity; break }
        } else {
          const a = (low - o) * inverses[axis], b = (high - o) * inverses[axis]
          start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b))
          if (start > end) break
        }
      }
      if (start > end) continue
      const count = nodes[meta + 3]
      if (!count) {
        const left = nodes[meta], right = nodes[meta + 1]
        const forward = directions[nodes[meta + 2]] >= 0
        stack[pending++] = forward ? right : left
        stack[pending++] = forward ? left : right
        continue
      }
      const first = nodes[meta + 2] * 3, last = first + count * 3
      for (let triangle = first; triangle < last; triangle += 3) {
        const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3
        const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2]
        const e1x = vertices[b] - ax, e1y = vertices[b + 1] - ay, e1z = vertices[b + 2] - az
        const e2x = vertices[c] - ax, e2y = vertices[c + 1] - ay, e2z = vertices[c + 2] - az
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
        let determinant = dx * nx + dy * ny + dz * nz
        if (determinant === 0) continue
        const sign = determinant > 0 ? 1 : -1
        determinant *= sign
        const qx = ox - ax, qy = oy - ay, qz = oz - az
        const u = sign * (dx * (qy * e2z - qz * e2y) + dy * (qz * e2x - qx * e2z) + dz * (qx * e2y - qy * e2x))
        if (u < 0) continue
        const v = sign * (dx * (e1y * qz - e1z * qy) + dy * (e1z * qx - e1x * qz) + dz * (e1x * qy - e1y * qx))
        if (v < 0 || u + v > determinant) continue
        const t = -sign * (qx * nx + qy * ny + qz * nz) / determinant
        if (t >= near && t < far) return true
      }
    }
    return false
  }
}
