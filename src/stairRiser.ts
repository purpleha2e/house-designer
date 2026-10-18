import { ExtrudeGeometry, Shape, Vector2 } from 'three'
import * as polygonClipping from 'polygon-clipping'
import type { Polygon } from 'polygon-clipping'
import type { StairPoint } from './stairDesign.ts'
import { setStairWorldUvs } from './stairUvs.ts'
const runtime = polygonClipping as typeof polygonClipping & { default?: typeof polygonClipping }
const intersection = runtime.intersection ?? runtime.default!.intersection

/** A riser fits inside its tread's footprint, including angled winding treads.
 * Only its front reaches the nosing plane; its end caps clear the side panels. */
export function createStairRiser(a: StairPoint, b: StairPoint, inside: StairPoint, top: number, height: number, footprint?: StairPoint[]) {
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
  let nx = -dz / length, nz = dx / length
  if (nx * (inside.x - (a.x + b.x) / 2) + nz * (inside.z - (a.z + b.z) / 2) < 0) { nx = -nx; nz = -nz }
  const start = { x: a.x + dx / length * .001, z: a.z + dz / length * .001 }
  const end = { x: b.x - dx / length * .001, z: b.z - dz / length * .001 }
  const ring = [start, end, { x: end.x + nx * .018, z: end.z + nz * .018 }, { x: start.x + nx * .018, z: start.z + nz * .018 }]
  // Integer micrometres avoid almost-coincident floating-point intersections.
  const polygon = (points: StairPoint[]): Polygon => [[...points, points[0]].map(p => [Math.round(p.x * 1e6), Math.round(p.z * 1e6)])]
  let outlines = [polygon(ring)]
  if (footprint) {
    const points = footprint.filter((p, i) => Math.hypot(p.x - footprint[(i + 1) % footprint.length].x, p.z - footprint[(i + 1) % footprint.length].z) > 1e-8)
    const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z }, 0)
    const sign = Math.sign(area)
    const edges = points.map((p, i) => {
      const q = points[(i + 1) % points.length], ex = q.x - p.x, ez = q.z - p.z, size = Math.hypot(ex, ez)
      const distance = (v: StairPoint) => (ex * (v.z - p.z) - ez * (v.x - p.x)) / size
      const inset = Math.abs(distance(a)) < 1e-7 && Math.abs(distance(b)) < 1e-7 ? 0 : .001
      return { x: ex / size, z: ez / size, ox: -ez / size * sign * inset, oz: ex / size * sign * inset }
    })
    const inset = points.map((p, i) => {
      const prev = edges[(i + edges.length - 1) % edges.length], next = edges[i], cross = prev.x * next.z - prev.z * next.x
      if (Math.abs(cross) < 1e-8) return { x: p.x + next.ox, z: p.z + next.oz }
      const t = ((next.ox - prev.ox) * next.z - (next.oz - prev.oz) * next.x) / cross
      return { x: p.x + prev.ox + prev.x * t, z: p.z + prev.oz + prev.z * t }
    })
    // One boolean handles concave winding treads around the U-shaped well too.
    outlines = intersection(outlines, polygon(inset))
  }
  const shapes = outlines.map(rings => new Shape(rings[0].slice(0, -1).map(([x, z]) => new Vector2(x / 1e6, -z / 1e6))))
  const geometry = new ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false, steps: 1 })
  geometry.rotateX(-Math.PI / 2).translate(0, top - height, 0)
  return setStairWorldUvs(geometry)
}
