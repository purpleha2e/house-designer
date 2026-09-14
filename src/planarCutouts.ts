import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Point } from './types.ts'

export type PlanFootprint = {
  holes: Point[][]
  outline: Point[]
}

export type PlanCutout = Point[] | PlanFootprint

const polygonClippingRuntime = polygonClipping as typeof polygonClipping & {
  default?: typeof polygonClipping
}
const differencePolygons =
  polygonClippingRuntime.difference ?? polygonClippingRuntime.default?.difference

function closeRing(points: Point[]) {
  const normalized = points
    .map(({ x, y }) => ({
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
    }))
    .filter((point, index, allPoints) => index === 0 || Math.hypot(
      point.x - allPoints[index - 1].x,
      point.y - allPoints[index - 1].y,
    ) > 0.000001)
  const firstPoint = normalized[0]
  const lastPoint = normalized.at(-1)

  if (!firstPoint || !lastPoint) {
    return []
  }

  if (
    normalized.length > 1 &&
    Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) <=
      0.000001
  ) {
    normalized.pop()
  }

  if (normalized.length < 3) return []

  const ring = normalized.map(
    (point) => [point.x, point.y] as [number, number],
  )

  ring.push([firstPoint.x, firstPoint.y])

  return ring
}

function toPolygon(cutout: PlanCutout): Polygon {
  return Array.isArray(cutout)
    ? [closeRing(cutout)]
    : [closeRing(cutout.outline), ...cutout.holes.map(closeRing)]
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

export function subtractPlanCutouts(outline: Point[], cutouts: PlanCutout[]) {
  if (outline.length < 3 || cutouts.length === 0 || !differencePolygons) {
    return outline.length >= 3 ? [{ holes: [], outline }] : []
  }

  return toFootprints(
    differencePolygons(toPolygon(outline), ...cutouts.map(toPolygon)),
  )
}
