import type { FloorLevel, Point, Wall } from './types.ts'
import { buildWallTopology } from './wallTopology.ts'

export function buildRoofAttachmentContext(floors: FloorLevel[], elevation: number) {
  const topologies = floors.filter((floor) => floor.elevation >= elevation)
    .map((floor) => buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints }))
  return {
    // Roof anchors must agree with the visible wall joins. Authored endpoints
    // can differ even though wall topology has already snapped them together.
    walls: topologies.flatMap((topology) =>
      Array.from(topology.renderedWallsById.values(), ({ wall }) => wall)),
    // Upper-storey walls are valid snap targets, but their rooms must be
    // detected separately. Stacking storeys into one wall union creates false
    // room boundaries and can fail on coincident wall polygons.
    rooms: topologies.flatMap((topology) => topology.rooms),
  }
}

const ROOF_WALL_ANCHOR_STEP_METERS = 0.1

/** Snap each plan axis independently to selected roof mounting points. */
export function alignRoofPlacementPoint(point: Point, anchors: Point[], tolerance: number) {
  const nearest = (axis: 'x' | 'y') => anchors.reduce<number | undefined>((best, anchor) =>
    Math.abs(point[axis] - anchor[axis]) <= tolerance &&
      (best === undefined || Math.abs(point[axis] - anchor[axis]) < Math.abs(point[axis] - best))
      ? anchor[axis] : best, undefined)
  const x = nearest('x'), y = nearest('y')
  return { point: { x: x ?? point.x, y: y ?? point.y }, vertical: x, horizontal: y }
}

/** The mounting wall is the high edge; the selected footprint is the low side. */
export function getLeanToRotationFromMountingWall(wall: Wall, points: Point[], fallbackExteriorSide: -1 | 1) {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null
  const normal = { x: -dy / length, y: dx / length }
  const distances = points.map(point => (point.x - wall.start.x) * normal.x +
    (point.y - wall.start.y) * normal.y).filter(value => Math.abs(value) > wall.thickness / 2 + 0.02)
  // Room membership is only a fallback while both selected points are on the
  // wall. Stacked storeys can have a room on each side of the same plan line.
  const side = distances.length && distances.every(value => value > 0) ? 1
    : distances.length && distances.every(value => value < 0) ? -1 : fallbackExteriorSide
  return Math.atan2(normal.y * side, -normal.x * side)
}

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

function getExternalWallContinuationPoints(walls: Wall[], includeProjected = true) {
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
      const sourceTolerance = joinTolerance / Math.hypot(sourceVector.x, sourceVector.y)
      if (!includeProjected && (sourceT < -sourceTolerance || sourceT > 1 + sourceTolerance)) {
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

export function getRoofPlacementSnapPoints(walls: Wall[], { includeProjected = true } = {}) {
  const pointsByKey = new Map<string, Point>()

  walls
    .filter((wall) => wall.kind === 'external')
    .forEach((wall) => {
      pointsByKey.set(pointKey(wall.start), wall.start)
      pointsByKey.set(pointKey(wall.end), wall.end)
    })
  getExternalWallContinuationPoints(walls, includeProjected).forEach((point) => {
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
