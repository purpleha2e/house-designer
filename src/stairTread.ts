import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'
import type { StairPoint, StairSurface } from './stairDesign.ts'

/** Closed tread and nosing in one shell, without an internal front cap. The
 * quarter-round uses six quads along the width, with smooth radial normals. */
export function createStairTread(surface: StairSurface, thickness: number, nosing: number, requestedRadius = 0) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  type Vertex = { position: Vector3; normal: Vector3; uv: Vector2 }
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    const cross = b.position.clone().sub(a.position).cross(c.position.clone().sub(a.position))
    if (cross.lengthSq() < 1e-18) return
    if (cross.dot(a.normal.clone().add(b.normal).add(c.normal)) < 0) [b, c] = [c, b]
    for (const v of [a, b, c]) { positions.push(...v.position.toArray()); normals.push(...v.normal.toArray()); uvs.push(...v.uv.toArray()) }
  }
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex) => { triangle(a, b, c); triangle(a, c, d) }
  const top = surface.top, bottom = top - thickness, polygon = surface.polygon
  const flat = (p: StairPoint, y: number, normal: Vector3): Vertex => ({ position: new Vector3(p.x, y, p.z), normal,
    uv: new Vector2(p.x, -p.z) })
  for (const [a, b, c] of ShapeUtils.triangulateShape(polygon.map(p => new Vector2(p.x, p.z)), [])) {
    triangle(...[a, b, c].map(i => flat(polygon[i], top, new Vector3(0, 1, 0))) as [Vertex, Vertex, Vertex])
    triangle(...[a, b, c].map(i => flat(polygon[i], bottom, new Vector3(0, -1, 0))) as [Vertex, Vertex, Vertex])
  }
  const [a, b] = surface.front, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
  const active = nosing > 0 && length > 1e-6 && (!surface.landing || surface.riser)
  const area = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.z - q.x * p.z }, 0)
  // Side faces are split where a partial-width landing front meets the nosing.
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], ex = q.x - p.x, ez = q.z - p.z, size = Math.hypot(ex, ez)
    if (size < 1e-8) continue
    const normal = new Vector3(ez, 0, -ex).multiplyScalar(Math.sign(area) / size)
    const project = (v: StairPoint) => ((v.x - p.x) * ex + (v.z - p.z) * ez) / (size * size)
    const front = active && [a, b].every(v => Math.abs((v.x - p.x) * ez - (v.z - p.z) * ex) < 1e-8)
    const lo = front ? Math.max(0, Math.min(project(a), project(b))) : 1
    const hi = front ? Math.min(1, Math.max(project(a), project(b))) : 0
    const cuts = [...new Set([0, 1, ...(hi > lo ? [lo, hi] : [])])].sort((a, b) => a - b)
    const vertex = (t: number, y: number): Vertex => ({ position: new Vector3(p.x + ex * t, y, p.z + ez * t), normal,
      uv: new Vector2((p.x + ex * t) * ex / size + (p.z + ez * t) * ez / size, y) })
    for (let j = 1; j < cuts.length; j++) {
      const mid = (cuts[j - 1] + cuts[j]) / 2
      if (mid > lo && mid < hi) continue
      quad(vertex(cuts[j - 1], bottom), vertex(cuts[j], bottom), vertex(cuts[j], top), vertex(cuts[j - 1], top))
    }
  }
  if (active) {
    const centre = polygon.reduce((p, v) => ({ x: p.x + v.x / polygon.length, z: p.z + v.z / polygon.length }), { x: 0, z: 0 })
    let nx = -dz / length, nz = dx / length
    if (nx * (centre.x - a.x) + nz * (centre.z - a.z) > 0) { nx = -nx; nz = -nz }
    const radius = Math.min(requestedRadius, thickness, nosing)
    type Profile = { s: number; y: number; travel: number; angle: number }
    const profile: Profile[] = [{ s: 0, y: top, travel: 0, angle: 0 },
      { s: nosing - radius, y: top, travel: nosing - radius, angle: 0 }]
    if (radius > 0) for (let i = 1; i <= 6; i++) {
      const angle = i * Math.PI / 12
      profile.push({ s: nosing - radius + radius * Math.sin(angle), y: top - radius + radius * Math.cos(angle),
        travel: nosing - radius + radius * angle, angle })
    }
    else profile.push({ s: nosing, y: top, travel: nosing, angle: Math.PI / 2 })
    profile.push({ s: nosing, y: bottom, travel: nosing - radius + radius * Math.PI / 2 + thickness - radius, angle: Math.PI / 2 },
      { s: 0, y: bottom, travel: 0, angle: Math.PI })
    const vertex = (p: Profile, end: boolean, normal: Vector3): Vertex => {
      const origin = end ? b : a
      return { position: new Vector3(origin.x + nx * p.s, p.y, origin.z + nz * p.s), normal,
        uv: new Vector2(origin.x + nx * p.travel, -origin.z - nz * p.travel) }
    }
    for (let i = 1; i < profile.length; i++) {
      const p = profile[i - 1], q = profile[i], isBottom = i === profile.length - 1
      const radial = (angle: number) => new Vector3(nx * Math.sin(angle), Math.cos(angle), nz * Math.sin(angle))
      const pNormal = isBottom ? new Vector3(0, -1, 0) : radial(p.angle), qNormal = isBottom ? pNormal : radial(q.angle)
      // Flat top and straight front keep crisp boundaries; only the arc blends.
      if (p.y === q.y && !isBottom) { pNormal.set(0, 1, 0); qNormal.set(0, 1, 0) }
      if (Math.abs(p.s - q.s) < 1e-8 && !isBottom) { pNormal.set(nx, 0, nz); qNormal.set(nx, 0, nz) }
      quad(vertex(p, false, pNormal), vertex(p, true, pNormal), vertex(q, true, qNormal), vertex(q, false, qNormal))
    }
    // End caps meet the existing side panels without covering their surface.
    const unique = profile.filter((p, i) => !i || Math.hypot(p.s - profile[i - 1].s, p.y - profile[i - 1].y) > 1e-8)
    for (const end of [false, true]) {
      const normal = new Vector3(dx / length, 0, dz / length).multiplyScalar(end ? 1 : -1)
      for (const indices of ShapeUtils.triangulateShape(unique.map(p => new Vector2(p.s, p.y)), [])) {
        const vertices = indices.map(i => { const v = vertex(unique[i], end, normal); v.uv.set(unique[i].s, unique[i].y); return v })
        triangle(...vertices as [Vertex, Vertex, Vertex])
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}
