import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { StairDesign, StairPoint, getStairLayout } from './stairDesign.ts'
import { setStairWorldUvs } from './stairUvs.ts'

/** A thin closed soffit under the pitch line, with fascia only around exposed
 * edges. It leaves the space beneath the staircase usable. */
export function createStairUnderside(design: StairDesign, layout: ReturnType<typeof getStairLayout>) {
  const positions: number[] = [], uvs: number[] = []
  type Vertex = StairPoint & { y: number }
  type Edge = { a: Vertex; b: Vertex; top: number; front?: [StairPoint, StairPoint]; riserBottom: number }
  const edges = new Map<string, Edge[]>()
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    uvs.push(a.x, a.z + a.y, b.x, b.z + b.y, c.x, c.z + c.y)
  }
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex) => {
    triangle(a, b, c); triangle(a, c, d)
  }
  const key = (p: StairPoint) => `${Math.round(p.x * 1e7)},${Math.round(p.z * 1e7)}`
  const depth = Math.max(.14, design.treadThickness + .04), thickness = .025
  for (const surface of layout.surfaces) {
    // Collapse the coincident inner points of a quarter-turn fan.
    const ring: Vertex[] = []
    surface.polygon.forEach((point, i) => {
      const y = Math.max(0, surface.top - depth - (surface.landing ? 0 : (1 - surface.progression[i]) * layout.riserHeight))
      const previous = ring.at(-1)
      if (previous && key(previous) === key(point)) previous.y = Math.min(previous.y, y)
      else ring.push({ ...point, y })
    })
    if (ring.length > 1 && key(ring[0]) === key(ring.at(-1)!)) {
      ring[0].y = Math.min(ring[0].y, ring.at(-1)!.y); ring.pop()
    }
    const area = ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a.x * b.z - b.x * a.z }, 0)
    if (area < 0) ring.reverse()
    const cap = ring.map(point => ({ ...point, y: Math.min(surface.top - design.treadThickness, point.y + thickness) }))
    const triangles = ShapeUtils.triangulateShape(ring.map(p => new Vector2(p.x, p.z)), [])
    for (const [a, b, c] of triangles) {
      const cross = (ring[b].x - ring[a].x) * (ring[c].z - ring[a].z) - (ring[b].z - ring[a].z) * (ring[c].x - ring[a].x)
      if (cross < 0) { triangle(cap[a], cap[b], cap[c]); triangle(ring[a], ring[c], ring[b]) }
      else { triangle(cap[a], cap[c], cap[b]); triangle(ring[a], ring[b], ring[c]) }
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = ring[i], b = ring[j]
      if (key(a) === key(b)) continue
      const edgeKey = [key(a), key(b)].sort().join('|')
      const list = edges.get(edgeKey) ?? []
      list.push({ a, b, top: surface.top - design.treadThickness,
        front: design.closedRisers && (!surface.landing || surface.riser) ? surface.front : undefined,
        riserBottom: surface.top - layout.riserHeight }); edges.set(edgeKey, list)
    }
  }
  for (const list of edges.values()) {
    const first = list[0]
    if (list.length === 1) {
      // At a riser the soffit closes only below the riser, without duplicating
      // its face. Split long landing edges where only part is a riser.
      const { a, b, front } = first, dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz
      const project = (p: StairPoint) => ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq
      const collinear = front?.every(p => Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) < 1e-8)
      const lo = collinear ? Math.max(0, Math.min(...front!.map(project))) : 1
      const hi = collinear ? Math.min(1, Math.max(...front!.map(project))) : 0
      const cuts = [...new Set([0, 1, ...(hi > lo ? [lo, hi] : [])])].sort((a, b) => a - b)
      const point = (t: number): Vertex => ({ x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t })
      for (let i = 1; i < cuts.length; i++) {
        const start = point(cuts[i - 1]), end = point(cuts[i]), mid = (cuts[i - 1] + cuts[i]) / 2
        const top = mid > lo && mid < hi ? first.riserBottom : first.top
        const upA = { ...start, y: Math.max(start.y, top) }, upB = { ...end, y: Math.max(end.y, top) }
        if (upA.y - start.y > 1e-8 || upB.y - end.y > 1e-8) quad(end, start, upA, upB)
      }
    } else {
      // A single face joins the soffits. The old pair of bottom/cap bridges
      // overlapped each other, and could also extend through the landing riser.
      const second = list[1]
      const a = key(second.a) === key(first.a) ? second.a : second.b
      const b = key(second.b) === key(first.b) ? second.b : second.a
      const limit = design.closedRisers ? Math.min(first.top, second.top) : Infinity
      const clip = (p: Vertex) => ({ ...p, y: Math.min(p.y, limit) })
      const vertices = [clip(first.a), clip(first.b), clip(b), clip(a)]
      if (Math.abs(vertices[0].y - vertices[3].y) + Math.abs(vertices[1].y - vertices[2].y) > 1e-6)
        quad(...vertices as [Vertex, Vertex, Vertex, Vertex])
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return setStairWorldUvs(geometry)
}
