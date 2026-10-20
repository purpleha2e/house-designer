import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import type { Point, RoofStructure, Wall } from './types.ts'
import type { RenderedWall } from './wallGeometry.ts'
import type { RoofVertex } from './roofSolidGeometry.ts'
import { getBaySupportPolygon } from './bayRoof.ts'
import { getExplicitRoofSupportLocalBounds, getRoofSupportLocalPoint, getWallSideAwayFromRoof } from './roofBuildingGeometry.ts'
import { getCanonicalWallUvDistance } from './wallEngine/wallUv.ts'
import { resolvedRoofWallSegments } from './roofJunctions.ts'
import { getRoofThickness } from './roofThickness.ts'
import { carveRoofSurfaceByRooms, type RoomRoofCut } from './roofRoomCsg.ts'

export const ROOF_INFILL_WALL_OVERLAP_METERS = 0.002
// Roof support dimensions are saved to fewer decimal places than wall corners.
// Cover that rounding at clipped ends; the adjoining wall/room volume owns the
// boundary. This overlap runs along the facade, never out of its plane.
const INFILL_END_OVERLAP_METERS = .00001

/** Facade infill meets the outside of the floor assembly. Expanding its slab
 * cutter removes a visible sliver beyond the adjoining facade's edge. */
export function carveRoofInfillByRooms(geometry: BufferGeometry, cuts: RoomRoofCut[], floorId: string, bottomY: number) {
  return carveRoofSurfaceByRooms(geometry, cuts.filter(cut => cut.floorId !== floorId &&
    cut.bottomY >= bottomY - .02).map(cut => ({
    ...cut,
    ...(cut.floorAssembly ? { footprintOverlap: -INFILL_END_OVERLAP_METERS } : {}),
    bottomY: Math.min(cut.bottomY, bottomY - ROOF_INFILL_WALL_OVERLAP_METERS - .01),
  })))
}

export function getRoofInfillWallRole(
  roof: RoofStructure,
  wall: Wall,
): 'cross' | 'gable' | null {
  if (roof.type === 'hip') {
    return null
  }

  const bounds = getExplicitRoofSupportLocalBounds(roof)
  const supportStart = getRoofSupportLocalPoint(roof, wall.start)
  const supportEnd = getRoofSupportLocalPoint(roof, wall.end)
  if (roof.type === 'bay') {
    const rear = getBaySupportPolygon(roof)[0].y
    return Math.abs(supportStart.y - rear) < wall.thickness && Math.abs(supportEnd.y - rear) < wall.thickness ? 'gable' : null
  }
  const tolerance = Math.max(0.1, wall.thickness + 0.02)
  const direction = {
    x: supportEnd.x - supportStart.x,
    y: supportEnd.y - supportStart.y,
  }
  const runsAlongRoofWidth = Math.abs(direction.x) >= Math.abs(direction.y)
  const onFrontOrBackSupport =
    (Math.abs(supportStart.y - bounds.minY) <= tolerance &&
      Math.abs(supportEnd.y - bounds.minY) <= tolerance) ||
    (Math.abs(supportStart.y - bounds.maxY) <= tolerance &&
      Math.abs(supportEnd.y - bounds.maxY) <= tolerance)
  const wallMinY = Math.min(supportStart.y, supportEnd.y)
  const wallMaxY = Math.max(supportStart.y, supportEnd.y)
  const wallCenterY = (supportStart.y + supportEnd.y) / 2
  const overlapsSupportDepth =
    wallMaxY >= bounds.minY - tolerance &&
    wallMinY <= bounds.maxY + tolerance
  const crossesInsideLeanTo =
    roof.type === 'lean-to' &&
    runsAlongRoofWidth &&
    overlapsSupportDepth &&
    wallCenterY > bounds.minY + tolerance &&
    wallCenterY < bounds.maxY - tolerance

  if (roof.type === 'up-and-over') {
    return runsAlongRoofWidth && onFrontOrBackSupport ? 'gable' : null
  }

  if (runsAlongRoofWidth && onFrontOrBackSupport) {
    return 'gable'
  }

  if (crossesInsideLeanTo) {
    return 'cross'
  }

  return null
}

