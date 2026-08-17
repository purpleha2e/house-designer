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

function getClosestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return start
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )

  return {
    x: start.x + t * dx,
    y: start.y + t * dy,
  }
}

function getJoinExtension(point: Point, sourceWall: Wall, walls: Wall[]) {
  let extension = 0

  for (const wall of walls) {
    if (wall.id === sourceWall.id) {
      continue
    }

    if (
      distance(point, wall.start) <= CONNECTION_EPSILON_METERS ||
      distance(point, wall.end) <= CONNECTION_EPSILON_METERS ||
      distance(point, getClosestPointOnSegment(point, wall.start, wall.end)) <=
        CONNECTION_EPSILON_METERS
    ) {
      extension = Math.max(extension, wall.thickness / 2)
    }
  }

  return extension
}

export function getRenderedWalls(walls: Wall[]): RenderedWall[] {
  return walls.map((wall) => ({
    wall,
    startExtension: getJoinExtension(wall.start, wall, walls),
    endExtension: getJoinExtension(wall.end, wall, walls),
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
