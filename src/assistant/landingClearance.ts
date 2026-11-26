import type { MultiPolygon } from 'polygon-clipping'
import type { Point } from '../types.ts'
import { bounds, distance, edges, pointInPolygon, points, projection } from './planGeometry.ts'

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** The grid searches for routes. Continuous segment clearance proves the routes it finds. */
export function connectedClearance(walkable: MultiPolygon, start: Point, targets: Point[], radius: number): Point[][] | null {
  const rings = walkable.map(shape => shape.map(points))
  const shape = rings.find(([outer, ...holes]) => pointInPolygon(start, outer) && !holes.some(hole => pointInPolygon(start, hole)))
  if (!shape) return null
  const [outer, ...holes] = shape
  const boundary = shape.flatMap(edges)
  const clearance = radius - 0.002
  const inside = (p: Point) => pointInPolygon(p, outer) && !holes.some(hole => pointInPolygon(p, hole)) &&
    boundary.every(([a, b]) => projection(p, a, b).gap >= clearance)
  if (![start, ...targets].every(inside)) return null
  const sweep = (p: Point, q: Point) => boundary.every(([a, b]) => {
    if (cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0) return false
    return projection(a, p, q).gap >= clearance && projection(b, p, q).gap >= clearance
  })

  const box = bounds(outer), step = 0.18
  const columns = Math.floor((box.maxX - box.minX) / step) + 1
  const rows = Math.floor((box.maxY - box.minY) / step) + 1
  if (columns * rows > 25_000) return null
  const at = (i: number) => ({ x: box.minX + (i % columns) * step, y: box.minY + Math.floor(i / columns) * step })
  const grid = new Map<number, Point>()
  for (let i = 0; i < columns * rows; i++) {
    const candidate = at(i)
    if (inside(candidate)) grid.set(i, candidate)
  }
  const neighboursOf = (p: Point) => [...grid].filter(([, q]) => distance(p, q) <= step * 1.9 && sweep(p, q))
  const queue = neighboursOf(start).map(([i]) => i)
  const previous = new Map(queue.map(i => [i, -1]))
  for (let index = 0; index < queue.length; index++) {
    const i = queue[index], p = grid.get(i)!
    for (const next of [i - columns, i + columns, ...(i % columns > 0 ? [i - 1] : []), ...(i % columns + 1 < columns ? [i + 1] : [])]) {
      const q = grid.get(next)
      if (!q || previous.has(next) || !sweep(p, q)) continue
      previous.set(next, i)
      queue.push(next)
    }
  }
  const ribbons: Point[][] = []
  for (const target of targets) {
    const connected = neighboursOf(target).filter(([i]) => previous.has(i)).sort(([, a], [, b]) => distance(a, target) - distance(b, target))[0]
    const path = [target]
    if (!sweep(start, target)) {
      if (!connected) return null
      for (let i = connected[0]; i !== -1; i = previous.get(i)!) path.push(grid.get(i)!)
    }
    path.push(start)
    const turns = path.filter((p, index) => !index || index === path.length - 1 || Math.abs(cross(path[index - 1], p, path[index + 1])) > 1e-7)
    for (let i = 1; i < turns.length; i++) {
      const a = turns[i - 1], b = turns[i], length = distance(a, b)
      if (length < 0.0001) continue
      const x = (b.y - a.y) / length * clearance, y = (a.x - b.x) / length * clearance
      ribbons.push([{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y }, { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }])
    }
  }
  return ribbons
}
