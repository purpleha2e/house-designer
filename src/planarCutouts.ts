import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Point } from './types.ts'

export type PlanFootprint = {
  holes: Point[][]
  outline: Point[]
}

const polygonClippingRuntime = polygonClipping as typeof polygonClipping & {
  default?: typeof polygonClipping
}
const differencePolygons =
  polygonClippingRuntime.difference ?? polygonClippingRuntime.default?.difference

function closeRing(points: Point[]) {
  const firstPoint = points[0]
  const lastPoint = points.at(-1)

  if (!firstPoint || !lastPoint) {
    return []
  }

  const ring = points.map((point) => [point.x, point.y] as [number, number])

  if (
    Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) > 0.000001
  ) {
    ring.push([firstPoint.x, firstPoint.y])
  }

  return ring
}

function toPolygon(points: Point[]): Polygon {
  return [closeRing(points)]
}

function toPoints(ring: number[][]) {
  const points = ring.map(([x, y]) => ({ x, y }))
  const firstPoint = points[0]
  const lastPoint = points.at(-1)

  return firstPoint && lastPoint &&
    Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) <= 0.000001
    ? points.slice(0, -1)
    : points
}

function toFootprints(multiPolygon: MultiPolygon): PlanFootprint[] {
  return multiPolygon.flatMap((polygon) => {
    const [outline, ...holes] = polygon

    return outline
      ? [{ holes: holes.map(toPoints), outline: toPoints(outline) }]
      : []
  })
}

export function subtractPlanCutouts(outline: Point[], cutouts: Point[][]) {
  if (outline.length < 3 || cutouts.length === 0 || !differencePolygons) {
    return outline.length >= 3 ? [{ holes: [], outline }] : []
  }

  return toFootprints(
    differencePolygons(toPolygon(outline), ...cutouts.map(toPolygon)),
  )
}
