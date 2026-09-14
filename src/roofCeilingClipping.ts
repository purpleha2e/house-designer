import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { PlanFootprint } from './planarCutouts.ts'
import type { Point } from './types.ts'
import { clipRoofFace, getRoofCoverageUndersideFaces, type ResolvedRoof } from './roofJunctions.ts'

const EPS = 1e-7
const COORDINATE_PRECISION = 6

const polygonClippingRuntime = polygonClipping as typeof polygonClipping & {
  default?: typeof polygonClipping
}
const unionPolygons =
  polygonClippingRuntime.union ?? polygonClippingRuntime.default?.union

function normalizeRing(points: Point[]) {
  const normalized = points
    .map(({ x, y }) => ({
      x: Number(x.toFixed(COORDINATE_PRECISION)),
      y: Number(y.toFixed(COORDINATE_PRECISION)),
    }))
    .filter((point, index, allPoints) => index === 0 || Math.hypot(
      point.x - allPoints[index - 1].x,
      point.y - allPoints[index - 1].y,
    ) > EPS)
  const firstPoint = normalized[0]
  const lastPoint = normalized.at(-1)

  if (firstPoint && lastPoint && Math.hypot(
    firstPoint.x - lastPoint.x,
    firstPoint.y - lastPoint.y,
  ) <= EPS) {
    normalized.pop()
  }

  return normalized
}

function toClosedRing(points: Point[]) {
  return [
    ...points.map(({ x, y }) => [x, y] as [number, number]),
    [points[0].x, points[0].y] as [number, number],
  ]
}

function toPoints(ring: number[][]) {
  return ring.slice(0, -1).map(([x, y]) => ({ x, y }))
}

function toFootprints(multiPolygon: MultiPolygon): PlanFootprint[] {
  return multiPolygon.flatMap(([outline, ...holes]) => outline
    ? [{ outline: toPoints(outline), holes: holes.map(toPoints) }]
    : [])
}

/**
 * Plan regions where a horizontal room ceiling would sit above the underside
 * of a resolved roof. These regions are subtracted from the ceiling surface.
 */
export function getRoofCeilingCutouts(
  roofs: ResolvedRoof[],
  ceilingElevation: number,
): PlanFootprint[] {
  // Use the exposed envelope within each roof's original coverage. Hidden
  // panels and connection extensions must not remove slabs inside the winning
  // building; separate overhangs still retain their own coverage.
  const cutoutPolygons = roofs.flatMap((roof) =>
    getRoofCoverageUndersideFaces(roof).flatMap((face) => {
    const belowCeiling = clipRoofFace(
      face,
      ([, roofElevation]) =>
        ceilingElevation - roofElevation,
    )

    if (belowCeiling.length < 3) return []
    const polygon = normalizeRing(
      belowCeiling.map(([x, , y]) => ({ x, y })),
    )
    const area = Math.abs(polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0)) / 2

    return area > EPS ? [polygon] : []
    }))

  if (!unionPolygons || cutoutPolygons.length === 0) return []

  // Roof faces share edges and can overlap at resolved junctions. Union them
  // before subtraction so polygon-clipping sees one stable region rather than
  // many nearly-identical floating-point seams.
  const polygons = cutoutPolygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => [toClosedRing(polygon)] as Polygon)

  return polygons.length > 0
    ? toFootprints(unionPolygons(polygons[0], ...polygons.slice(1)))
    : []
}
