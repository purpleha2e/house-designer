import type { Point } from './types'

export type RulerSegment = { start: Point; end: Point }
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Snap to actual wall boundaries. With Ctrl, intersect those boundaries with
 * the locked ray instead of pulling the measurement off its chosen angle. */
export function getRulerPoint(pointer: Point, segments: readonly RulerSegment[], tolerance: number,
  origin: Point | null = null, constrain = false): { point: Point; snapped: boolean } {
  const delta = origin ? subtract(pointer, origin) : null
  const angle = delta ? Math.round(Math.atan2(delta.y, delta.x) / (Math.PI / 4)) * Math.PI / 4 : 0
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const locked = !!origin && constrain
  const length = delta ? Math.max(0, delta.x * direction.x + delta.y * direction.y) : 0
  const target = locked ? { x: origin.x + length * direction.x, y: origin.y + length * direction.y } : pointer
  let best = target, bestDistance = tolerance, snapped = false
  for (const { start, end } of segments) {
    const edge = subtract(end, start), squared = edge.x ** 2 + edge.y ** 2
    if (squared < 1e-16) continue
    let candidate: Point
    if (locked) {
      const offset = subtract(start, origin), denominator = cross(direction, edge)
      if (Math.abs(denominator) < 1e-10) {
        if (Math.abs(cross(offset, direction)) > 1e-8) continue
        const a = offset.x * direction.x + offset.y * direction.y
        const b = a + edge.x * direction.x + edge.y * direction.y
        if (Math.max(a, b) < 0) continue
        const t = Math.max(0, Math.min(Math.max(a, b), Math.max(Math.min(a, b), length)))
        candidate = { x: origin.x + t * direction.x, y: origin.y + t * direction.y }
      } else {
        const t = cross(offset, edge) / denominator, u = cross(offset, direction) / denominator
        if (t < 0 || u < -1e-8 || u > 1 + 1e-8) continue
        candidate = { x: origin.x + t * direction.x, y: origin.y + t * direction.y }
      }
    } else {
      const offset = subtract(pointer, start)
      const t = Math.max(0, Math.min(1, (offset.x * edge.x + offset.y * edge.y) / squared))
      candidate = { x: start.x + t * edge.x, y: start.y + t * edge.y }
    }
    const separation = distance(target, candidate)
    if (separation <= bestDistance) { best = candidate; bestDistance = separation; snapped = true }
  }
  return { point: best, snapped }
}
