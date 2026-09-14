import type { FloorLevel, Point, RoofStructure, Wall } from './types.ts'
import { buildBayRoofFaces, getBayRoofPolygon, getBaySupportPolygon, getBayRoofWithWallSupport } from './bayRoof.ts'
import { getRenderedWalls, getWallPolygon } from './wallGeometry.ts'
import { buildWallTopology, type DetectedRoom } from './wallTopology.ts'
import { buildRoofProfileFaces } from './roofProfile.ts'
import { getRoofThickness } from './roofThickness.ts'
import { resolveRoofJunctions, type ResolvedRoof } from './roofJunctions.ts'
import { getRoofAbutmentPlanes, wallOverlapsRoofHeight, type RoofAbuttingWall } from './roofAbutmentGeometry.ts'
import { isRoofAbuttingWall } from './roofWallClipping.ts'

export type BuildingRoof = {
  roof: RoofStructure
  floorId: string
  floorTopElevation: number
  abuttingWalls: RoofAbuttingWall[]
  resolved: ResolvedRoof
}

function getWallLength2d(wall: Wall) { return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) }

/**
 * Returns the wall face which points away from the roof's supported area.
 *
 * Room-based exterior detection is ambiguous when another room joins part of a
 * gable wall. A gable still has one stable outside face: the face opposite the
 * roof support centre.
 */
export function getWallSideAwayFromRoof(roof: RoofStructure, wall: Wall): -1 | 1 {
  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return 1
  }

  const leftNormal = {
    x: -(wall.end.y - wall.start.y) / length,
    y: (wall.end.x - wall.start.x) / length,
  }
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const roofCentre = roof.supportPosition ?? roof.position
  const roofSide =
    (roofCentre.x - midpoint.x) * leftNormal.x +
    (roofCentre.y - midpoint.y) * leftNormal.y

  return roofSide > 0 ? -1 : 1
}

function getRoomContainingPoint(rooms: DetectedRoom[], point: Point) {
  return rooms.find(({ polygon }) => {
    let inside = false
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length]
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    })
    return inside
  }) ?? null
}
function getExteriorWallSide(wall: Wall, rooms: DetectedRoom[]): -1 | 1 {
  if (wall.kind !== 'external') {
    return 1
  }

  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return 1
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  }
  const normal = {
    x: -unit.y,
    y: unit.x,
  }
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const sampleDistance = wall.thickness / 2 + 0.08
  const positiveRoom = getRoomContainingPoint(rooms, {
    x: midpoint.x + normal.x * sampleDistance,
    y: midpoint.y + normal.y * sampleDistance,
  })
  const negativeRoom = getRoomContainingPoint(rooms, {
    x: midpoint.x - normal.x * sampleDistance,
    y: midpoint.y - normal.y * sampleDistance,
  })

  if (positiveRoom && !negativeRoom) {
    return -1
  }

  if (negativeRoom && !positiveRoom) {
    return 1
  }

  return 1
}


