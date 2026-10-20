import { BufferGeometry, Float32BufferAttribute } from 'three'
import { getStairLayout, type StairDesign, type StairRailPoint } from './stairDesign.ts'
import { rotateStairUvs } from './stairUvs.ts'

const distance = (a: StairRailPoint, b: StairRailPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const matches = (a: StairRailPoint, b: StairRailPoint) => distance(a, b) < 1e-7
const direction = (a: StairRailPoint, b: StairRailPoint) => {
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  return length > 1e-7 ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length } : { x: 0, z: 0 }
}

/** Heights follow the nosing pitch, never the discrete tread underneath an inset post. */
export function getStairRailPath(design: StairDesign, layout: ReturnType<typeof getStairLayout>, side: 'left' | 'right') {
  const source = layout[side].filter((p, i, all) => !i || !matches(p, all[i - 1]))
  const inset = Math.max(design.spindleWidth, design.postWidth, design.handrailWidth) / 2 + .005
  const sign = side === 'left' ? 1 : -1
  const flights = layout.flights.flatMap(f => [f.left, f.right])
  const outer = side === (design.turn === 'right' ? 'left' : 'right')
  const insideQuarterTurn = design.layout === 'l' && design.turnType === 'landing' && !outer
  const heightOffset = layout.compactLanding ? 0 : layout.riserHeight
  const path = source.map((p, i) => {
    if (insideQuarterTurn) {
      // Translate both adjoining pitch lines together. Insetting their shared
      // corner independently would bend the first segment of the upper flight.
      const a = direction(source[0], source[1]), b = direction(source.at(-2)!, source.at(-1)!)
      return { x: p.x + sign * inset * (a.z + b.z), z: p.z - sign * inset * (a.x + b.x), y: p.y + heightOffset }
    }
    // Both heights of a newel must use the same plan inset. Otherwise the
    // vertical join turns into a short diagonal kink in the handrail.
    const samePlan = (v: StairRailPoint) => Math.hypot(v.x - p.x, v.z - p.z) < 1e-7
    const flight = flights.find(f => f.some(samePlan))
    let previous = i - 1, next = i + 1
    while (previous >= 0 && samePlan(source[previous])) previous--
    while (next < source.length && samePlan(source[next])) next++
    const before = direction(source[Math.max(0, previous)], p), after = direction(p, source[Math.min(source.length - 1, next)])
    // At flight ends, inset across the flight only: moving along it would change the pitch.
    const along = flight ? direction(flight[0], flight.at(-1)!) : null
    const a = along ?? (i ? before : after), b = along ?? (i < source.length - 1 ? after : before)
    const divisor = Math.max(.25, 1 + a.x * b.x + a.z * b.z)
    return { x: p.x + sign * inset * (a.z + b.z) / divisor,
      z: p.z - sign * inset * (a.x + b.x) / divisor, y: p.y + heightOffset }
  })
  if (layout.compactLanding && outer) {
    const finalFlight = layout.flights.at(-1)!
    const i = source.findIndex(p => matches(p, finalFlight.left[0]) || matches(p, finalFlight.right[0]))
    const nose = path[i], floor = path[i - 1], before = path[i - 2]
    if (nose && floor && before && Math.hypot(nose.x - floor.x, nose.z - floor.z) < 1e-7 &&
      Math.hypot(nose.x - before.x, nose.z - before.z) >= design.going - 1e-7) {
      const forward = direction(source[i], source[i + 1])
      path[i - 1] = { x: nose.x - forward.x * design.going, z: nose.z - forward.z * design.going, y: nose.y - layout.riserHeight }
    }
  } else if (!layout.compactLanding && design.layout !== 'straight' && design.turnType === 'landing') {
    if (outer) {
      const height = design.stepsBeforeTurn * layout.riserHeight
      const first = source.findIndex(p => Math.abs(p.y - height) < 1e-7)
      const last = source.findLastIndex(p => Math.abs(p.y - height) < 1e-7)
      const start = path[last], previous = path[last - 1]
      const runBack = Math.min(design.going, Math.hypot(start.x - previous.x, start.z - previous.z))
      // Very deep treads can exceed a narrow landing return. Raise the level
      // rail enough to meet the pitch within that return, without folding back.
      const level = height + layout.riserHeight * (1 - runBack / design.going)
      // The last tread is already at landing height. Level out at its nosing;
      // extend the next pitch line back onto the landing to meet that same level.
      for (let i = first; i <= last; i++) path[i].y = level
      const forward = direction(source[last], source[last + 1])
      path.splice(last, 0, { x: start.x - forward.x * runBack, z: start.z - forward.z * runBack, y: level })
      path[last + 1].y = height + layout.riserHeight
      const incoming = direction(source[first - 1], source[first]), end = path[first]
      path.splice(first, 0, { x: end.x - incoming.x * runBack, z: end.z - incoming.z * runBack, y: level })
    }
    // The inside rail turns directly between flights. Its level return meets
    // the two nosing pitch lines one riser above the outside landing rail.
  }
  path.at(-1)!.y = design.totalRise
  // Remove redundant points, keeping only actual pitch/plan changes.
  const simplified: StairRailPoint[] = []
  for (const p of path) {
    if (simplified.length && matches(p, simplified.at(-1)!)) continue
    while (simplified.length > 1) {
      const a = simplified.at(-2)!, b = simplified.at(-1)!
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z], bp = [p.x - b.x, p.y - b.y, p.z - b.z]
      const cross = Math.hypot(ab[1] * bp[2] - ab[2] * bp[1], ab[2] * bp[0] - ab[0] * bp[2], ab[0] * bp[1] - ab[1] * bp[0])
      if (cross > 1e-7 || ab.reduce((sum, v, i) => sum + v * bp[i], 0) < 0) break
      simplified.pop()
    }
    simplified.push(p)
  }
  return simplified
}

