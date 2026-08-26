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

function getWallDirection(wall: Pick<Wall, 'end' | 'start'>) {
  return normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

function getProjectionOnWallSegment(point: Point, wall: Pick<Wall, 'end' | 'start'>) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= 0) {
    return {
      distance: distance(point, wall.start),
      t: 0,
    }
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        lengthSquared,
    ),
  )
  const closestPoint = {
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
  }

  return {
    distance: distance(point, closestPoint),
    t,
  }
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

function getSegmentIntersectionParameters(
  firstWall: Pick<Wall, 'end' | 'start'>,
  secondWall: Pick<Wall, 'end' | 'start'>,
) {
  const firstDx = firstWall.end.x - firstWall.start.x
  const firstDy = firstWall.end.y - firstWall.start.y
  const secondDx = secondWall.end.x - secondWall.start.x
  const secondDy = secondWall.end.y - secondWall.start.y
  const denominator = firstDx * secondDy - firstDy * secondDx

  if (Math.abs(denominator) <= 0.000001) {
    return null
  }

  const startDx = secondWall.start.x - firstWall.start.x
  const startDy = secondWall.start.y - firstWall.start.y

  return {
    firstT: (startDx * secondDy - startDy * secondDx) / denominator,
    secondT: (startDx * firstDy - startDy * firstDx) / denominator,
  }
}

export function wallDoesNotCrossOtherWalls({
  movingWall,
  tolerance,
  walls,
}: {
  movingWall: Pick<Wall, 'end' | 'id' | 'start'>
  tolerance: number
  walls: Wall[]
}) {
  return walls.every((wall) => {
    if (wall.id === movingWall.id) {
      return true
    }

    const intersection = getSegmentIntersectionParameters(movingWall, wall)

    if (!intersection) {
      return true
    }

    return (
      intersection.firstT <= tolerance ||
      intersection.firstT >= 1 - tolerance ||
      intersection.secondT <= tolerance ||
      intersection.secondT >= 1 - tolerance
    )
  })
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

export function wallRespectsMinimumJoinAngles({
  movingWall,
  tolerance,
  walls,
}: {
  movingWall: Pick<Wall, 'end' | 'id' | 'start'>
  tolerance: number
  walls: Wall[]
}) {
  if (
    !wallDoesNotCrossOtherWalls({
      movingWall,
      tolerance,
      walls,
    })
  ) {
    return false
  }

  const endpointJoinsAreValid = wallRespectsMinimumEndpointJoinAngles({
    movingWall,
    tolerance,
    walls,
  })

  if (!endpointJoinsAreValid) {
    return false
  }

  return (['start', 'end'] as const).every((endpoint) => {
    const movingDirection = getDirectionAwayFromEndpoint(movingWall, endpoint)

    if (!movingDirection) {
      return true
    }

    return walls.every((wall) => {
      if (wall.id === movingWall.id) {
        return true
      }

      if (getEndpointAtPoint(wall, movingWall[endpoint], tolerance)) {
        return true
      }

      const projection = getProjectionOnWallSegment(movingWall[endpoint], wall)
      const wallDirection = getWallDirection(wall)

      if (
        !wallDirection ||
        projection.t <= tolerance ||
        projection.t >= 1 - tolerance ||
        projection.distance > wall.thickness / 2 + tolerance
      ) {
        return true
      }

      const absoluteDot = Math.abs(
        movingDirection.x * wallDirection.x +
          movingDirection.y * wallDirection.y,
      )

      return absoluteDot <= Math.cos(MIN_WALL_JOIN_ANGLE_RADIANS)
    })
  })
}
