import { BufferGeometry, Float32BufferAttribute, type Box3 } from 'three'
import type { StairRailPoint } from './stairDesign.ts'

type Vertex = { p: number[]; n: number[]; uv: number[] }

/** Highest pitch-line height inside the post footprint, including the rail's
 * width. A sloping rail must leave through the side, below the newel's cap. */
export function stairNewelRailHeight(path: StairRailPoint[], post: StairRailPoint, postWidth: number, railWidth: number) {
  let height = post.y
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z, run = Math.hypot(dx, dz)
    if (run < 1e-7) continue
    let from = 0, to = 1
    for (const [start, delta, centre, extent] of [[a.x, dx, post.x, postWidth / 2 + Math.abs(dz / run) * railWidth / 2],
      [a.z, dz, post.z, postWidth / 2 + Math.abs(dx / run) * railWidth / 2]]) {
      if (Math.abs(delta) < 1e-10) { if (Math.abs(start - centre) > extent) to = -1; continue }
      const t0 = (centre - extent - start) / delta, t1 = (centre + extent - start) / delta
      from = Math.max(from, Math.min(t0, t1)); to = Math.min(to, Math.max(t0, t1))
    }
    if (from <= to) height = Math.max(height, a.y + (b.y - a.y) * (b.y >= a.y ? to : from))
  }
  return height
}

/** Trim rail faces out of the newels, including coplanar side faces when the
 * rail and post have the same width. The post closes the concealed rail end. */
export function trimStairRailsAtNewels(source: BufferGeometry, posts: readonly Box3[]) {
  const position = source.getAttribute('position'), normal = source.getAttribute('normal'), uv = source.getAttribute('uv')
  let polygons: Vertex[][] = []
  for (let i = 0; i < position.count; i += 3) polygons.push([0, 1, 2].map(j => ({
    p: [position.getX(i + j), position.getY(i + j), position.getZ(i + j)],
    n: [normal.getX(i + j), normal.getY(i + j), normal.getZ(i + j)], uv: [uv.getX(i + j), uv.getY(i + j)],
  })))
  function clip(polygon: Vertex[], axis: number, value: number, sign: number) {
    const result: Vertex[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]
      const da = sign * (a.p[axis] - value), db = sign * (b.p[axis] - value)
      if (da >= 0) result.push(a)
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db), mix = (x: number[], y: number[]) => x.map((v, j) => v + (y[j] - v) * t)
        result.push({ p: mix(a.p, b.p), n: mix(a.n, b.n), uv: mix(a.uv, b.uv) })
      }
    }
    return result
  }
  for (const post of posts) {
    // A submillimetre clearance prevents depth precision from reintroducing
    // an overlapping strip at the butt joint.
    const min = post.min.toArray().map(n => n - .0001), max = post.max.toArray().map(n => n + .0001)
    const outside: Vertex[][] = []
    for (const polygon of polygons) {
      if ([0, 1, 2].some(axis => polygon.every(v => v.p[axis] <= min[axis]) || polygon.every(v => v.p[axis] >= max[axis]))) {
        outside.push(polygon); continue
      }
      let inside = polygon
      for (const [axis, value, sign] of [[0, min[0], 1], [0, max[0], -1], [1, min[1], 1],
        [1, max[1], -1], [2, min[2], 1], [2, max[2], -1]]) {
        const remainder = clip(inside, axis, value, -sign)
        if (remainder.length >= 3) outside.push(remainder)
        inside = clip(inside, axis, value, sign)
        if (inside.length < 3) break
      }
    }
    polygons = outside
  }
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  for (const polygon of polygons) for (let i = 1; i < polygon.length - 1; i++) {
    const vertices = [polygon[0], polygon[i], polygon[i + 1]]
    const a = vertices[1].p.map((n, j) => n - vertices[0].p[j]), b = vertices[2].p.map((n, j) => n - vertices[0].p[j])
    if (Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) < 1e-12) continue
    for (const vertex of vertices) { positions.push(...vertex.p); normals.push(...vertex.n); uvs.push(...vertex.uv) }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}