export function getLeanToPanelLocalExtents(
  roof: RoofStructure,
  walls: Wall[] = [],
  rooms: DetectedRoom[] = [],
) {
  const extents = getRoofPanelLocalExtents(roof)
  const tolerance = 0.2
  const highEdgeX = extents.maxX
  const wallFaceX = getRenderedWalls(walls)
    .filter(({ wall }) => wall.kind === 'external')
    .flatMap((renderedWall) => {
      const { wall } = renderedWall
      const wallStart = getRoofLocalPoint(roof, wall.start)
      const wallEnd = getRoofLocalPoint(roof, wall.end)
      const wallRunsAlongHighEdge =
        Math.abs(wallEnd.y - wallStart.y) >=
        Math.abs(wallEnd.x - wallStart.x)

      if (!wallRunsAlongHighEdge) {
        return []
      }

      const polygonPoints = getWallPolygon(renderedWall).map((point) =>
        getRoofLocalPoint(roof, point),
      )
      const wallMinX = Math.min(...polygonPoints.map((point) => point.x))
      const wallMaxX = Math.max(...polygonPoints.map((point) => point.x))
      const wallMinY = Math.min(...polygonPoints.map((point) => point.y))
      const wallMaxY = Math.max(...polygonPoints.map((point) => point.y))
      const overlapsDepth =
        wallMaxY >= extents.minY - tolerance &&
        wallMinY <= extents.maxY + tolerance

      if (
        !overlapsDepth ||
        wallMinX > highEdgeX + tolerance ||
        wallMaxX < highEdgeX - tolerance
      ) {
        return []
      }

      const wallLength = getWallLength2d(wall)

      if (wallLength <= 0.000001) {
        return []
      }

      const exteriorSide = getExteriorWallSide(wall, rooms)
      const unit = {
        x: (wall.end.x - wall.start.x) / wallLength,
        y: (wall.end.y - wall.start.y) / wallLength,
      }
      const normal = {
        x: -unit.y * exteriorSide,
        y: unit.x * exteriorSide,
      }
      const exteriorStart = getRoofLocalPoint(roof, {
        x: wall.start.x + normal.x * wall.thickness / 2,
        y: wall.start.y + normal.y * wall.thickness / 2,
      })
      const exteriorEnd = getRoofLocalPoint(roof, {
        x: wall.end.x + normal.x * wall.thickness / 2,
        y: wall.end.y + normal.y * wall.thickness / 2,
      })

      return [(exteriorStart.x + exteriorEnd.x) / 2]
    })
    .sort(
      (firstFaceX, secondFaceX) =>
        Math.abs(firstFaceX - highEdgeX) - Math.abs(secondFaceX - highEdgeX),
    )[0]

  return typeof wallFaceX === 'number' && Number.isFinite(wallFaceX)
    ? {
        ...extents,
        maxX: wallFaceX,
      }
    : extents
}

export function getRoofRidgeHeight(roof: RoofStructure) {
  if (roof.type === 'bay') return Math.max(0, ...buildBayRoofFaces(roof).flat().map((p) => p[1]))
  if (roof.type === 'flat') {
    return 0
  }

  const pitchRadians =
    (Math.min(75, Math.max(1, roof.pitchDegrees)) * Math.PI) / 180
  const supportBounds =
    roof.type === 'lean-to' || roof.type === 'up-and-over'
      ? getRoofSupportBoundsInRoofSpace(roof)
      : null
  const run =
    roof.type === 'lean-to'
      ? Math.max(0.3, supportBounds!.maxX - supportBounds!.minX)
      : roof.type === 'up-and-over'
      ? Math.max(0.15, (supportBounds!.maxX - supportBounds!.minX) / 2)
      : Math.min(Math.max(roof.width, 0.3), Math.max(roof.depth, 0.3)) / 2

  return Math.tan(pitchRadians) * run
}

export function getRoofLocalPoint(roof: RoofStructure, point: Point) {
  const origin =
    roof.type === 'hip' ? roof.position : roof.supportPosition ?? roof.position
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)

  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

export function getRoofWorldPointFromLocal(roof: RoofStructure, point: Point) {
  const origin = getRoofRenderPosition(roof)
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)

  return {
    x: origin.x + point.x * cos + point.y * sin,
    y: origin.y - point.x * sin + point.y * cos,
  }
}

export function getRoofSideOverhangs(roof: RoofStructure) {
  return {
    negative: Math.max(
      0,
      roof.overhangSideNegative ?? roof.overhangSide ?? 0,
    ),
    positive: Math.max(
      0,
      roof.overhangSidePositive ?? roof.overhangSide ?? 0,
    ),
  }
}

export function getRoofPanelLocalExtents(roof: RoofStructure) {
  if (roof.type === 'bay') {
    const points = getBayRoofPolygon(roof)
    return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) }
  }
  if (roof.type === 'hip') {
    const halfWidth = Math.max(roof.width, 0.3) / 2
    const halfDepth = Math.max(roof.depth, 0.3) / 2

    return {
      maxX: halfWidth,
      maxY: halfDepth,
      minX: -halfWidth,
      minY: -halfDepth,
    }
  }

  const supportBounds = getRoofSupportBoundsInRoofSpace(roof)
  const endOverhang = Math.max(0, roof.overhangEnd ?? 0)
  const sideOverhangs = getRoofSideOverhangs(roof)

  return {
    maxX:
      roof.type === 'lean-to'
        ? supportBounds.maxX
        : supportBounds.maxX + sideOverhangs.positive,
    maxY: supportBounds.maxY + endOverhang,
    minX: supportBounds.minX - sideOverhangs.negative,
    minY: supportBounds.minY - endOverhang,
  }
}

