import type { Point, Wall } from '../types.ts'

const DIRECTION_EPSILON = 0.000001

export function getCanonicalWallUvDirection(wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  const direction =
    length > DIRECTION_EPSILON
      ? { x: dx / length, y: dy / length }
      : { x: 1, y: 0 }

  if (
    direction.x < -DIRECTION_EPSILON ||
    (Math.abs(direction.x) <= DIRECTION_EPSILON &&
      direction.y < -DIRECTION_EPSILON)
  ) {
    return { x: -direction.x, y: -direction.y }
  }

  return direction
}

export function getCanonicalWallUvDistance(wall: Wall, point: Point) {
  const direction = getCanonicalWallUvDirection(wall)

  return point.x * direction.x + point.y * direction.y
}
