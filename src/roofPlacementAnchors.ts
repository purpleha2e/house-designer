import type { FloorLevel, Point, Wall } from './types.ts'
import { buildWallTopology } from './wallTopology.ts'

export function buildRoofAttachmentContext(floors: FloorLevel[], elevation: number) {
  const attachmentFloors = floors.filter((floor) => floor.elevation >= elevation)
  return {
    walls: attachmentFloors.flatMap((floor) => floor.walls),
    // Upper-storey walls are valid snap targets, but their rooms must be
    // detected separately. Stacking storeys into one wall union creates false
    // room boundaries and can fail on coincident wall polygons.
    rooms: attachmentFloors.flatMap((floor) => buildWallTopology(floor.walls).rooms),
  }
}

const ROOF_WALL_ANCHOR_STEP_METERS = 0.1

function distance(firstPoint: Point, secondPoint: Point) {
  return Math.hypot(
    secondPoint.x - firstPoint.x,
    secondPoint.y - firstPoint.y,
  )
}

function pointKey(point: Point) {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`
}

function normalizePoint(point: Point) {
  return {
    x: Number(point.x.toFixed(6)),
    y: Number(point.y.toFixed(6)),
  }
}

function cross(first: Point, second: Point) {
  return first.x * second.y - first.y * second.x
}

function getExternalWallContinuationPoints(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind === 'external')
  const pointsByKey = new Map<string, Point>()

  externalWalls.forEach((sourceWall) => {
    const sourceVector = {
      x: sourceWall.end.x - sourceWall.start.x,
      y: sourceWall.end.y - sourceWall.start.y,
    }
    if (Math.hypot(sourceVector.x, sourceVector.y) <= 0.000001) {
      return
    }

    walls.forEach((targetWall) => {
      if (sourceWall === targetWall) {
        return
      }

      const targetVector = {
        x: targetWall.end.x - targetWall.start.x,
        y: targetWall.end.y - targetWall.start.y,
      }
      const denominator = cross(sourceVector, targetVector)

      if (Math.abs(denominator) <= 0.000001) {
        return
      }

      const startDelta = {
        x: targetWall.start.x - sourceWall.start.x,
        y: targetWall.start.y - sourceWall.start.y,
      }
      const sourceT = cross(startDelta, targetVector) / denominator
      const targetT = cross(startDelta, sourceVector) / denominator
      const targetLength = Math.hypot(targetVector.x, targetVector.y)
      const joinTolerance = sourceWall.thickness / 2 + 0.02
      const targetTolerance = targetLength <= 0.000001
        ? 0
        : joinTolerance / targetLength

      if (targetT < -targetTolerance || targetT > 1 + targetTolerance) {
        return
      }

      const point = normalizePoint({
        x: sourceWall.start.x + sourceVector.x * sourceT,
        y: sourceWall.start.y + sourceVector.y * sourceT,
      })
      pointsByKey.set(pointKey(point), point)
    })
  })

  return Array.from(pointsByKey.values())
}

export function getRoofPlacementSnapPoints(walls: Wall[]) {
  const pointsByKey = new Map<string, Point>()

  walls
    .filter((wall) => wall.kind === 'external')
    .forEach((wall) => {
      pointsByKey.set(pointKey(wall.start), wall.start)
      pointsByKey.set(pointKey(wall.end), wall.end)
    })
  getExternalWallContinuationPoints(walls).forEach((point) => {
    pointsByKey.set(pointKey(point), point)
  })

  return Array.from(pointsByKey.values())
}

function anchorAtDistance(wall: Wall, distanceAlongWall: number) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const wallLength = Math.hypot(dx, dy)

  if (wallLength <= 0.000001) {
    return wall.start
  }

  const station = Math.round(distanceAlongWall / ROOF_WALL_ANCHOR_STEP_METERS) *
    ROOF_WALL_ANCHOR_STEP_METERS
  return normalizePoint({
    x: wall.start.x + (dx / wallLength) * station,
    y: wall.start.y + (dy / wallLength) * station,
  })
}

export function getClosestExternalWallPoint(point: Point, walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind === 'external')

  const cornerCandidates = externalWalls
    .flatMap((wall) => [wall.start, wall.end])
    .map((candidatePoint) => ({
      distance: distance(point, candidatePoint),
      point: candidatePoint,
    }))
    .filter((candidate) => candidate.distance <= 0.22)
  const continuationCandidates = getExternalWallContinuationPoints(externalWalls)
    .map((candidatePoint) => ({
      distance: distance(point, candidatePoint),
      point: candidatePoint,
    }))
    .filter((candidate) => candidate.distance <= 0.22)
  const wallCandidates = externalWalls
    .flatMap((wall) => {
      const dx = wall.end.x - wall.start.x
      const dy = wall.end.y - wall.start.y
      const lengthSquared = dx * dx + dy * dy

      if (lengthSquared <= 0.000001) {
        return []
      }

      const rawT =
        ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        lengthSquared
      const wallLength = Math.sqrt(lengthSquared)
      const linePoint = anchorAtDistance(wall, rawT * wallLength)

      return [{
        distance: distance(point, linePoint),
        point: linePoint,
      }]
    })
    .filter((candidate) => candidate.distance <= 0.22)
    .sort((firstCandidate, secondCandidate) =>
      firstCandidate.distance - secondCandidate.distance)

  const closestCorner = cornerCandidates.sort((firstCandidate, secondCandidate) =>
    firstCandidate.distance - secondCandidate.distance)[0]
  // Give the endpoint marker a capture region. Without this, the adjacent
  // 100 mm station can sit on top of the marker and a click records a different
  // point from the one the plan shows.
  if (closestCorner?.distance <= 0.15) return closestCorner.point

  const closestContinuation = continuationCandidates.sort(
    (firstCandidate, secondCandidate) =>
      firstCandidate.distance - secondCandidate.distance,
  )[0]
  if (closestContinuation?.distance <= 0.15) return closestContinuation.point

  return [...cornerCandidates, ...continuationCandidates, ...wallCandidates]
    .sort((firstCandidate, secondCandidate) =>
      firstCandidate.distance - secondCandidate.distance)[0]?.point ?? null
}