export function getRoofRenderPosition(roof: RoofStructure) {
  return roof.type === 'hip'
    ? roof.position
    : roof.supportPosition ?? roof.position
}

export function getRoofSupportWorldPoint(roof: RoofStructure, point: Point) {
  const supportPosition = roof.supportPosition ?? roof.position
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)

  return {
    x: supportPosition.x + point.x * cos + point.y * sin,
    y: supportPosition.y - point.x * sin + point.y * cos,
  }
}

export function getRoofSupportBoundsInRoofSpace(roof: RoofStructure) {
  if (roof.type === 'bay') {
    const points = getBaySupportPolygon(roof)
    return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) }
  }
  const bounds = getExplicitRoofSupportLocalBounds(roof)

  if (
    roof.type === 'flat' ||
    roof.type === 'lean-to' ||
    roof.type === 'up-and-over'
  ) {
    return bounds
  }

  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) =>
    getRoofLocalPoint(roof, getRoofSupportWorldPoint(roof, point)),
  )

  return {
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
  }
}

export function getRoofSupportLocalBounds(roof: RoofStructure) {
  const halfWidth = Math.max(roof.width, 0.3) / 2
  const halfDepth = Math.max(roof.depth, 0.3) / 2
  const endOverhang = Math.min(
    Math.max(0, roof.overhangEnd ?? 0),
    Math.max(0, halfDepth - 0.15),
  )
  const negativeSideOverhang = Math.min(
    Math.max(0, roof.overhangSideNegative ?? roof.overhangSide ?? 0),
    Math.max(0, halfWidth - 0.15),
  )
  const positiveSideOverhang = Math.min(
    Math.max(0, roof.overhangSidePositive ?? roof.overhangSide ?? 0),
    Math.max(0, halfWidth - 0.15),
  )

  return {
    maxX:
      roof.type === 'lean-to'
        ? halfWidth
        : Math.max(-halfWidth, halfWidth - positiveSideOverhang),
    maxY: Math.max(-halfDepth, halfDepth - endOverhang),
    minX: Math.min(
      halfWidth,
      -halfWidth + negativeSideOverhang,
    ),
    minY: Math.min(halfDepth, -halfDepth + endOverhang),
  }
}

