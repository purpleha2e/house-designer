import type { Point, Wall } from './types'

const CONNECTION_EPSILON_METERS = 0.02

export type RenderedWall = {
  wall: Wall
  startExtension: number
  endExtension: number
}

export type WallPolygon = [Point, Point, Point, Point]

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function getProjectionOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return { point: start, t: 0 }
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )

  return {
    point: {
      x: start.x + t * dx,
      y: start.y + t * dy,
    },
    t,
  }
}

function pointIsOnWallSnapLine(distanceToCenterline: number, wall: Wall) {
  return (
    distanceToCenterline <= CONNECTION_EPSILON_METERS ||
    Math.abs(distanceToCenterline - wall.thickness / 2) <=
      CONNECTION_EPSILON_METERS
  )
}

function normalize(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return { x: dx / length, y: dy / length }
}

function getWallDirectionAwayFromEndpoint(
  sourceWall: Wall,
  endpoint: 'start' | 'end',
) {
  return endpoint === 'start'
    ? normalize(
        sourceWall.end.x - sourceWall.start.x,
        sourceWall.end.y - sourceWall.start.y,
      )
    : normalize(
        sourceWall.start.x - sourceWall.end.x,
        sourceWall.start.y - sourceWall.end.y,
      )
}

function getOtherWallDirectionFromJoin(point: Point, wall: Wall) {
  const distanceToStart = distance(point, wall.start)
  const distanceToEnd = distance(point, wall.end)

  return distanceToStart <= distanceToEnd
    ? normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    : normalize(wall.start.x - wall.end.x, wall.start.y - wall.end.y)
}

function isExternalWall(wall: Wall) {
  return wall.kind !== 'internal'
}

function hasAdditionalJoinContext(
  point: Point,
  sourceWall: Wall,
  targetWall: Wall,
  walls: Wall[],
) {
  return walls.some((wall) => {
    if (wall.id === sourceWall.id || wall.id === targetWall.id) {
      return false
    }

    if (isExternalWall(sourceWall) && !isExternalWall(wall)) {
      return false
    }

    if (
      distance(point, wall.start) <= CONNECTION_EPSILON_METERS ||
      distance(point, wall.end) <= CONNECTION_EPSILON_METERS
    ) {
      return true
    }

    const { point: closestPointOnWall, t } = getProjectionOnSegment(
      point,
      wall.start,
      wall.end,
    )

    return (
      t >= 0 &&
      t <= 1 &&
      pointIsOnWallSnapLine(distance(point, closestPointOnWall), wall)
    )
  })
}

function getJoinExtension(
  point: Point,
  endpoint: 'start' | 'end',
  sourceWall: Wall,
  walls: Wall[],
) {
  let extension = 0

  for (const wall of walls) {
    if (wall.id === sourceWall.id) {
      continue
    }

    if (isExternalWall(sourceWall) && !isExternalWall(wall)) {
      continue
    }

    const touchesExternalCorner =
      isExternalWall(sourceWall) &&
      isExternalWall(wall) &&
      (distance(point, wall.start) <= CONNECTION_EPSILON_METERS ||
        distance(point, wall.end) <= CONNECTION_EPSILON_METERS)

    if (touchesExternalCorner) {
      extension = Math.max(extension, wall.thickness / 2)
      continue
    }

    const touchesWallEndpoint =
      distance(point, wall.start) <= CONNECTION_EPSILON_METERS ||
      distance(point, wall.end) <= CONNECTION_EPSILON_METERS

    if (touchesWallEndpoint) {
      const sourceDirection = getWallDirectionAwayFromEndpoint(sourceWall, endpoint)
      const otherDirection = getOtherWallDirectionFromJoin(point, wall)
      const cross =
        sourceDirection.x * otherDirection.y - sourceDirection.y * otherDirection.x

      if (
        Math.abs(cross) > 0.08 &&
        !hasAdditionalJoinContext(point, sourceWall, wall, walls)
      ) {
        extension = Math.max(extension, wall.thickness / 2)
        continue
      }
    }

    const { point: closestPointOnWall, t } = getProjectionOnSegment(
      point,
      wall.start,
      wall.end,
    )
    const distanceToCenterline = distance(point, closestPointOnWall)
    const pointIsWithinWallBody =
      t > CONNECTION_EPSILON_METERS &&
      t < 1 - CONNECTION_EPSILON_METERS &&
      pointIsOnWallSnapLine(distanceToCenterline, wall)
    const pointIsOnWallEndCap =
      sourceWall.kind === 'internal' &&
      isExternalWall(wall) &&
      (t <= CONNECTION_EPSILON_METERS ||
        t >= 1 - CONNECTION_EPSILON_METERS) &&
      distanceToCenterline <= wall.thickness / 2 + CONNECTION_EPSILON_METERS

    if (pointIsWithinWallBody || pointIsOnWallEndCap) {
      const wallDirection = normalize(
        wall.end.x - wall.start.x,
        wall.end.y - wall.start.y,
      )
      const wallNormal = {
        x: -wallDirection.y,
        y: wallDirection.x,
      }
      const sourceDirection = getWallDirectionAwayFromEndpoint(sourceWall, endpoint)
      const directionDotNormal =
        sourceDirection.x * wallNormal.x + sourceDirection.y * wallNormal.y

      if (pointIsOnWallEndCap && Math.abs(directionDotNormal) < 0.35) {
        continue
      }

      const signedDistanceToCenterline =
        (point.x - closestPointOnWall.x) * wallNormal.x +
        (point.y - closestPointOnWall.y) * wallNormal.y
      const faceDistances = [-wall.thickness / 2, wall.thickness / 2]
        .map((faceDistance) =>
          Math.abs(directionDotNormal) > 0.08
            ? (faceDistance - signedDistanceToCenterline) / directionDotNormal
            : Number.POSITIVE_INFINITY,
        )
        .filter((faceDistance) => faceDistance >= 0)
      const abutmentDistance = Math.min(...faceDistances)
      const abutmentExtension = Number.isFinite(abutmentDistance)
        ? -Math.min(abutmentDistance, wall.thickness)
        : 0

      if (Math.abs(abutmentExtension) > Math.abs(extension)) {
        extension = abutmentExtension
      }
    }
  }

  return extension
}

export function getRenderedWalls(walls: Wall[]): RenderedWall[] {
  return walls.map((wall) => ({
    wall,
    startExtension: getJoinExtension(wall.start, 'start', wall, walls),
    endExtension: getJoinExtension(wall.end, 'end', wall, walls),
  }))
}

export function getWallPolygon({
  wall,
  startExtension,
  endExtension,
}: RenderedWall): WallPolygon {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return [wall.start, wall.start, wall.end, wall.end]
  }

  const unitX = dx / length
  const unitY = dy / length
  const normalX = -unitY
  const normalY = unitX
  const halfThickness = wall.thickness / 2
  const start = {
    x: wall.start.x - unitX * startExtension,
    y: wall.start.y - unitY * startExtension,
  }
  const end = {
    x: wall.end.x + unitX * endExtension,
    y: wall.end.y + unitY * endExtension,
  }

  return [
    {
      x: start.x + normalX * halfThickness,
      y: start.y + normalY * halfThickness,
    },
    {
      x: end.x + normalX * halfThickness,
      y: end.y + normalY * halfThickness,
    },
    {
      x: end.x - normalX * halfThickness,
      y: end.y - normalY * halfThickness,
    },
    {
      x: start.x - normalX * halfThickness,
      y: start.y - normalY * halfThickness,
    },
  ]
}