/** A single square rail sweep, with shared miter rings and caps only at the two ends. */
export function createStairHandrail(path: StairRailPoint[], width: number) {
  const positions: number[] = [], uvs: number[] = []
  let travelled = 0
  const rings = path.map((p, i) => {
    const before = direction(path[Math.max(0, i - 1)], p), after = direction(p, path[Math.min(path.length - 1, i + 1)])
    const a = Math.hypot(before.x, before.z) > 0 ? before : after
    const b = Math.hypot(after.x, after.z) > 0 ? after : a
    const divisor = Math.max(.25, 1 + a.x * b.x + a.z * b.z)
    const dx = width / 2 * (a.z + b.z) / divisor, dz = -width / 2 * (a.x + b.x) / divisor
    if (i) travelled += distance(path[i - 1], p)
    return { points: [[p.x + dx, p.y - width / 2, p.z + dz], [p.x - dx, p.y - width / 2, p.z - dz],
      [p.x - dx, p.y + width / 2, p.z - dz], [p.x + dx, p.y + width / 2, p.z + dz]], v: travelled }
  })
  const triangle = (a: number[], b: number[], c: number[], uv: number[]) => { positions.push(...a, ...b, ...c); uvs.push(...uv) }
  for (let i = 1; i < rings.length; i++) for (let j = 0; j < 4; j++) {
    const a = rings[i - 1], b = rings[i], k = (j + 1) % 4
    triangle(a.points[j], b.points[j], b.points[k], [0, a.v, 0, b.v, width, b.v])
    triangle(a.points[j], b.points[k], a.points[k], [0, a.v, width, b.v, width, a.v])
  }
  if (rings.length > 1) {
    const a = rings[0].points, b = rings.at(-1)!.points
    triangle(a[0], a[1], a[2], [0, 0, width, 0, width, width]); triangle(a[0], a[2], a[3], [0, 0, width, width, 0, width])
    triangle(b[0], b[2], b[1], [0, 0, width, width, width, 0]); triangle(b[0], b[3], b[2], [0, 0, 0, width, width, width])
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return rotateStairUvs(geometry)
}
