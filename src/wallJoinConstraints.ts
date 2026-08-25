import type { Point, Wall } from './types'

export const MIN_WALL_JOIN_ANGLE_DEGREES = 45
export const MIN_WALL_JOIN_ANGLE_RADIANS =
  (MIN_WALL_JOIN_ANGLE_DEGREES * Math.PI) / 180

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function normalize(dx: number, dy: number): Point | null {
  const length = Math.hypot(dx, dy)

  return length > 0 ? { x: dx / length, y: dy / length } : null
}

function getDirectionAwayFromEndpoint(
  wall: Pick<Wall, 'end' | 'start'>,
  endpoint: 'end' | 'start',
) {
  return endpoint === 'start'
    ? normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    : normalize(wall.start.x - wall.end.x, wall.start.y - wall.end.y)
}

function getEndpointAtPoint(
  wall: Pick<Wall, 'end' | 'start'>,
  point: Point,
  tolerance: number,
): 'end' | 'start' | null {
  if (distance(wall.start, point) <= tolerance) {
    return 'start'
  }

  if (distance(wall.end, point) <= tolerance) {
    return 'end'
  }

  return null
}

export function getEndpointJoinAngleRadians({
  firstEndpoint,
  firstWall,
  secondEndpoint,
  secondWall,
}: {
  firstEndpoint: 'end' | 'start'
  firstWall: Pick<Wall, 'end' | 'start'>
  secondEndpoint: 'end' | 'start'
  secondWall: Pick<Wall, 'end' | 'start'>
}) {
  const firstDirection = getDirectionAwayFromEndpoint(firstWall, firstEndpoint)
  const secondDirection = getDirectionAwayFromEndpoint(secondWall, secondEndpoint)

  if (!firstDirection || !secondDirection) {
    return Math.PI
  }

  const dot = Math.max(
    -1,
    Math.min(
      1,
      firstDirection.x * secondDirection.x +
        firstDirection.y * secondDirection.y,
    ),
  )

  return Math.acos(dot)
}

export function endpointSnapRespectsMinimumJoinAngle({
  endpoint,
  movingWall,
  snapPoint,
  tolerance,
  walls,
}: {
  endpoint: 'end' | 'start'
  movingWall: Pick<Wall, 'end' | 'id' | 'start'>
  snapPoint: Point
  tolerance: number
  walls: Wall[]
}) {
  const nextMovingWall = {
    ...movingWall,
    [endpoint]: snapPoint,
  }

  return walls.every((wall) => {
    if (wall.id === movingWall.id) {
      return true
    }

    const otherEndpoint = getEndpointAtPoint(wall, snapPoint, tolerance)

    if (!otherEndpoint) {
      return true
    }

    return (
      getEndpointJoinAngleRadians({
        firstEndpoint: endpoint,
        firstWall: nextMovingWall,
        secondEndpoint: otherEndpoint,
        secondWall: wall,
      }) >= MIN_WALL_JOIN_ANGLE_RADIANS
    )
  })
}

export function wallRespectsMinimumEndpointJoinAngles({
  movingWall,
  tolerance,
  walls,
}: {
  movingWall: Pick<Wall, 'end' | 'id' | 'start'>
  tolerance: number
  walls: Wall[]
}) {
  return (['start', 'end'] as const).every((endpoint) =>
    walls.every((wall) => {
      if (wall.id === movingWall.id) {
        return true
      }

      const otherEndpoint = getEndpointAtPoint(
        wall,
        movingWall[endpoint],
        tolerance,
      )

      if (!otherEndpoint) {
        return true
      }

      return (
        getEndpointJoinAngleRadians({
          firstEndpoint: endpoint,
          firstWall: movingWall,
          secondEndpoint: otherEndpoint,
          secondWall: wall,
        }) >= MIN_WALL_JOIN_ANGLE_RADIANS
      )
    }),
  )
}
