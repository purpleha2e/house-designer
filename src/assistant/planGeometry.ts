import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping'
import type { Point } from '../types.ts'

const runtime = polygonClipping as Partial<typeof polygonClipping> & { default?: typeof polygonClipping }
export const intersection = withClippingRetry(runtime.intersection ?? runtime.default!.intersection)
export const difference = withClippingRetry(runtime.difference ?? runtime.default!.difference)
export const union = withClippingRetry(runtime.union ?? runtime.default!.union)
export const EPSILON = 0.0001

type ClippingInput = Polygon | MultiPolygon

function isClippingPrecisionError(error: unknown) {
  return error instanceof Error && /^(Unable to complete output ring|Unable to find segment|Unable to pop\(\)|Tried to create degenerate segment|Tried to link already linked events)/.test(error.message)
}

function roundClippingInput(input: ClippingInput): ClippingInput {
  const roundedRing = (ring: Ring): Ring => ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])
  const first = input[0]?.[0]?.[0]
  return Array.isArray(first) ? (input as MultiPolygon).map(shape => shape.map(roundedRing)) : (input as Polygon).map(roundedRing)
}

function withClippingRetry(clip: typeof polygonClipping.intersection) {
  return (first: ClippingInput, ...rest: ClippingInput[]) => {
    try { return clip(first, ...rest) }
    catch (error) {
      if (!isClippingPrecisionError(error)) throw error
      // Native wall topology also rounds its polygon inputs to micrometre precision.
      return clip(roundClippingInput(first), ...rest.map(roundClippingInput))
    }
  }
}

export function checkCandidate<T>(check: () => T): T | null {
  try { return check() }
  catch (error) {
    if (!isClippingPrecisionError(error)) throw error
    return null
  }
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export function bounds(points: Point[]): Bounds {
  return {
    minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)),
  }
}

export function edges(points: Point[]): [Point, Point][] {
  return points.map((point, index) => [point, points[(index + 1) % points.length]])
}

export function polygon(points: Point[]): Polygon {
  return [points.map(({ x, y }) => [x, y])]
}

export function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]]
}

function ringArea(ring: Ring) {
  return Math.abs(ring.reduce((area, [x, y], index) => {
    const [nextX, nextY] = ring[(index + 1) % ring.length]
    return area + x * nextY - y * nextX
  }, 0)) / 2
}

export function area(polygons: MultiPolygon) {
  return polygons.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((total, hole) => total + ringArea(hole), 0), 0)
}

export function covers(container: Polygon | MultiPolygon, region: Polygon, tolerance = 0.002) {
  return area(difference(region, container)) <= tolerance
}

export function points(ring: Ring): Point[] {
  return ring.slice(0, -1).map(([x, y]) => ({ x, y }))
}

export function pointInPolygon(point: Point, boundary: Point[]) {
  let inside = false
  for (const [a, b] of edges(boundary)) {
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) {
      inside = !inside
    }
  }
  return inside
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function projection(point: Point, start: Point, end: Point) {
  const length = distance(start, end)
  const offset = length > EPSILON ? ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / length : 0
  const fraction = length > EPSILON ? Math.max(0, Math.min(1, offset / length)) : 0
  return { offset, length, gap: distance(point, { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction }) }
}

export function transformedFrame(angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return {
    local: ({ x, y }: Point) => ({ x: cos * x + sin * y, y: -sin * x + cos * y }),
    world: ({ x, y }: Point) => ({ x: cos * x - sin * y, y: sin * x + cos * y }),
  }
}
