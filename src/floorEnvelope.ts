import type { Point, Wall } from './types.ts'
import { buildWallTopology } from './wallTopology.ts'

const SAMPLE_OFFSET_METERS = 0.06

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= 0.000001) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= 0.00001
  }

  const t =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
    lengthSquared

  if (t < -0.00001 || t > 1.00001) {
    return false
  }

  return Math.hypot(
    point.x - (start.x + dx * t),
    point.y - (start.y + dy * t),
  ) <= 0.00001
}

function pointIsInsideRoom(point: Point, polygon: Point[]) {
  if (
    polygon.some((start, index) =>
      pointIsOnSegment(point, start, polygon[(index + 1) % polygon.length]),
    )
  ) {
    return true
  }

  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]

    if (
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    ) {
      inside = !inside
    }
  }

  return inside
}

/** Returns walls that geometrically separate an enclosed room from outside. */
export function getFloorEnvelopeWalls(walls: Wall[]) {
  const rooms = buildWallTopology(walls).rooms

  if (rooms.length === 0) {
    return walls.filter((wall) => wall.kind === 'external')
  }

  const pointIsInAnyRoom = (point: Point) =>
    rooms.some((room) => pointIsInsideRoom(point, room.polygon))

  return walls.filter((wall) => {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dy)

    if (length <= 0.000001) {
      return false
    }

    const normal = { x: -dy / length, y: dx / length }
    const offset = wall.thickness / 2 + SAMPLE_OFFSET_METERS

    return [0.2, 0.5, 0.8].some((amount) => {
      const point = {
        x: wall.start.x + dx * amount,
        y: wall.start.y + dy * amount,
      }
      const positiveSideIsRoom = pointIsInAnyRoom({
        x: point.x + normal.x * offset,
        y: point.y + normal.y * offset,
      })
      const negativeSideIsRoom = pointIsInAnyRoom({
        x: point.x - normal.x * offset,
        y: point.y - normal.y * offset,
      })

      return positiveSideIsRoom !== negativeSideIsRoom
    })
  })
}