export function getRoofSupportLocalPoint(roof: RoofStructure, point: Point) {
  const supportPosition = roof.supportPosition ?? roof.position
  const supportRotation = roof.rotation
  const dx = point.x - supportPosition.x
  const dy = point.y - supportPosition.y
  const cos = Math.cos(supportRotation)
  const sin = Math.sin(supportRotation)

  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

export function getExplicitRoofSupportLocalBounds(roof: RoofStructure) {
  if (!roof.supportPosition || !roof.supportWidth || !roof.supportDepth) {
    return getRoofSupportLocalBounds(roof)
  }

  return {
    maxX: Math.max(roof.supportWidth, 0.3) / 2,
    maxY: Math.max(roof.supportDepth, 0.3) / 2,
    minX: -Math.max(roof.supportWidth, 0.3) / 2,
    minY: -Math.max(roof.supportDepth, 0.3) / 2,
  }
}

export function getRoofWithExternalWallSupportExtents(
  roof: RoofStructure,
  walls: Wall[],
) {
  if (roof.type === 'bay') return getBayRoofWithWallSupport(roof, walls)
  if (roof.type === 'hip') {
    return roof
  }

  const hasExplicitSupport = Boolean(
    roof.supportPosition && roof.supportWidth && roof.supportDepth,
  )
  const bounds = hasExplicitSupport
    ? getExplicitRoofSupportLocalBounds(roof)
    : getRoofSupportLocalBounds(roof)
  const tolerance = 0.2
  let minX = bounds.minX
  let maxX = bounds.maxX
  let minY = bounds.minY
  let maxY = bounds.maxY

  getRenderedWalls(walls)
    .filter(({ wall }) => wall.kind === 'external')
    .forEach((renderedWall) => {
      const { wall } = renderedWall
      const start = getRoofSupportLocalPoint(roof, wall.start)
      const end = getRoofSupportLocalPoint(roof, wall.end)
      const wallMinX = Math.min(start.x, end.x)
      const wallMaxX = Math.max(start.x, end.x)
      const wallMinY = Math.min(start.y, end.y)
      const wallMaxY = Math.max(start.y, end.y)
      const polygonPoints = getWallPolygon(renderedWall).map((point) =>
        getRoofSupportLocalPoint(roof, point),
      )
      const wallExtentMinX = Math.min(...polygonPoints.map((point) => point.x))
      const wallExtentMaxX = Math.max(...polygonPoints.map((point) => point.x))
      const wallExtentMinY = Math.min(...polygonPoints.map((point) => point.y))
      const wallExtentMaxY = Math.max(...polygonPoints.map((point) => point.y))
      const runsAlongRoofWidth = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
      const runsAlongRoofDepth = !runsAlongRoofWidth
      const overlapsRoofWidth = wallMaxX >= bounds.minX - tolerance &&
        wallMinX <= bounds.maxX + tolerance
      const overlapsRoofDepth = wallMaxY >= bounds.minY - tolerance &&
        wallMinY <= bounds.maxY + tolerance
      const wallFootprintOverlapsRoofDepth =
        wallExtentMaxY >= bounds.minY - tolerance &&
        wallExtentMinY <= bounds.maxY + tolerance
      const leanToHighEdgeIntersectsWallFootprint =
        roof.type === 'lean-to' &&
        runsAlongRoofDepth &&
        wallFootprintOverlapsRoofDepth &&
        wallExtentMinX <= bounds.maxX + tolerance &&
        wallExtentMaxX >= bounds.maxX - tolerance
      const onSupportEnd =
        runsAlongRoofWidth &&
        overlapsRoofWidth &&
        ((Math.abs(start.y - bounds.minY) <= tolerance &&
          Math.abs(end.y - bounds.minY) <= tolerance) ||
          (Math.abs(start.y - bounds.maxY) <= tolerance &&
            Math.abs(end.y - bounds.maxY) <= tolerance))
      const onMinSupportSide =
        runsAlongRoofDepth &&
        overlapsRoofDepth &&
        Math.abs(start.x - bounds.minX) <= tolerance &&
        Math.abs(end.x - bounds.minX) <= tolerance
      const onMaxSupportSide =
        runsAlongRoofDepth &&
        ((
          overlapsRoofDepth &&
          Math.abs(start.x - bounds.maxX) <= tolerance &&
          Math.abs(end.x - bounds.maxX) <= tolerance
        ) ||
          leanToHighEdgeIntersectsWallFootprint)
      const onSupportSide = onMinSupportSide || onMaxSupportSide

      if (onSupportEnd) {
        if (
          !hasExplicitSupport ||
          Math.abs(bounds.minX - Math.min(start.x, end.x)) <= tolerance
        ) {
          minX = Math.min(minX, wallExtentMinX)
        }

        if (
          !hasExplicitSupport ||
          Math.abs(bounds.maxX - Math.max(start.x, end.x)) <= tolerance
        ) {
          maxX = Math.max(maxX, wallExtentMaxX)
        }
      }

      if (onSupportSide) {
        if (onMinSupportSide) {
          minX = roof.type === 'lean-to'
            ? Math.min(minX, wallExtentMinX)
            : Math.min(minX, wallExtentMinX)
        }

        if (onMaxSupportSide) {
          maxX = roof.type === 'lean-to'
            ? Math.abs(wallExtentMinX - bounds.minX) <=
                Math.abs(wallExtentMaxX - bounds.minX)
              ? wallExtentMinX
              : wallExtentMaxX
            : Math.max(maxX, wallExtentMaxX)
        }

        if (
          !hasExplicitSupport ||
          Math.abs(bounds.minY - Math.min(start.y, end.y)) <= tolerance
        ) {
          minY = Math.min(minY, wallExtentMinY)
        }

        if (
          !hasExplicitSupport ||
          Math.abs(bounds.maxY - Math.max(start.y, end.y)) <= tolerance
        ) {
          maxY = Math.max(maxY, wallExtentMaxY)
        }
      }
    })

  const endOverhang = Math.max(0, roof.overhangEnd ?? 0)
  const negativeSideOverhang = Math.max(
    0,
    roof.overhangSideNegative ?? roof.overhangSide ?? 0,
  )
  const positiveSideOverhang = Math.max(
    0,
    roof.overhangSidePositive ?? roof.overhangSide ?? 0,
  )
  const roofMinX = minX - negativeSideOverhang
  const roofMaxX = roof.type === 'lean-to' ? maxX : maxX + positiveSideOverhang
  const roofMinY = minY - endOverhang
  const roofMaxY = maxY + endOverhang
  const supportCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }
  const localCenter = {
    x: (roofMinX + roofMaxX) / 2,
    y: (roofMinY + roofMaxY) / 2,
  }

  return {
    ...roof,
    depth: Math.max(0.3, roofMaxY - roofMinY),
    position: getRoofSupportWorldPoint(roof, localCenter),
    supportDepth: Math.max(0.3, maxY - minY),
    supportPosition: getRoofSupportWorldPoint(roof, supportCenter),
    supportWidth: Math.max(0.3, maxX - minX),
    width: Math.max(0.3, roofMaxX - roofMinX),
  }
}

