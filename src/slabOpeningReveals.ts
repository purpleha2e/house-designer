import type { FloorLevel, Point } from './types.ts'
import type { PlanCutout, PlanFootprint } from './planarCutouts.ts'
import { wallCoversOpeningEdge, wallOpeningEdgeInterval } from './stairOpeningFit.ts'
import { getStairLayout } from './stairDesign.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'

type RevealPanel = { point: Point; nextPoint: Point; bottom: number; top: number }

/** The terminal riser owns its part of the opening face. Keep lining above,
 * below and beside it, without drawing a second face through the carpet. */
export function trimSlabRevealsAtStairs(panels: RevealPanel[], floors: readonly FloorLevel[], definitions: ReadonlyMap<string, ModelDefinition>) {
  for (const floor of floors) for (const model of floor.models) {
    const design = definitions.get(model.modelId)?.stairDesign
    if (!design?.closedRisers) continue
    const layout = getStairLayout(design)
    if (!layout.compactLanding) continue
    const flight = layout.flights.at(-1)!, a = flight.left.at(-1)!, b = flight.right.at(-1)!
    const scale = model.scale || 1, length = Math.hypot(b.x - a.x, b.z - a.z)
    const transform = (t: number) => {
      const x = (a.x + (b.x - a.x) * t) * scale * (model.widthScale || 1) * (model.mirrored ? -1 : 1)
      const z = (a.z + (b.z - a.z) * t) * scale * (model.depthScale || 1)
      return { x: model.position.x + x * Math.cos(model.rotation) - z * Math.sin(model.rotation),
        y: model.position.y + x * Math.sin(model.rotation) + z * Math.cos(model.rotation) }
    }
    // Match createStairRiser's one-millimetre clearance at each end.
    const start = transform(.001 / length), end = transform(1 - .001 / length)
    const bottom = floor.elevation + (design.totalRise - layout.riserHeight) * scale
    const top = floor.elevation + (design.totalRise - design.treadThickness) * scale
    panels = panels.flatMap(panel => {
      if (top <= panel.bottom || bottom >= panel.top) return [panel]
      const dx = panel.nextPoint.x - panel.point.x, dy = panel.nextPoint.y - panel.point.y
      const size = Math.hypot(dx, dy)
      const distance = (p: Point) => Math.abs((p.x - panel.point.x) * dy - (p.y - panel.point.y) * dx) / size
      if (distance(start) > .00001 || distance(end) > .00001) return [panel]
      const at = (p: Point) => ((p.x - panel.point.x) * dx + (p.y - panel.point.y) * dy) / (size * size)
      const lo = Math.max(0, Math.min(at(start), at(end))), hi = Math.min(1, Math.max(at(start), at(end)))
      if (hi <= lo) return [panel]
      const point = (t: number) => ({ x: panel.point.x + dx * t, y: panel.point.y + dy * t })
      const middle = { ...panel, point: point(lo), nextPoint: point(hi) }
      return [
        ...(lo > 0 ? [{ ...panel, nextPoint: point(lo) }] : []),
        ...(hi < 1 ? [{ ...panel, point: point(hi) }] : []),
        ...(bottom > panel.bottom ? [{ ...middle, top: bottom }] : []),
        ...(top < panel.top ? [{ ...middle, bottom: top }] : []),
      ]
    })
  }
  return panels
}

export function splitSlabOpeningRevealsAtWalls(edges: { point: Point; nextPoint: Point }[], walls: FloorLevel['walls']) {
  return edges.flatMap(edge => {
    const dx = edge.nextPoint.x - edge.point.x, dy = edge.nextPoint.y - edge.point.y, length = Math.hypot(dx, dy)
    const cuts = [0, 1, ...walls.flatMap(wall => wallOpeningEdgeInterval(edge.point, edge.nextPoint, wall) ?? [])].sort((a, b) => a - b)
    if (length < .00001) return []
    const points = [0]
    for (const value of cuts) if (value * length > .00001 && (1 - value) * length > .00001 &&
      (value - points.at(-1)!) * length > .00001) points.push(value)
    points.push(1)
    const at = (t: number) => ({ x: edge.point.x + dx * t, y: edge.point.y + dy * t })
    return points.slice(1).map((t, i) => ({ point: at(points[i]), nextPoint: at(t) }))
  })
}

/** Meet the actual wall ends rather than overlapping coplanar wall faces. Free
 * edges still cover the complete ceiling/floor-finish stack. */
export function getSlabOpeningRevealHeights(edge: { point: Point; nextPoint: Point }, lower: FloorLevel,
  upper: FloorLevel | null, bottom: number, top: number) {
  for (const wall of lower.walls) if (wallCoversOpeningEdge(edge.point, edge.nextPoint, wall)) {
    bottom = Math.max(bottom, lower.elevation + wall.height)
  }
  if (upper?.walls.some(wall => wallCoversOpeningEdge(edge.point, edge.nextPoint, wall))) top = Math.min(top, upper.elevation)
  return { bottom, top }
}

/** Cover cut edges on both enclosed holes and openings which notch the slab's
 * outer boundary. Offset into the void, with joined corners, to hide all layers. */
export function getSlabOpeningRevealEdges(footprints: PlanFootprint[], cutouts: PlanCutout[], inset = .002) {
  const cutters = cutouts.flatMap(c => Array.isArray(c) ? [c] : [c.outline, ...c.holes])
  const edges: { point: Point; nextPoint: Point }[] = []
  for (const footprint of footprints) for (const [ringIndex, ring] of [footprint.outline, ...footprint.holes].entries()) {
    const area = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y }, 0)
    const sign = (area >= 0 ? 1 : -1) * (ringIndex ? 1 : -1)
    const normals = ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length], length = Math.hypot(q.x - p.x, q.y - p.y) || 1
      return { x: sign * (p.y - q.y) / length, y: sign * (q.x - p.x) / length }
    })
    const offset = ring.map((p, i) => {
      const a = normals[(i + ring.length - 1) % ring.length], b = normals[i]
      const divisor = Math.max(.25, 1 + a.x * b.x + a.y * b.y)
      return { x: p.x + inset * (a.x + b.x) / divisor, y: p.y + inset * (a.y + b.y) / divisor }
    })
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      if (length < 1e-7) continue
      const intervals: [number, number][] = ringIndex ? [[0, 1]] : []
      if (!ringIndex) for (const cutter of cutters) for (let j = 0; j < cutter.length; j++) {
        const c = cutter[j], d = cutter[(j + 1) % cutter.length]
        const distance = (p: Point) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length
        if (distance(c) > 2e-6 || distance(d) > 2e-6) continue
        const at = (p: Point) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length)
        const x = at(c), y = at(d), start = Math.max(0, Math.min(x, y)), end = Math.min(1, Math.max(x, y))
        if ((end - start) * length > 1e-6) intervals.push([start, end])
      }
      intervals.sort((x, y) => x[0] - y[0])
      const merged: [number, number][] = []
      for (const interval of intervals) {
        const last = merged.at(-1)
        if (last && interval[0] <= last[1] + 1e-7) last[1] = Math.max(last[1], interval[1])
        else merged.push([...interval])
      }
      const p = offset[i], q = offset[(i + 1) % ring.length]
      const pointAt = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
      for (const [start, end] of merged) edges.push({ point: pointAt(start), nextPoint: pointAt(end) })
    }
  }
  return edges
}
