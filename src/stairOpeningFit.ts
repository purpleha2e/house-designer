import type { Point, Wall } from './types.ts'
import { subtractPlanCutouts } from './planarCutouts.ts'

export const STAIR_OPENING_WALL_FIT_DISTANCE = .05

/** Partial walls need a notch at their actual ends, not a guessed full-length
 * wall plane. Keep occupied wall bodies out of the shared opening as well. */
export function fitStairOpeningFootprints(polygon: Point[], walls: Wall[]): Point[][] {
  const fitted = fitStairOpeningToWalls(polygon, walls)
  const cutters = walls.flatMap(wall => {
    const wx = wall.end.x - wall.start.x, wy = wall.end.y - wall.start.y, length = Math.hypot(wx, wy)
    if (length < 1e-6) return []
    const touches = polygon.some((p, i) => {
      const q = polygon[(i + 1) % polygon.length], dx = q.x - p.x, dy = q.y - p.y, edgeLength = Math.hypot(dx, dy)
      if (edgeLength < 1e-6 || Math.abs(dx * wy - dy * wx) / (edgeLength * length) > 1e-5) return false
      const along = (v: Point) => ((v.x - p.x) * dx + (v.y - p.y) * dy) / edgeLength
      if (Math.min(Math.max(along(wall.start), along(wall.end)), edgeLength) - Math.max(Math.min(along(wall.start), along(wall.end)), 0) < .001) return false
      const distance = Math.abs((p.x - wall.start.x) * wy - (p.y - wall.start.y) * wx) / length
      return Math.abs(distance - wall.thickness / 2) <= STAIR_OPENING_WALL_FIT_DISTANCE
    })
    if (!touches) return []
    if (!fitted.some((p, i) => {
      const q = fitted[(i + 1) % fitted.length], interval = wallOpeningEdgeInterval(p, q, wall)
      return interval && (interval[1] - interval[0]) * Math.hypot(q.x - p.x, q.y - p.y) > .00001
    })) return []
    const nx = -wy / length * wall.thickness / 2, ny = wx / length * wall.thickness / 2
    return [[{ x: wall.start.x + nx, y: wall.start.y + ny }, { x: wall.end.x + nx, y: wall.end.y + ny },
      { x: wall.end.x - nx, y: wall.end.y - ny }, { x: wall.start.x - nx, y: wall.start.y - ny }]]
  })
  return subtractPlanCutouts(fitted, cutters).map(footprint => footprint.outline)
}

/** Meet nearby inside wall faces. Small gaps are bridged; where a wall already
 * intrudes into the stair footprint, retain its support rather than cutting
 * underneath it. Actual wall offsets become closed ledges, not open seams. */
export function fitStairOpeningToWalls(polygon: Point[], walls: Wall[], tolerance = STAIR_OPENING_WALL_FIT_DISTANCE): Point[] {
  if (polygon.length < 3 || !walls.length) return polygon
  const area = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y }, 0)
  const sign = area > 0 ? 1 : -1
  const lines = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length], length = Math.hypot(q.x - p.x, q.y - p.y)
    const dx = (q.x - p.x) / length, dy = (q.y - p.y) / length
    const normal = { x: sign * dy, y: -sign * dx }
    let fittedShift: number | null = null
    for (const wall of walls) {
      const wx = wall.end.x - wall.start.x, wy = wall.end.y - wall.start.y, wl = Math.hypot(wx, wy)
      if (wl < 1e-6 || Math.abs(dx * wy - dy * wx) / wl > 1e-5) continue
      const along = (v: Point) => (v.x - p.x) * dx + (v.y - p.y) * dy
      const a = along(wall.start), b = along(wall.end)
      if (Math.min(a, b) > .001 || Math.max(a, b) < length - .001) continue
      const distance = (wall.start.x - p.x) * normal.x + (wall.start.y - p.y) * normal.y - wall.thickness / 2
      if (Math.abs(distance) <= tolerance && (fittedShift === null || distance < fittedShift)) fittedShift = distance
    }
    const shift = fittedShift ?? 0
    return { normal, constant: p.x * normal.x + p.y * normal.y + shift, shift }
  })
  if (!lines.some(line => Math.abs(line.shift) > 1e-7)) return polygon
  return polygon.map((p, i) => {
    const a = lines[(i + lines.length - 1) % lines.length], b = lines[i]
    const determinant = a.normal.x * b.normal.y - a.normal.y * b.normal.x
    if (Math.abs(determinant) < 1e-8) {
      const shift = Math.max(a.shift, b.shift)
      return { x: p.x + b.normal.x * shift, y: p.y + b.normal.y * shift }
    }
    return { x: (a.constant * b.normal.y - a.normal.y * b.constant) / determinant,
      y: (a.normal.x * b.constant - a.constant * b.normal.x) / determinant }
  })
}

/** Only a wall covering the entire edge can replace that part of its lining. */
export function wallOpeningEdgeInterval(point: Point, next: Point, wall: Wall): [number, number] | null {
  const dx = next.x - point.x, dy = next.y - point.y, length = Math.hypot(dx, dy)
  const wx = wall.end.x - wall.start.x, wy = wall.end.y - wall.start.y, wl = Math.hypot(wx, wy)
  if (length < 1e-7 || wl < 1e-7) return null
  const px = point.x - wall.start.x, py = point.y - wall.start.y
  let enter = 0, exit = 1
  for (const [origin, delta, min, max] of [
    [(px * wx + py * wy) / wl, (dx * wx + dy * wy) / wl, -.000001, wl + .000001],
    [(-px * wy + py * wx) / wl, (-dx * wy + dy * wx) / wl, -wall.thickness / 2 - .000001, wall.thickness / 2 + .000001],
  ]) {
    if (Math.abs(delta) < 1e-9) { if (origin < min || origin > max) return null }
    else {
      const a = (min - origin) / delta, b = (max - origin) / delta
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b))
      if (exit < enter) return null
    }
  }
  return [enter, exit]
}

export function wallCoversOpeningEdge(point: Point, next: Point, wall: Wall) {
  const interval = wallOpeningEdgeInterval(point, next, wall)
  return !!interval && interval[0] < .00001 && interval[1] > .99999
}
