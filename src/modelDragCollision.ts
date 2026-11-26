import type { Point } from './types.ts'

export type PlanAabb = { minX: number; maxX: number; minY: number; maxY: number }

// Permit exact contact despite rounding when a translated mesh rebuilds its bounds.
export const MODEL_CONTACT_EPSILON = 1e-6

export type OrientedFootprint = {
  center: Point
  along: Point
  across: Point
  halfWidth: number
  halfDepth: number
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const projectedRadius = (footprint: OrientedFootprint, axis: Point) =>
  footprint.halfWidth * Math.abs(dot(footprint.along, axis)) + footprint.halfDepth * Math.abs(dot(footprint.across, axis))

/** Distances along the moving footprint's wall where both oriented rectangles overlap. */
export function getFootprintOffsetOverlap(moving: OrientedFootprint, target: OrientedFootprint) {
  const relative = { x: moving.center.x - target.center.x, y: moving.center.y - target.center.y }
  let min = -Infinity, max = Infinity
  for (const axis of [moving.along, moving.across, target.along, target.across]) {
    const separation = dot(relative, axis)
    const radius = projectedRadius(moving, axis) + projectedRadius(target, axis)
    const speed = dot(moving.along, axis)
    if (Math.abs(speed) < MODEL_CONTACT_EPSILON) {
      if (Math.abs(separation) >= radius - MODEL_CONTACT_EPSILON) return null
      continue
    }
    const a = (-radius - separation) / speed, b = (radius - separation) / speed
    min = Math.max(min, Math.min(a, b))
    max = Math.min(max, Math.max(a, b))
    if (min >= max - MODEL_CONTACT_EPSILON) return null
  }
  return { min, max }
}

export function translatePlanBounds(bounds: PlanAabb, delta: Point): PlanAabb {
  return { minX: bounds.minX + delta.x, maxX: bounds.maxX + delta.x,
    minY: bounds.minY + delta.y, maxY: bounds.maxY + delta.y }
}

export function planAabbsOverlap(first: PlanAabb, second: PlanAabb) {
  return first.minX < second.maxX - MODEL_CONTACT_EPSILON && first.maxX > second.minX + MODEL_CONTACT_EPSILON &&
    first.minY < second.maxY - MODEL_CONTACT_EPSILON && first.maxY > second.minY + MODEL_CONTACT_EPSILON
}

function getOverlapTimes(min: number, max: number, targetMin: number, targetMax: number, delta: number) {
  if (Math.abs(delta) <= MODEL_CONTACT_EPSILON) {
    return max <= targetMin + MODEL_CONTACT_EPSILON || min >= targetMax - MODEL_CONTACT_EPSILON
      ? null : { enter: -Infinity, exit: Infinity }
  }
  if (delta > 0 ? min >= targetMax - MODEL_CONTACT_EPSILON : max <= targetMin + MODEL_CONTACT_EPSILON) return null
  const first = (targetMin - max) / delta
  const last = (targetMax - min) / delta
  return { enter: Math.min(first, last), exit: Math.max(first, last) }
}

function firstContact(bounds: PlanAabb, delta: Point, obstacles: PlanAabb[]) {
  let contact: { time: number; axis: 'x' | 'y' } | null = null
  for (const obstacle of obstacles) {
    // A drag can start in a deliberate overlap created with collision disabled.
    if (planAabbsOverlap(bounds, obstacle)) continue
    const x = getOverlapTimes(bounds.minX, bounds.maxX, obstacle.minX, obstacle.maxX, delta.x)
    const y = getOverlapTimes(bounds.minY, bounds.maxY, obstacle.minY, obstacle.maxY, delta.y)
    if (!x || !y) continue
    const time = Math.max(0, x.enter, y.enter)
    if (time >= (contact?.time ?? 1) || time >= Math.min(x.exit, y.exit)) continue
    contact = { time, axis: x.enter >= y.enter ? 'x' : 'y' }
  }
  return contact
}

export function constrainModelDrag(bounds: PlanAabb, delta: Point, obstacles: PlanAabb[], slide: boolean): Point {
  const contact = firstContact(bounds, delta, obstacles)
  if (!contact) return delta
  const travelled = { x: delta.x * contact.time, y: delta.y * contact.time }
  if (!slide) return travelled

  const remaining = contact.axis === 'x' ? { x: 0, y: delta.y - travelled.y } : { x: delta.x - travelled.x, y: 0 }
  const fraction = firstContact(translatePlanBounds(bounds, travelled), remaining, obstacles)?.time ?? 1
  return { x: travelled.x + remaining.x * fraction, y: travelled.y + remaining.y * fraction }
}
