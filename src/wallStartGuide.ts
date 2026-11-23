import type { Point, Wall } from './types.ts'

const EPSILON = 1e-6

export type WallStartGuide = {
  reference: Point
  direction: Point
  normal: Point
  hostHalfThickness: number
  draftHalfThickness: number
  distance: number
  maxDistance: number
}

function project(point: Point, origin: Point, axis: Point) {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y
}

/** The interval occupied by a crossing wall along the selected host face. */
function getFaceInterval(polygon: Point[], origin: Point, axis: Point, normal: Point, offset: number) {
  const samples = polygon.map(point => ({
    along: project(point, origin, axis),
    across: project(point, origin, normal) - offset,
  }))
  if (!samples.some(point => point.across > EPSILON)) return null

  const crossings: number[] = []
  for (let index = 0; index < samples.length; index++) {
    const a = samples[index], b = samples[(index + 1) % samples.length]
    if (Math.abs(a.across) < EPSILON) crossings.push(a.along)
    if (a.across * b.across < 0) {
      const t = a.across / (a.across - b.across)
      crossings.push(a.along + t * (b.along - a.along))
    }
  }
  if (crossings.length < 2) return null
  return { start: Math.min(...crossings), end: Math.max(...crossings) }
}

/** Measure clear space along a host face for the footprint of a square wall join. */
export function getWallStartGuide(host: Wall, start: Point, side: -1 | 1,
  draftThickness: number, polygons: ReadonlyMap<string, Point[]>): WallStartGuide | null {
  const dx = host.end.x - host.start.x, dy = host.end.y - host.start.y
  const length = Math.hypot(dx, dy)
  if (length < EPSILON) return null

  const axis = { x: dx / length, y: dy / length }
  const normal = { x: -axis.y * side, y: axis.x * side }
  const hostHalfThickness = host.thickness / 2
  const draftHalfThickness = draftThickness / 2
  const along = project(start, host.start, axis)
  let left = 0, right = length, hasLeftWall = false, hasRightWall = false
  for (const [id, polygon] of polygons) {
    if (id === host.id) continue
    const interval = getFaceInterval(polygon, host.start, axis, normal, hostHalfThickness)
    if (!interval || interval.end < 0 || interval.start > length) continue
    if (along >= interval.start && along <= interval.end) return null
    if (interval.end >= left && interval.end < along) {
      left = interval.end
      hasLeftWall = true
    } else if (interval.start <= right && interval.start > along) {
      right = interval.start
      hasRightWall = true
    }
  }

  // Prefer a neighbouring wall face over an open wall end. A standalone wall
  // can still be set out from its nearest end.
  const fromLeft = hasLeftWall === hasRightWall ? along - left <= right - along : hasLeftWall
  const offset = fromLeft ? along - left : right - along
  const clearance = offset - draftHalfThickness
  const maxDistance = right - left - draftThickness
  if (clearance < -EPSILON || clearance > maxDistance + EPSILON) return null

  const referenceOffset = fromLeft ? left : right
  return {
    reference: {
      x: host.start.x + axis.x * referenceOffset,
      y: host.start.y + axis.y * referenceOffset,
    },
    direction: fromLeft ? axis : { x: -axis.x, y: -axis.y },
    normal,
    hostHalfThickness,
    draftHalfThickness,
    distance: Math.max(0, clearance),
    maxDistance,
  }
}

export function parseWallStartOffset(value: string, guide: WallStartGuide) {
  const text = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(text)) return null
  const offset = Number(text)
  return offset <= guide.maxDistance + EPSILON ? offset : null
}

export function getWallStartAtOffset(guide: WallStartGuide, offset: number): Point {
  const along = offset + guide.draftHalfThickness
  return {
    x: guide.reference.x + guide.direction.x * along,
    y: guide.reference.y + guide.direction.y * along,
  }
}