export function createRoofInfillGeometry({
  bottomY,
  infillFaces,
  renderedWall,
  roof,
  exteriorSide,
}: {
  bottomY: number
  infillFaces: RoofVertex[][]
  renderedWall: RenderedWall
  roof: RoofStructure
  exteriorSide: -1 | 1
}) {
  const { wall } = renderedWall

  if (wall.kind !== 'external') {
    return null
  }

  const infillRole = getRoofInfillWallRole(roof, wall)

  if (!infillRole) {
    return null
  }

  const wallLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)

  if (wallLength <= 0.000001) {
    return null
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / wallLength,
    y: (wall.end.y - wall.start.y) / wallLength,
  }
  const infillFaceSide = infillRole === 'gable'
    ? getWallSideAwayFromRoof(roof, wall)
    : exteriorSide
  const normal = {
    x: -unit.y * infillFaceSide,
    y: unit.x * infillFaceSide,
  }
  // This skin continues the supporting facade. Pushing it outward leaves an
  // open vertical slit where it meets the upper storey's coplanar wall.
  const faceOffset = wall.thickness / 2
  const expectedNormal = new Vector3(normal.x, 0, normal.y).normalize()
  const positions: number[] = []
  const uvs: number[] = []
  const infillBottomY = bottomY
  const visibleStart = {
    x: wall.start.x - unit.x * renderedWall.startExtension,
    y: wall.start.y - unit.y * renderedWall.startExtension,
  }
  const visibleEnd = {
    x: wall.end.x + unit.x * renderedWall.endExtension,
    y: wall.end.y + unit.y * renderedWall.endExtension,
  }
  const supportBounds = getExplicitRoofSupportLocalBounds(roof)
  const centerlineLocalStart = getRoofSupportLocalPoint(roof, wall.start)
  const centerlineLocalEnd = getRoofSupportLocalPoint(roof, wall.end)
  const visibleLocalStart = getRoofSupportLocalPoint(roof, visibleStart)
  const visibleLocalEnd = getRoofSupportLocalPoint(roof, visibleEnd)
  const unclippedWallMinX = Math.min(visibleLocalStart.x, visibleLocalEnd.x)
  const unclippedWallMaxX = Math.max(visibleLocalStart.x, visibleLocalEnd.x)
  const centerlineWallMinX = Math.min(centerlineLocalStart.x, centerlineLocalEnd.x)
  const centerlineWallMaxX = Math.max(centerlineLocalStart.x, centerlineLocalEnd.x)
  const supportTouchesStartCorner =
    Math.abs(supportBounds.minX - centerlineWallMinX) <= 0.03
  const supportTouchesEndCorner =
    Math.abs(supportBounds.maxX - centerlineWallMaxX) <= 0.03
  const wallLocalStart =
    infillRole === 'gable' || infillRole === 'cross'
      ? {
          x: supportTouchesStartCorner
            ? unclippedWallMinX
            : Math.max(unclippedWallMinX, supportBounds.minX - INFILL_END_OVERLAP_METERS),
          y: (visibleLocalStart.y + visibleLocalEnd.y) / 2,
        }
      : visibleLocalStart
  const wallLocalEnd =
    infillRole === 'gable' || infillRole === 'cross'
      ? {
          x: supportTouchesEndCorner
            ? unclippedWallMaxX
            : Math.min(unclippedWallMaxX, supportBounds.maxX + INFILL_END_OVERLAP_METERS),
          y: (visibleLocalStart.y + visibleLocalEnd.y) / 2,
        }
      : visibleLocalEnd
  const addTriangle = (
    first: [number, number, number],
    second: [number, number, number],
    third: [number, number, number],
    firstUv: [number, number],
    secondUv: [number, number],
    thirdUv: [number, number],
  ) => {
    const actualNormal = new Vector3()
      .subVectors(new Vector3(...second), new Vector3(...first))
      .cross(new Vector3(...third).sub(new Vector3(...first)))
      .normalize()
    const ordered =
      actualNormal.dot(expectedNormal) < 0
        ? [first, third, second]
        : [first, second, third]
    const orderedUvs =
      actualNormal.dot(expectedNormal) < 0
        ? [firstUv, thirdUv, secondUv]
        : [firstUv, secondUv, thirdUv]

    ordered.forEach((position) => positions.push(...position))
    orderedUvs.forEach((uv) => uvs.push(...uv))
  }
  const getFacePoint = (point: Point): [number, number, number] => [
    point.x + normal.x * faceOffset,
    infillBottomY,
    point.y + normal.y * faceOffset,
  ]
  const getWallPointAtRoofLocalX = (localX: number) => {
    const startLocalX = visibleLocalStart.x
    const endLocalX = visibleLocalEnd.x
    const denominator = endLocalX - startLocalX
    const t =
      Math.abs(denominator) <= 0.000001
        ? 0
        : Math.min(1, Math.max(0, (localX - startLocalX) / denominator))

    return {
      x: visibleStart.x + (visibleEnd.x - visibleStart.x) * t,
      y: visibleStart.y + (visibleEnd.y - visibleStart.y) * t,
    }
  }
  const getContinuationUv = (
    point: Point,
    y: number,
  ): [number, number] => [
    getCanonicalWallUvDistance(wall, point),
    y,
  ]
  const bottomStartPlan =
    infillRole === 'gable' || infillRole === 'cross'
      ? getWallPointAtRoofLocalX(wallLocalStart.x)
      : visibleStart
  const bottomEndPlan =
    infillRole === 'gable' || infillRole === 'cross'
      ? getWallPointAtRoofLocalX(wallLocalEnd.x)
      : visibleEnd
  const segments = resolvedRoofWallSegments(infillFaces, bottomStartPlan, bottomEndPlan,
    infillBottomY, getRoofThickness(roof), INFILL_END_OVERLAP_METERS).map((segment) => segment.map((sample) => {
    const facePoint = getFacePoint(sample.planPoint)

    return {
      bottom: facePoint,
      planPoint: sample.planPoint,
      top: [
        facePoint[0],
        sample.topY,
        facePoint[2],
      ] as [number, number, number],
    }
  }))

  segments.forEach(([start, end]) => {
    const startTopY = Math.max(infillBottomY, start.top[1])
    const endTopY = Math.max(infillBottomY, end.top[1])

    if (Math.max(startTopY, endTopY) <= infillBottomY + 0.001) {
      return
    }

    const startTop: [number, number, number] = [
      start.top[0],
      startTopY,
      start.top[2],
    ]
    const endTop: [number, number, number] = [
      end.top[0],
      endTopY,
      end.top[2],
    ]

    addTriangle(
      start.bottom,
      end.bottom,
      endTop,
      getContinuationUv(start.planPoint, infillBottomY),
      getContinuationUv(end.planPoint, infillBottomY),
      getContinuationUv(end.planPoint, endTopY),
    )
    addTriangle(
      start.bottom,
      endTop,
      startTop,
      getContinuationUv(start.planPoint, infillBottomY),
      getContinuationUv(end.planPoint, endTopY),
      getContinuationUv(start.planPoint, startTopY),
    )
  })

  if (positions.length === 0) {
    return null
  }

  const faceNormal = expectedNormal.normalize()
  const normals = Array.from({ length: positions.length / 3 }, () => [
    faceNormal.x,
    faceNormal.y,
    faceNormal.z,
  ]).flat()
  const geometry = new BufferGeometry()

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingSphere()

  return geometry
}