export function resolveBuildingRoofs(floors: FloorLevel[]): BuildingRoof[] {
    const wallFloors = floors.map((floor) => ({ floor, rooms: buildWallTopology(floor.walls).rooms }))
    const candidates = floors.flatMap((floor) => (floor.roofs ?? []).map((sourceRoof) => {
      const roof = getRoofWithExternalWallSupportExtents(sourceRoof, floor.walls)
      const floorTopElevation = floor.elevation + floor.roomHeight
      const bounds = getRoofSupportBoundsInRoofSpace(roof)
      const roofHeights = buildRoofProfileFaces(roof, getRoofPanelLocalExtents(roof), bounds)
        .flatMap((face) => face.map(([, y]) => floorTopElevation + (roof.heightOffset ?? 0) + y))
      const roofMinY = Math.min(...roofHeights) - getRoofThickness(roof)
      const roofMaxY = Math.max(...roofHeights)
      const supportPolygon = (roof.type === 'bay' ? getBaySupportPolygon(roof) : [
        { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
      ]).map((point) => getRoofWorldPointFromLocal(roof, point))
      const abuttingWalls = wallFloors
        .filter(({ floor: candidate }) => candidate.elevation <= floorTopElevation + (roof.heightOffset ?? 0) + getRoofRidgeHeight(roof))
        .flatMap(({ floor: candidate, rooms }) => candidate.walls
          .filter((wall) => wallOverlapsRoofHeight({ wall, elevation: candidate.elevation }, roofMinY, roofMaxY) &&
            isRoofAbuttingWall({ wall, supportPolygon, isInsideRoom: (point) => getRoomContainingPoint(rooms, point) !== null }))
          .map((wall) => ({ wall, elevation: candidate.elevation })))
      return { roof, floorId: floor.id, floorTopElevation, abuttingWalls }
    }))
    const resolved = resolveRoofJunctions(candidates.map((candidate) => ({
      roof: candidate.roof,
      floorId: candidate.floorId,
      elevation: candidate.floorTopElevation,
      support: getRoofSupportBoundsInRoofSpace(candidate.roof),
      extents: candidate.roof.type === 'lean-to'
        ? getLeanToPanelLocalExtents(candidate.roof, floors.find((floor) => floor.id === candidate.floorId)!.walls,
            wallFloors.find(({ floor }) => floor.id === candidate.floorId)!.rooms)
        : getRoofPanelLocalExtents(candidate.roof),
      abutments: candidate.abuttingWalls.flatMap((wall) => getRoofAbutmentPlanes([wall], getRoofRenderPosition(candidate.roof))
        .map((plane) => ({ plane, top: wall.elevation + wall.wall.height }))),
    })))
    return candidates.map((candidate, index) => ({ ...candidate, resolved: resolved[index] }))
}
