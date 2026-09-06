import { ShapeUtils, Vector2 } from 'three'
import type { Point, Wall } from '../types.ts'
import {
  buildWallBodyPerimeters,
  subtractWallBodyPerimeters,
  type WallBodyPerimeter,
  type WallBodyRing,
} from './wallBodyPerimeter.ts'
import {
  buildWallGeometryPlans,
  type WallEndpointJoinKind,
  type WallEndpointPlan,
  type WallEndpointSidePlan,
  type WallFaceInterval,
  type WallGeometryPlan,
} from './wallPlan.ts'
import type { WallEndpointKey, WallGraphOptions, WallSide } from './wallGraph.ts'
import { getCanonicalWallUvDistance } from './wallUv.ts'

export type WallMeshVertex = {
  position: [number, number, number]
  uv: [number, number]
}

export type WallMeshFaceKind = 'bottom' | 'cap' | 'side' | 'top'

export type WallMeshSource = {
  fragmentId?: string
  role?: 'cap' | 'room-surface'
  side?: WallSide
  wallId: string
}

export type WallMeshFace = {
  endpoint?: 'end' | 'start'
  faceId: string
  kind: WallMeshFaceKind
  materialSource: WallMeshSource
  normal: [number, number, number]
  pickSource: WallMeshSource
  uvSource: WallMeshSource
  vertices: [WallMeshVertex, WallMeshVertex, WallMeshVertex, WallMeshVertex]
  wallId: string
}

export type WallMeshBuildOptions = WallGraphOptions & {
  chamferThreshold?: number
  exteriorWallSidesByWallId?: ReadonlyMap<string, WallSide>
  wallOpeningDepthsByModelId?: ReadonlyMap<string, number>
  omitEndpointJoinSideFacesForWallIds?: ReadonlySet<string>
  omitSideAttachmentCapsForRenderedTargetWallIds?: ReadonlySet<string>
  omitSideAttachmentCapsForTargetWallIds?: ReadonlySet<string>
}

export type WallBodyPerimeterMeshBuildOptions = WallMeshBuildOptions

type WallOpeningRect = {
  bottom: number
  id: string
  left: number
  modelId: string
  right: number
  top: number
}

type WallOpeningBoundarySegment =
  | {
      bottom: number
      edge: 'left' | 'right'
      id: string
      openingId?: string
      top: number
      x: number
    }
  | {
      edge: 'bottom' | 'top'
      id: string
      left: number
      openingId?: string
      right: number
      y: number
    }

type EndpointJoinContext = {
  endpointPlan: Extract<WallEndpointPlan, { type: 'endpoint-join' }>
  plan: WallGeometryPlan
}

const EXTERIOR_OPENING_REVEAL_INSET_METERS = 0.02

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function dot(first: Point, second: Point) {
  return first.x * second.x + first.y * second.y
}

function wallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallDirection(wall: Wall) {
  const length = wallLength(wall)

  return length > 0
    ? {
        x: (wall.end.x - wall.start.x) / length,
        y: (wall.end.y - wall.start.y) / length,
      }
    : { x: 1, y: 0 }
}

function getWallNormal(wall: Wall) {
  const direction = getWallDirection(wall)

  return {
    x: -direction.y,
    y: direction.x,
  }
}

function getWallSidePointAtDistance(
  wall: Wall,
  distanceAlongWall: number,
  side: WallSide,
) {
  const direction = getWallDirection(wall)
  const normal = getWallNormal(wall)

  return {
    x:
      wall.start.x +
      direction.x * distanceAlongWall +
      normal.x * wall.thickness * side / 2,
    y:
      wall.start.y +
      direction.y * distanceAlongWall +
      normal.y * wall.thickness * side / 2,
  }
}

function getEndpointBodySidePoint(
  wall: Wall,
  plan: WallEndpointPlan,
  side: WallSide,
) {
  if (plan.type === 'side-attachment') {
    const sidePoint = plan.sidePoints.find(
      (candidatePoint) => candidatePoint.side === side,
    )?.point

    if (sidePoint) {
      return sidePoint
    }

    const distanceAlongWall =
      plan.endpoint === 'start'
        ? plan.trimDistance
        : wallLength(wall) - plan.trimDistance

    return getWallSidePointAtDistance(wall, distanceAlongWall, side)
  }

  return getWallSidePointAtDistance(
    wall,
    plan.endpoint === 'start' ? 0 : wallLength(wall),
    side,
  )
}

function getEndpointJoinSidePoint(
  wall: Wall,
  plan: WallEndpointPlan,
  side: WallSide,
) {
  if (plan.type !== 'endpoint-join') {
    return getEndpointBodySidePoint(wall, plan, side)
  }

  return (
    plan.sidePlans.find((sidePlan) => sidePlan.side === side)?.point ??
    getEndpointBodySidePoint(wall, plan, side)
  )
}

function getEndpointJoinSidePlan(
  plan: WallEndpointPlan,
  side: WallSide,
): WallEndpointSidePlan | null {
  return plan.type === 'endpoint-join'
    ? plan.sidePlans.find((sidePlan) => sidePlan.side === side) ?? null
    : null
}

function interpolatePoint(start: Point, end: Point, t: number) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

function getPlanStartDistance(plan: WallGeometryPlan) {
  return plan.start.type === 'side-attachment' ? plan.start.trimDistance : 0
}

function getPlanEndDistance(plan: WallGeometryPlan) {
  return plan.length - (plan.end.type === 'side-attachment' ? plan.end.trimDistance : 0)
}

function getPlanDistanceT(plan: WallGeometryPlan, distanceAlongWall: number) {
  const startDistance = getPlanStartDistance(plan)
  const endDistance = Math.max(startDistance + 0.001, getPlanEndDistance(plan))

  return (distanceAlongWall - startDistance) / (endDistance - startDistance)
}

function toVertex(point: Point, y: number, uv: [number, number]): WallMeshVertex {
  return {
    position: [point.x, y, point.y],
    uv,
  }
}

function getSideNormal(wall: Wall, side: WallSide): [number, number, number] {
  const normal = getWallNormal(wall)

  return [normal.x * side, 0, normal.y * side]
}

function getEndpointNormal(
  wall: Wall,
  endpoint: 'end' | 'start',
): [number, number, number] {
  const direction = getWallDirection(wall)
  const sign = endpoint === 'start' ? -1 : 1

  return [direction.x * sign, 0, direction.y * sign]
}

function getVerticalFaceNormalFromEdge(
  firstPoint: Point,
  secondPoint: Point,
  preferredNormal: [number, number, number],
): [number, number, number] {
  const dx = secondPoint.x - firstPoint.x
  const dy = secondPoint.y - firstPoint.y
  const length = Math.hypot(dx, dy)

  if (length <= 0.000001) {
    return preferredNormal
  }

  const firstCandidate: [number, number, number] = [dy / length, 0, -dx / length]
  const secondCandidate: [number, number, number] = [-dy / length, 0, dx / length]
  const firstDot =
    firstCandidate[0] * preferredNormal[0] +
    firstCandidate[2] * preferredNormal[2]

  return firstDot >= 0 ? firstCandidate : secondCandidate
}

function getWallOpeningRects(wall: Wall) {
  const length = wallLength(wall)

  return (wall.openings ?? [])
    .map((opening) => {
      const left = Math.max(0, opening.center - opening.width / 2)
      const right = Math.min(length, opening.center + opening.width / 2)
      const bottom = Math.max(0, Math.min(wall.height, opening.bottom))
      const top = Math.max(
        bottom,
        Math.min(wall.height, opening.bottom + opening.height),
      )

      return right > left + 0.0001 && top > bottom + 0.0001
        ? {
            bottom,
            id: opening.id,
            left,
            modelId: opening.modelId,
            right,
            top,
          }
        : null
    })
    .filter(
      (
        opening,
      ): opening is WallOpeningRect => Boolean(opening),
    )
}

function getUniqueSortedBreaks(values: number[]) {
  const sortedValues = [...values].sort((first, second) => first - second)

  return sortedValues.filter(
    (value, index) =>
      index === 0 || Math.abs(value - sortedValues[index - 1]) > 0.0001,
  )
}

function openingRectsContainPoint(
  openings: WallOpeningRect[],
  x: number,
  y: number,
) {
  return openings.some(
    (opening) =>
      x > opening.left + 0.0001 &&
      x < opening.right - 0.0001 &&
      y > opening.bottom + 0.0001 &&
      y < opening.top - 0.0001,
  )
}

function getBoundarySegmentOpeningId(
  openings: WallOpeningRect[],
  edge: 'bottom' | 'left' | 'right' | 'top',
  primary: number,
  rangeStart: number,
  rangeEnd: number,
) {
  const matches = openings.filter((opening) => {
    if (edge === 'left') {
      return (
        Math.abs(opening.left - primary) <= 0.0001 &&
        rangeStart >= opening.bottom - 0.0001 &&
        rangeEnd <= opening.top + 0.0001
      )
    }

    if (edge === 'right') {
      return (
        Math.abs(opening.right - primary) <= 0.0001 &&
        rangeStart >= opening.bottom - 0.0001 &&
        rangeEnd <= opening.top + 0.0001
      )
    }

    if (edge === 'bottom') {
      return (
        Math.abs(opening.bottom - primary) <= 0.0001 &&
        rangeStart >= opening.left - 0.0001 &&
        rangeEnd <= opening.right + 0.0001
      )
    }

    return (
      Math.abs(opening.top - primary) <= 0.0001 &&
      rangeStart >= opening.left - 0.0001 &&
      rangeEnd <= opening.right + 0.0001
    )
  })

  return matches.length === 1 ? matches[0].id : undefined
}

function getMergedOpeningBoundarySegments(
  openings: WallOpeningRect[],
  wallHeight: number,
): WallOpeningBoundarySegment[] {
  const xBreaks = getUniqueSortedBreaks(
    openings.flatMap((opening) => [opening.left, opening.right]),
  )
  const yBreaks = getUniqueSortedBreaks(
    openings.flatMap((opening) => [opening.bottom, opening.top]),
  )
  const segments: WallOpeningBoundarySegment[] = []

  xBreaks.slice(0, -1).forEach((left, xIndex) => {
    const right = xBreaks[xIndex + 1]

    if (right <= left + 0.0001) {
      return
    }

    yBreaks.slice(0, -1).forEach((bottom, yIndex) => {
      const top = yBreaks[yIndex + 1]

      if (top <= bottom + 0.0001) {
        return
      }

      const centerX = (left + right) / 2
      const centerY = (bottom + top) / 2

      if (!openingRectsContainPoint(openings, centerX, centerY)) {
        return
      }

      if (!openingRectsContainPoint(openings, left - 0.0002, centerY)) {
        segments.push({
          bottom,
          edge: 'left',
          id: `left:${left}:${bottom}:${top}`,
          openingId: getBoundarySegmentOpeningId(
            openings,
            'left',
            left,
            bottom,
            top,
          ),
          top,
          x: left,
        })
      }

      if (!openingRectsContainPoint(openings, right + 0.0002, centerY)) {
        segments.push({
          bottom,
          edge: 'right',
          id: `right:${right}:${bottom}:${top}`,
          openingId: getBoundarySegmentOpeningId(
            openings,
            'right',
            right,
            bottom,
            top,
          ),
          top,
          x: right,
        })
      }

      if (
        bottom > 0.0001 &&
        !openingRectsContainPoint(openings, centerX, bottom - 0.0002)
      ) {
        segments.push({
          edge: 'bottom',
          id: `bottom:${left}:${right}:${bottom}`,
          left,
          openingId: getBoundarySegmentOpeningId(
            openings,
            'bottom',
            bottom,
            left,
            right,
          ),
          right,
          y: bottom,
        })
      }

      if (
        top < wallHeight - 0.0001 &&
        !openingRectsContainPoint(openings, centerX, top + 0.0002)
      ) {
        segments.push({
          edge: 'top',
          id: `top:${left}:${right}:${top}`,
          left,
          openingId: getBoundarySegmentOpeningId(
            openings,
            'top',
            top,
            left,
            right,
          ),
          right,
          y: top,
        })
      }
    })
  })

  return segments
}

function addSideFaceQuad({
  faces,
  endDistance,
  endPoint,
  faceId,
  side,
  source,
  startDistance,
  startPoint,
  wall,
  yBottom,
  yTop,
}: {
  faces: WallMeshFace[]
  endDistance: number
  endPoint: Point
  faceId: string
  side: WallSide
  source: WallMeshSource
  startDistance: number
  startPoint: Point
  wall: Wall
  yBottom: number
  yTop: number
}) {
  faces.push({
    faceId,
    kind: 'side',
    materialSource: source,
    normal: getSideNormal(wall, side),
    pickSource: source,
    uvSource: source,
    vertices: [
      toVertex(startPoint, yBottom, [startDistance, yBottom]),
      toVertex(endPoint, yBottom, [endDistance, yBottom]),
      toVertex(endPoint, yTop, [endDistance, yTop]),
      toVertex(startPoint, yTop, [startDistance, yTop]),
    ],
    wallId: wall.id,
  })
}

function addSideFaces({
  faces,
  interval,
  plan,
  side,
  sideEnd,
  sideStart,
  wall,
}: {
  faces: WallMeshFace[]
  interval: WallFaceInterval
  plan: WallGeometryPlan
  side: WallSide
  sideEnd: Point
  sideStart: Point
  wall: Wall
}) {
  const source = { side, wallId: wall.id }
  const openings = getWallOpeningRects(wall).filter(
    (opening) =>
      opening.left < interval.end - 0.0001 &&
      opening.right > interval.start + 0.0001,
  )

  if (openings.length === 0) {
    const startT = getPlanDistanceT(plan, interval.start)
    const endT = getPlanDistanceT(plan, interval.end)

    addSideFaceQuad({
      endDistance: interval.end,
      endPoint: interpolatePoint(sideStart, sideEnd, endT),
      faceId: `${wall.id}:side:${side}:${interval.start}:${interval.end}`,
      faces,
      side,
      source,
      startDistance: interval.start,
      startPoint: interpolatePoint(sideStart, sideEnd, startT),
      wall,
      yBottom: 0,
      yTop: wall.height,
    })
    return
  }

  const xBreaks = [
    interval.start,
    interval.end,
    ...openings.flatMap((opening) => [
      Math.max(interval.start, opening.left),
      Math.min(interval.end, opening.right),
    ]),
  ]
    .filter((value) => value >= interval.start - 0.0001 && value <= interval.end + 0.0001)
    .sort((first, second) => first - second)
  const yBreaks = [
    0,
    wall.height,
    ...openings.flatMap((opening) => [opening.bottom, opening.top]),
  ]
    .filter((value) => value >= -0.0001 && value <= wall.height + 0.0001)
    .sort((first, second) => first - second)
  const uniqueXBreaks = xBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - xBreaks[index - 1]) > 0.0001,
  )
  const uniqueYBreaks = yBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - yBreaks[index - 1]) > 0.0001,
  )

  uniqueXBreaks.slice(0, -1).forEach((startDistance, xIndex) => {
    const endDistance = uniqueXBreaks[xIndex + 1]

    if (endDistance <= startDistance + 0.0001) {
      return
    }

    const midpointDistance = (startDistance + endDistance) / 2
    const startT = getPlanDistanceT(plan, startDistance)
    const endT = getPlanDistanceT(plan, endDistance)
    const startPoint = interpolatePoint(sideStart, sideEnd, startT)
    const endPoint = interpolatePoint(sideStart, sideEnd, endT)

    uniqueYBreaks.slice(0, -1).forEach((yBottom, yIndex) => {
      const yTop = uniqueYBreaks[yIndex + 1]

      if (yTop <= yBottom + 0.0001) {
        return
      }

      const midpointY = (yBottom + yTop) / 2
      const isInsideOpening = openings.some(
        (opening) =>
          midpointDistance > opening.left + 0.0001 &&
          midpointDistance < opening.right - 0.0001 &&
          midpointY > opening.bottom + 0.0001 &&
          midpointY < opening.top - 0.0001,
      )

      if (isInsideOpening) {
        return
      }

      addSideFaceQuad({
        endDistance,
        endPoint,
        faceId: `${wall.id}:side:${side}:${startDistance}:${endDistance}:${yBottom}:${yTop}`,
        faces,
        side,
        source,
        startDistance,
        startPoint,
        wall,
        yBottom,
        yTop,
      })
    })
  })
}

function addEndpointJoinSideFace({
  endpoint,
  faces,
  joinedSidePoint,
  joinKind,
  side,
  sidePoint,
  wall,
}: {
  endpoint: 'end' | 'start'
  faces: WallMeshFace[]
  joinedSidePoint: Point
  joinKind?: WallEndpointJoinKind
  side: WallSide
  sidePoint: Point
  wall: Wall
}) {
  const joinDistance = distance(sidePoint, joinedSidePoint)
  const length = wallLength(wall)

  if (
    joinKind !== 'converge' ||
    joinDistance <= 0.0001 ||
    length <= wall.thickness * 1.5
  ) {
    return
  }

  const source = { side, wallId: wall.id }
  const startUv = endpoint === 'start' ? -joinDistance : length
  const endUv = endpoint === 'start' ? 0 : length + joinDistance
  const firstPoint = endpoint === 'start' ? joinedSidePoint : sidePoint
  const secondPoint = endpoint === 'start' ? sidePoint : joinedSidePoint

  faces.push({
    endpoint,
    faceId: `${wall.id}:join-side:${endpoint}:${side}`,
    kind: 'side',
    materialSource: source,
    normal: getSideNormal(wall, side),
    pickSource: source,
    uvSource: source,
    vertices: [
      toVertex(firstPoint, 0, [startUv, 0]),
      toVertex(secondPoint, 0, [endUv, 0]),
      toVertex(secondPoint, wall.height, [endUv, wall.height]),
      toVertex(firstPoint, wall.height, [startUv, wall.height]),
    ],
    wallId: wall.id,
  })
}

function getEndpointJoinContexts(plans: WallGeometryPlan[]) {
  const contextsByJoinNodeId = new Map<string, EndpointJoinContext[]>()

  plans.forEach((plan) => {
    ;([plan.start, plan.end] as const).forEach((endpointPlan) => {
      if (endpointPlan.type !== 'endpoint-join') {
        return
      }

      const contexts = contextsByJoinNodeId.get(endpointPlan.joinNodeId) ?? []

      contexts.push({
        endpointPlan,
        plan,
      })
      contextsByJoinNodeId.set(endpointPlan.joinNodeId, contexts)
    })
  })

  return contextsByJoinNodeId
}

function wallDirectionsArePerpendicular(firstWall: Wall, secondWall: Wall) {
  const firstLength = wallLength(firstWall)
  const secondLength = wallLength(secondWall)

  if (firstLength <= 0.000001 || secondLength <= 0.000001) {
    return false
  }

  const firstDirection = {
    x: (firstWall.end.x - firstWall.start.x) / firstLength,
    y: (firstWall.end.y - firstWall.start.y) / firstLength,
  }
  const secondDirection = {
    x: (secondWall.end.x - secondWall.start.x) / secondLength,
    y: (secondWall.end.y - secondWall.start.y) / secondLength,
  }

  return Math.abs(
    firstDirection.x * secondDirection.x +
      firstDirection.y * secondDirection.y,
  ) <= 0.08
}

function shouldOmitEndpointJoinSideFace({
  endpointPlan,
  endpointSidePlan,
  joinContextsByNodeId,
  options,
  wall,
  wallsById,
}: {
  endpointPlan: WallEndpointPlan
  endpointSidePlan?: WallEndpointSidePlan | null
  joinContextsByNodeId: Map<string, EndpointJoinContext[]>
  options: WallMeshBuildOptions
  wall: Wall
  wallsById: Map<string, Wall>
}) {
  if (
    endpointPlan.type !== 'endpoint-join' ||
    endpointSidePlan?.type !== 'converge'
  ) {
    return false
  }

  if (options.omitEndpointJoinSideFacesForWallIds?.has(wall.id)) {
    return true
  }

  const joinContexts = joinContextsByNodeId.get(endpointPlan.joinNodeId) ?? []

  if (joinContexts.length !== 2) {
    return false
  }

  const otherContext = joinContexts.find(
    (context) => context.plan.wallId !== wall.id,
  )
  const otherWall = otherContext ? wallsById.get(otherContext.plan.wallId) : null

  return Boolean(otherWall && wallDirectionsArePerpendicular(wall, otherWall))
}

function addCapFace({
  endpoint,
  faces,
  negativeSidePoint,
  options,
  plan,
  positiveSidePoint,
  wall,
}: {
  endpoint: 'end' | 'start'
  faces: WallMeshFace[]
  negativeSidePoint: Point
  options: WallMeshBuildOptions
  plan: WallEndpointPlan
  positiveSidePoint: Point
  wall: Wall
}) {
  if (plan.type === 'endpoint-join') {
    return
  }

  if (
    plan.type === 'side-attachment' &&
    plan.capCoveredByRenderedTarget &&
    options.omitSideAttachmentCapsForTargetWallIds?.has(plan.targetWallId)
  ) {
    return
  }

  const fallbackSource = { wallId: wall.id }
  const inheritedSource =
    plan.type === 'side-attachment'
      ? plan.capMaterialSource
      : fallbackSource
  const uvSource =
    plan.type === 'side-attachment'
      ? plan.capUvSource
      : fallbackSource
  const capWidth = distance(positiveSidePoint, negativeSidePoint)
  const endpointNormal = getEndpointNormal(wall, endpoint)
  const normal =
    plan.type === 'side-attachment'
      ? getVerticalFaceNormalFromEdge(
          negativeSidePoint,
          positiveSidePoint,
          endpointNormal,
        )
      : endpointNormal

  if (plan.type !== 'side-attachment') {
    const centerPoint = {
      x: (negativeSidePoint.x + positiveSidePoint.x) / 2,
      y: (negativeSidePoint.y + positiveSidePoint.y) / 2,
    }

    ;([
      {
        firstPoint: negativeSidePoint,
        secondPoint: centerPoint,
        side: -1,
        uvEnd: capWidth / 2,
        uvStart: 0,
      },
      {
        firstPoint: centerPoint,
        secondPoint: positiveSidePoint,
        side: 1,
        uvEnd: capWidth,
        uvStart: capWidth / 2,
      },
    ] as const).forEach((capPart) => {
      const materialSource = {
        role: 'cap' as const,
        side: capPart.side,
        wallId: wall.id,
      }
      const sideSource = { side: capPart.side, wallId: wall.id }

      faces.push({
        endpoint,
        faceId: `${wall.id}:cap:${endpoint}:${capPart.side}`,
        kind: 'cap',
        materialSource,
        normal,
        pickSource: sideSource,
        uvSource: sideSource,
        vertices: [
          toVertex(capPart.firstPoint, 0, [capPart.uvStart, 0]),
          toVertex(capPart.secondPoint, 0, [capPart.uvEnd, 0]),
          toVertex(capPart.secondPoint, wall.height, [capPart.uvEnd, wall.height]),
          toVertex(capPart.firstPoint, wall.height, [capPart.uvStart, wall.height]),
        ],
        wallId: wall.id,
      })
    })
    return
  }

  faces.push({
    endpoint,
    faceId: `${wall.id}:cap:${endpoint}`,
    kind: 'cap',
    materialSource: inheritedSource,
    normal,
    pickSource: { wallId: wall.id },
    uvSource,
    vertices: [
      toVertex(negativeSidePoint, 0, [0, 0]),
      toVertex(positiveSidePoint, 0, [capWidth, 0]),
      toVertex(positiveSidePoint, wall.height, [capWidth, wall.height]),
      toVertex(negativeSidePoint, wall.height, [0, wall.height]),
    ],
    wallId: wall.id,
  })
}

function addHorizontalFace({
  faces,
  faceId,
  kind,
  negativeEnd,
  negativeStart,
  plan,
  positiveEnd,
  positiveStart,
  wall,
}: {
  faceId: string
  faces: WallMeshFace[]
  kind: 'bottom' | 'top'
  negativeEnd: Point
  negativeStart: Point
  plan: WallGeometryPlan
  positiveEnd: Point
  positiveStart: Point
  wall: Wall
}) {
  const y = kind === 'top' ? wall.height : 0
  const normal: [number, number, number] = kind === 'top' ? [0, 1, 0] : [0, -1, 0]
  const source = { wallId: wall.id }

  faces.push({
    faceId,
    kind,
    materialSource: source,
    normal,
    pickSource: source,
    uvSource: source,
    vertices: [
      toVertex(positiveStart, y, [0, wall.thickness]),
      toVertex(positiveEnd, y, [plan.length, wall.thickness]),
      toVertex(negativeEnd, y, [plan.length, 0]),
      toVertex(negativeStart, y, [0, 0]),
    ],
    wallId: wall.id,
  })
}

function subtractIntervals(
  interval: WallFaceInterval,
  cutIntervals: WallFaceInterval[],
) {
  return cutIntervals
    .sort((first, second) => first.start - second.start)
    .reduce<WallFaceInterval[]>((remainingIntervals, cutInterval) => {
      return remainingIntervals.flatMap((remainingInterval) => {
        const cutStart = Math.max(remainingInterval.start, cutInterval.start)
        const cutEnd = Math.min(remainingInterval.end, cutInterval.end)

        if (cutEnd <= cutStart + 0.0001) {
          return [remainingInterval]
        }

        return [
          {
            end: cutStart,
            start: remainingInterval.start,
          },
          {
            end: remainingInterval.end,
            start: cutEnd,
          },
        ].filter(
          (candidateInterval) =>
            candidateInterval.end > candidateInterval.start + 0.0001,
        )
      })
    }, [interval])
}

function addHorizontalFaces({
  faces,
  kind,
  negativeEnd,
  negativeStart,
  plan,
  positiveEnd,
  positiveStart,
  wall,
}: {
  faces: WallMeshFace[]
  kind: 'bottom' | 'top'
  negativeEnd: Point
  negativeStart: Point
  plan: WallGeometryPlan
  positiveEnd: Point
  positiveStart: Point
  wall: Wall
}) {
  const startDistance = getPlanStartDistance(plan)
  const endDistance = getPlanEndDistance(plan)
  const intervals =
    kind === 'bottom'
      ? subtractIntervals(
          { end: endDistance, start: startDistance },
          getWallOpeningRects(wall)
            .filter((opening) => opening.bottom <= 0.0001)
            .map((opening) => ({
              end: Math.min(endDistance, opening.right),
              start: Math.max(startDistance, opening.left),
            })),
        )
      : [{ end: endDistance, start: startDistance }]

  intervals.forEach((interval, index) => {
    const startT = getPlanDistanceT(plan, interval.start)
    const endT = getPlanDistanceT(plan, interval.end)

    addHorizontalFace({
      faceId:
        intervals.length === 1
          ? `${wall.id}:${kind}`
          : `${wall.id}:${kind}:${interval.start}:${interval.end}:${index}`,
      faces,
      kind,
      negativeEnd: interpolatePoint(negativeStart, negativeEnd, endT),
      negativeStart: interpolatePoint(negativeStart, negativeEnd, startT),
      plan: {
        ...plan,
        length: interval.end - interval.start,
      },
      positiveEnd: interpolatePoint(positiveStart, positiveEnd, endT),
      positiveStart: interpolatePoint(positiveStart, positiveEnd, startT),
      wall,
    })
  })
}

function addOpeningRevealFaces({
  faces,
  options,
  wall,
}: {
  faces: WallMeshFace[]
  options: WallMeshBuildOptions
  wall: Wall
}) {
  const addRevealFace = ({
    faceId,
    firstPoint,
    normal,
    secondPoint,
    side,
    uvWidth,
    yBottom,
    yTop,
  }: {
    faceId: string
    firstPoint: Point
    normal: [number, number, number]
    secondPoint: Point
    side: WallSide
    uvWidth: number
    yBottom: number
    yTop: number
  }) => {
    const materialSource = { role: 'cap' as const, side, wallId: wall.id }
    const sideSource = { side, wallId: wall.id }

    faces.push({
      faceId,
      kind: 'cap',
      materialSource,
      normal,
      pickSource: sideSource,
      uvSource: sideSource,
      vertices: [
        toVertex(firstPoint, yBottom, [0, yBottom]),
        toVertex(secondPoint, yBottom, [uvWidth, yBottom]),
        toVertex(secondPoint, yTop, [uvWidth, yTop]),
        toVertex(firstPoint, yTop, [0, yTop]),
      ],
      wallId: wall.id,
    })
  }

  const halfThickness = wall.thickness / 2
  const exteriorSide =
    wall.kind === 'external'
      ? options.exteriorWallSidesByWallId?.get(wall.id)
      : undefined
  const openingRectangles = getWallOpeningRects(wall)
  const getRevealSplitOffset = (openingId?: string) => {
    if (!exteriorSide || !openingId) {
      return 0
    }

    const opening = openingRectangles.find(
      (candidateOpening) => candidateOpening.id === openingId,
    )
    const openingDepth = opening
      ? options.wallOpeningDepthsByModelId?.get(opening.modelId)
      : undefined

    if (typeof openingDepth !== 'number' || !Number.isFinite(openingDepth)) {
      return 0
    }

    return Math.max(
      -halfThickness,
      Math.min(
        halfThickness,
        exteriorSide *
          (halfThickness -
            EXTERIOR_OPENING_REVEAL_INSET_METERS -
            openingDepth / 2),
      ),
    )
  }
  const revealSegments = getMergedOpeningBoundarySegments(
    openingRectangles,
    wall.height,
  )

  revealSegments.forEach((segment) => {
    const faceIdPrefix = segment.openingId
      ? `${wall.id}:opening:${segment.openingId}:${segment.edge}`
      : `${wall.id}:opening-boundary:${segment.id}`
    const splitOffset = getRevealSplitOffset(segment.openingId)
    const splitSide = splitOffset * 2 / wall.thickness as WallSide

    if (segment.edge === 'left' || segment.edge === 'right') {
      const pointNegative = getWallSidePointAtDistance(wall, segment.x, -1)
      const pointSplit = getWallSidePointAtDistance(wall, segment.x, splitSide)
      const pointPositive = getWallSidePointAtDistance(wall, segment.x, 1)
      const normal =
        segment.edge === 'left'
          ? getEndpointNormal(wall, 'start')
          : getEndpointNormal(wall, 'end')

      addRevealFace({
        faceId: `${faceIdPrefix}:-1`,
        firstPoint:
          segment.edge === 'left' ? pointNegative : pointSplit,
        normal,
        secondPoint:
          segment.edge === 'left' ? pointSplit : pointNegative,
        side: -1,
        uvWidth: splitOffset + halfThickness,
        yBottom: segment.bottom,
        yTop: segment.top,
      })
      addRevealFace({
        faceId: `${faceIdPrefix}:1`,
        firstPoint:
          segment.edge === 'left' ? pointSplit : pointPositive,
        normal,
        secondPoint:
          segment.edge === 'left' ? pointPositive : pointSplit,
        side: 1,
        uvWidth: halfThickness - splitOffset,
        yBottom: segment.bottom,
        yTop: segment.top,
      })
      return
    }

    if (segment.edge === 'top') {
      const leftNegative = getWallSidePointAtDistance(wall, segment.left, -1)
      const leftSplit = getWallSidePointAtDistance(wall, segment.left, splitSide)
      const leftPositive = getWallSidePointAtDistance(wall, segment.left, 1)
      const rightNegative = getWallSidePointAtDistance(wall, segment.right, -1)
      const rightSplit = getWallSidePointAtDistance(wall, segment.right, splitSide)
      const rightPositive = getWallSidePointAtDistance(wall, segment.right, 1)
      const openingWidth = segment.right - segment.left
      const normal: [number, number, number] = [0, -1, 0]
      const negativeSource = { side: -1 as const, wallId: wall.id }
      const positiveSource = { side: 1 as const, wallId: wall.id }
      const negativeMaterialSource = { role: 'cap' as const, ...negativeSource }
      const positiveMaterialSource = { role: 'cap' as const, ...positiveSource }

      faces.push({
        faceId: `${faceIdPrefix}:1`,
        kind: 'cap',
        materialSource: positiveMaterialSource,
        normal,
        pickSource: positiveSource,
        uvSource: positiveSource,
        vertices: [
          toVertex(leftPositive, segment.y, [0, halfThickness - splitOffset]),
          toVertex(rightPositive, segment.y, [openingWidth, halfThickness - splitOffset]),
          toVertex(rightSplit, segment.y, [openingWidth, 0]),
          toVertex(leftSplit, segment.y, [0, 0]),
        ],
        wallId: wall.id,
      })
      faces.push({
        faceId: `${faceIdPrefix}:-1`,
        kind: 'cap',
        materialSource: negativeMaterialSource,
        normal,
        pickSource: negativeSource,
        uvSource: negativeSource,
        vertices: [
          toVertex(leftSplit, segment.y, [0, splitOffset + halfThickness]),
          toVertex(rightSplit, segment.y, [openingWidth, splitOffset + halfThickness]),
          toVertex(rightNegative, segment.y, [openingWidth, 0]),
          toVertex(leftNegative, segment.y, [0, 0]),
        ],
        wallId: wall.id,
      })
      return
    }

    if (segment.edge === 'bottom') {
      const leftNegative = getWallSidePointAtDistance(wall, segment.left, -1)
      const leftSplit = getWallSidePointAtDistance(wall, segment.left, splitSide)
      const leftPositive = getWallSidePointAtDistance(wall, segment.left, 1)
      const rightNegative = getWallSidePointAtDistance(wall, segment.right, -1)
      const rightSplit = getWallSidePointAtDistance(wall, segment.right, splitSide)
      const rightPositive = getWallSidePointAtDistance(wall, segment.right, 1)
      const openingWidth = segment.right - segment.left
      const normal: [number, number, number] = [0, 1, 0]
      const negativeSource = { side: -1 as const, wallId: wall.id }
      const positiveSource = { side: 1 as const, wallId: wall.id }
      const negativeMaterialSource = { role: 'cap' as const, ...negativeSource }
      const positiveMaterialSource = { role: 'cap' as const, ...positiveSource }

      faces.push({
        faceId: `${faceIdPrefix}:-1`,
        kind: 'cap',
        materialSource: negativeMaterialSource,
        normal,
        pickSource: negativeSource,
        uvSource: negativeSource,
        vertices: [
          toVertex(leftNegative, segment.y, [0, 0]),
          toVertex(rightNegative, segment.y, [openingWidth, 0]),
          toVertex(rightSplit, segment.y, [openingWidth, splitOffset + halfThickness]),
          toVertex(leftSplit, segment.y, [0, splitOffset + halfThickness]),
        ],
        wallId: wall.id,
      })
      faces.push({
        faceId: `${faceIdPrefix}:1`,
        kind: 'cap',
        materialSource: positiveMaterialSource,
        normal,
        pickSource: positiveSource,
        uvSource: positiveSource,
        vertices: [
          toVertex(leftSplit, segment.y, [0, 0]),
          toVertex(rightSplit, segment.y, [openingWidth, 0]),
          toVertex(rightPositive, segment.y, [openingWidth, halfThickness - splitOffset]),
          toVertex(leftPositive, segment.y, [0, halfThickness - splitOffset]),
        ],
        wallId: wall.id,
      })
    }
  })
}

function signedPolygonArea(points: Point[]) {
  return points.reduce((total, point, index) => {
    const nextPoint = points[(index + 1) % points.length]

    return total + point.x * nextPoint.y - nextPoint.x * point.y
  }, 0) / 2
}

function getEndpointPoint(wall: Wall, endpoint: WallEndpointKey) {
  return endpoint === 'start' ? wall.start : wall.end
}

function getClockwiseTriangleAsQuadVertices(
  points: [Point, Point, Point],
): [Point, Point, Point, Point] {
  return signedPolygonArea(points) > 0
    ? [points[0], points[2], points[1], points[0]]
    : [points[0], points[1], points[2], points[0]]
}

function addEndpointTopCaps({
  faces,
  plans,
  wallsById,
}: {
  faces: WallMeshFace[]
  plans: WallGeometryPlan[]
  wallsById: Map<string, Wall>
}) {
  const joinedEndpointPlans = plans.flatMap((plan) =>
    ([plan.start, plan.end] as const)
      .filter((endpointPlan) => endpointPlan.type === 'endpoint-join')
      .map((endpointPlan) => ({
        endpointPlan,
        plan,
      })),
  )
  const plansByJoinNode = new Map<
    string,
    {
      endpointPlan: Extract<WallEndpointPlan, { type: 'endpoint-join' }>
      plan: WallGeometryPlan
    }[]
  >()

  joinedEndpointPlans.forEach((entry) => {
    const entries = plansByJoinNode.get(entry.endpointPlan.joinNodeId) ?? []

    entries.push(entry)
    plansByJoinNode.set(entry.endpointPlan.joinNodeId, entries)
  })

  plansByJoinNode.forEach((entries, joinNodeId) => {
    if (entries.length < 3) {
      return
    }

    entries.forEach(({ endpointPlan, plan }) => {
      const wall = wallsById.get(plan.wallId)

      if (!wall || wallLength(wall) <= wall.thickness * 1.5) {
        return
      }

      endpointPlan.sidePlans
        .filter((sidePlan) => sidePlan.type === 'converge')
        .forEach((sidePlan) => {
          const endpointPoint = getEndpointPoint(wall, endpointPlan.endpoint)
          const bodyPoint = getEndpointBodySidePoint(
            wall,
            endpointPlan,
            sidePlan.side,
          )
          const capPoints = getClockwiseTriangleAsQuadVertices([
            endpointPoint,
            bodyPoint,
            sidePlan.point,
          ])
          const area = Math.abs(signedPolygonArea(capPoints))

          if (area <= 0.000001) {
            return
          }

          const y = wall.height
          const source = { wallId: wall.id }

          faces.push({
            faceId: `join-top:${joinNodeId}:${wall.id}:${endpointPlan.endpoint}:${sidePlan.side}`,
            kind: 'top',
            materialSource: source,
            normal: [0, 1, 0],
            pickSource: source,
            uvSource: source,
            vertices: [
              toVertex(capPoints[0], y, [0, 0]),
              toVertex(capPoints[1], y, [distance(capPoints[0], capPoints[1]), 0]),
              toVertex(capPoints[2], y, [
                distance(capPoints[0], capPoints[1]),
                distance(capPoints[1], capPoints[2]),
              ]),
              toVertex(capPoints[3], y, [0, 0]),
            ],
            wallId: wall.id,
          })
        })
    })
  })
}

function pointIsInsideRing(point: Point, ring: WallBodyRing) {
  if (ring.length < 3) {
    return false
  }

  let inside = false

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index++) {
    const current = ring[index]
    const previous = ring[previousIndex]
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (crosses) {
      inside = !inside
    }
  }

  return inside
}

function pointIsInsidePerimeterSolid(point: Point, perimeter: WallBodyPerimeter) {
  return (
    pointIsInsideRing(point, perimeter.outline) &&
    !perimeter.holes.some((hole) => pointIsInsideRing(point, hole))
  )
}

function getPerimeterEdgeOutwardNormal(
  start: Point,
  end: Point,
  perimeter: WallBodyPerimeter,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length <= 0.000001) {
    return { x: 0, y: 1 }
  }

  const firstCandidate = { x: dy / length, y: -dx / length }
  const secondCandidate = { x: -dy / length, y: dx / length }
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  const sampleDistance = 0.01
  const firstSample = {
    x: midpoint.x + firstCandidate.x * sampleDistance,
    y: midpoint.y + firstCandidate.y * sampleDistance,
  }

  return pointIsInsidePerimeterSolid(firstSample, perimeter)
    ? secondCandidate
    : firstCandidate
}

function getWallSideDistanceFromPoint(wall: Wall, side: WallSide, point: Point) {
  const length = wallLength(wall)

  if (length <= 0.000001) {
    return Number.POSITIVE_INFINITY
  }

  const sideStart = getWallSidePointAtDistance(wall, 0, side)
  const direction = getWallDirection(wall)
  const normal = getWallNormal(wall)
  const along =
    (point.x - sideStart.x) * direction.x +
    (point.y - sideStart.y) * direction.y
  const offset =
    (point.x - sideStart.x) * normal.x +
    (point.y - sideStart.y) * normal.y

  return along >= -0.04 && along <= length + 0.04
    ? Math.abs(offset)
    : Number.POSITIVE_INFINITY
}

function getDistanceAlongWall(wall: Wall, point: Point) {
  const length = wallLength(wall)

  if (length <= 0.000001) {
    return 0
  }

  const direction = getWallDirection(wall)

  return (point.x - wall.start.x) * direction.x + (point.y - wall.start.y) * direction.y
}

function getWallSideSourceForPerimeterEdge(
  start: Point,
  end: Point,
  walls: Wall[],
) {
  const edgeLength = distance(start, end)

  if (edgeLength <= 0.000001) {
    return null
  }

  const edgeDirection = {
    x: (end.x - start.x) / edgeLength,
    y: (end.y - start.y) / edgeLength,
  }
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  let bestDistance = Number.POSITIVE_INFINITY
  let bestSide: WallSide | null = null
  let bestWall: Wall | null = null

  for (const wall of walls) {
    const wallDirection = getWallDirection(wall)
    const parallel = Math.abs(dot(edgeDirection, wallDirection))

    if (parallel < 0.96) {
      continue
    }

    for (const side of [-1, 1] as const) {
      const sideDistance = getWallSideDistanceFromPoint(wall, side, midpoint)

      if (sideDistance > 0.06) {
        continue
      }

      if (
        sideDistance < bestDistance ||
        (Math.abs(sideDistance - bestDistance) <= 0.000001 &&
          (!bestWall || wall.thickness < bestWall.thickness))
      ) {
        bestDistance = sideDistance
        bestSide = side
        bestWall = wall
      }
    }
  }

  return bestWall && bestSide !== null
    ? { side: bestSide, wall: bestWall }
    : null
}

function addPerimeterVerticalFaceQuad({
  edgeDistanceEnd,
  edgeDistanceStart,
  end,
  faceId,
  faces,
  normal,
  source,
  start,
  wallId,
  yBottom,
  yTop,
}: {
  edgeDistanceEnd: number
  edgeDistanceStart: number
  end: Point
  faceId: string
  faces: WallMeshFace[]
  normal: Point
  source: WallMeshSource
  start: Point
  wallId: string
  yBottom: number
  yTop: number
}) {
  faces.push({
    faceId,
    kind: 'side',
    materialSource: source,
    normal: [normal.x, 0, normal.y],
    pickSource: source,
    uvSource: source,
    vertices: [
      toVertex(start, yBottom, [edgeDistanceStart, yBottom]),
      toVertex(end, yBottom, [edgeDistanceEnd, yBottom]),
      toVertex(end, yTop, [edgeDistanceEnd, yTop]),
      toVertex(start, yTop, [edgeDistanceStart, yTop]),
    ],
    wallId,
  })
}

function addPerimeterVerticalWallSideFaces({
  edgeIndex,
  edgeLength,
  end,
  faces,
  normal,
  ringIndex,
  ringKind,
  sourceWallId,
  start,
  wall,
  wallId,
  wallSide,
  yBottom,
  yTop,
}: {
  edgeIndex: number
  edgeLength: number
  end: Point
  faces: WallMeshFace[]
  normal: Point
  ringIndex: number
  ringKind: 'hole' | 'outline'
  sourceWallId: string
  start: Point
  wall: Wall
  wallId: string
  wallSide: WallSide
  yBottom: number
  yTop: number
}) {
  const source = {
    side: wallSide,
    wallId: wall.id,
  }
  const wallStartDistance = getDistanceAlongWall(wall, start)
  const wallEndDistance = getDistanceAlongWall(wall, end)
  const intervalStart = Math.min(wallStartDistance, wallEndDistance)
  const intervalEnd = Math.max(wallStartDistance, wallEndDistance)
  const openings = getWallOpeningRects(wall).filter(
    (opening) =>
      opening.left < intervalEnd - 0.0001 &&
      opening.right > intervalStart + 0.0001,
  )

  if (openings.length === 0) {
    addPerimeterVerticalFaceQuad({
      edgeDistanceEnd: getCanonicalWallUvDistance(wall, end),
      edgeDistanceStart: getCanonicalWallUvDistance(wall, start),
      end,
      faceId: `perimeter:${sourceWallId}:${ringKind}:${ringIndex}:side:${edgeIndex}`,
      faces,
      normal,
      source,
      start,
      wallId,
      yBottom,
      yTop,
    })
    return
  }

  const toEdgeDistance = (wallDistance: number) => {
    if (Math.abs(wallEndDistance - wallStartDistance) <= 0.000001) {
      return 0
    }

    return (
      ((wallDistance - wallStartDistance) /
        (wallEndDistance - wallStartDistance)) *
      edgeLength
    )
  }
  const xBreaks = [
    intervalStart,
    intervalEnd,
    ...openings.flatMap((opening) => [
      Math.max(intervalStart, opening.left),
      Math.min(intervalEnd, opening.right),
    ]),
  ]
    .filter((value) => value >= intervalStart - 0.0001 && value <= intervalEnd + 0.0001)
    .sort((first, second) => first - second)
  const yBreaks = [
    yBottom,
    yTop,
    ...openings.flatMap((opening) => [
      Math.max(yBottom, opening.bottom),
      Math.min(yTop, opening.top),
    ]),
  ]
    .filter((value) => value >= yBottom - 0.0001 && value <= yTop + 0.0001)
    .sort((first, second) => first - second)
  const uniqueXBreaks = xBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - xBreaks[index - 1]) > 0.0001,
  )
  const uniqueYBreaks = yBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - yBreaks[index - 1]) > 0.0001,
  )

  uniqueXBreaks.slice(0, -1).forEach((xStart, xIndex) => {
    const xEnd = uniqueXBreaks[xIndex + 1]

    if (xEnd <= xStart + 0.0001) {
      return
    }

    const midpointDistance = (xStart + xEnd) / 2
    const edgeStartDistance = toEdgeDistance(xStart)
    const edgeEndDistance = toEdgeDistance(xEnd)
    const segmentStart = interpolatePoint(start, end, edgeStartDistance / edgeLength)
    const segmentEnd = interpolatePoint(start, end, edgeEndDistance / edgeLength)

    uniqueYBreaks.slice(0, -1).forEach((yBottom, yIndex) => {
      const yTop = uniqueYBreaks[yIndex + 1]

      if (yTop <= yBottom + 0.0001) {
        return
      }

      const midpointY = (yBottom + yTop) / 2
      const isInsideOpening = openings.some(
        (opening) =>
          midpointDistance > opening.left + 0.0001 &&
          midpointDistance < opening.right - 0.0001 &&
          midpointY > opening.bottom + 0.0001 &&
          midpointY < opening.top - 0.0001,
      )

      if (isInsideOpening) {
        return
      }

      addPerimeterVerticalFaceQuad({
        edgeDistanceEnd: getCanonicalWallUvDistance(wall, segmentEnd),
        edgeDistanceStart: getCanonicalWallUvDistance(wall, segmentStart),
        end: segmentEnd,
        faceId: `perimeter:${sourceWallId}:${ringKind}:${ringIndex}:side:${edgeIndex}:${xStart}:${xEnd}:${yBottom}:${yTop}`,
        faces,
        normal,
        source,
        start: segmentStart,
        wallId,
        yBottom,
        yTop,
      })
    })
  })
}

function addPerimeterTriangleFace({
  faceId,
  faces,
  height,
  kind,
  points,
  source,
}: {
  faceId: string
  faces: WallMeshFace[]
  height: number
  kind: 'bottom' | 'top'
  points: [Point, Point, Point]
  source: WallMeshSource
}) {
  const y = kind === 'top' ? height : 0
  const normal: [number, number, number] = kind === 'top' ? [0, 1, 0] : [0, -1, 0]

  faces.push({
    faceId,
    kind,
    materialSource: source,
    normal,
    pickSource: source,
    uvSource: source,
    vertices: [
      toVertex(points[0], y, [points[0].x, points[0].y]),
      toVertex(points[1], y, [points[1].x, points[1].y]),
      toVertex(points[2], y, [points[2].x, points[2].y]),
      toVertex(points[2], y, [points[2].x, points[2].y]),
    ],
    wallId: source.wallId,
  })
}

function addPerimeterCapFaces({
  faces,
  height,
  kinds = ['bottom', 'top'],
  perimeter,
}: {
  faces: WallMeshFace[]
  height: number
  kinds?: Array<'bottom' | 'top'>
  perimeter: WallBodyPerimeter
}) {
  const [wallId = perimeter.componentId] = perimeter.wallIds
  const source = {
    role: 'cap' as const,
    wallId,
  }
  const holeVectors = perimeter.holes.map((hole) =>
    hole.map((point) => new Vector2(point.x, point.y)),
  )
  const capPoints = [
    ...perimeter.outline,
    ...perimeter.holes.flatMap((hole) => hole),
  ]
  const triangles = ShapeUtils.triangulateShape(
    perimeter.outline.map((point) => new Vector2(point.x, point.y)),
    holeVectors,
  )

  triangles.forEach(([firstIndex, secondIndex, thirdIndex], triangleIndex) => {
    const points = [
      capPoints[firstIndex],
      capPoints[secondIndex],
      capPoints[thirdIndex],
    ] as [Point, Point, Point]

    if (kinds.includes('top')) {
      addPerimeterTriangleFace({
        faceId: `perimeter:${perimeter.componentId}:top:${height}:${triangleIndex}`,
        faces,
        height,
        kind: 'top',
        points,
        source,
      })
    }
    if (kinds.includes('bottom')) {
      addPerimeterTriangleFace({
        faceId: `perimeter:${perimeter.componentId}:bottom:${triangleIndex}`,
        faces,
        height,
        kind: 'bottom',
        points: [points[2], points[1], points[0]],
        source,
      })
    }
  })
}

function addPerimeterVerticalFaces({
  faces,
  perimeter,
  walls,
  yBottom,
  yTop,
}: {
  faces: WallMeshFace[]
  perimeter: WallBodyPerimeter
  walls: Wall[]
  yBottom: number
  yTop: number
}) {
  const [wallId = perimeter.componentId] = perimeter.wallIds
  const addRing = (ring: WallBodyRing, ringKind: 'hole' | 'outline', ringIndex: number) => {
    ring.forEach((start, edgeIndex) => {
      const end = ring[(edgeIndex + 1) % ring.length]
      const edgeLength = distance(start, end)

      if (edgeLength <= 0.001) {
        return
      }

      const outward = getPerimeterEdgeOutwardNormal(start, end, perimeter)
      const matchedWallSide = getWallSideSourceForPerimeterEdge(start, end, walls)

      if (matchedWallSide) {
        addPerimeterVerticalWallSideFaces({
          edgeIndex,
          edgeLength,
          end,
          faces,
          normal: outward,
          ringIndex,
          ringKind,
          sourceWallId: perimeter.componentId,
          start,
          wall: matchedWallSide.wall,
          wallId: matchedWallSide.wall.id,
          wallSide: matchedWallSide.side,
          yBottom,
          yTop,
        })
        return
      }

      const source = { role: 'cap' as const, wallId }

      addPerimeterVerticalFaceQuad({
        edgeDistanceEnd: edgeLength,
        edgeDistanceStart: 0,
        end,
        faceId: `perimeter:${perimeter.componentId}:${ringKind}:${ringIndex}:side:${edgeIndex}`,
        faces,
        normal: outward,
        source,
        start,
        wallId,
        yBottom,
        yTop,
      })
    })
  }

  addRing(perimeter.outline, 'outline', 0)
  perimeter.holes.forEach((hole, index) => addRing(hole, 'hole', index))
}

function buildWallFaces(
  wall: Wall,
  plan: WallGeometryPlan,
  options: WallMeshBuildOptions,
  joinContextsByNodeId: Map<string, EndpointJoinContext[]>,
  wallsById: Map<string, Wall>,
) {
  const faces: WallMeshFace[] = []
  const positiveStart = getEndpointBodySidePoint(wall, plan.start, 1)
  const positiveEnd = getEndpointBodySidePoint(wall, plan.end, 1)
  const negativeStart = getEndpointBodySidePoint(wall, plan.start, -1)
  const negativeEnd = getEndpointBodySidePoint(wall, plan.end, -1)
  const joinedPositiveStart = getEndpointJoinSidePoint(wall, plan.start, 1)
  const joinedPositiveEnd = getEndpointJoinSidePoint(wall, plan.end, 1)
  const joinedNegativeStart = getEndpointJoinSidePoint(wall, plan.start, -1)
  const joinedNegativeEnd = getEndpointJoinSidePoint(wall, plan.end, -1)
  const joinedPositiveStartPlan = getEndpointJoinSidePlan(plan.start, 1)
  const joinedPositiveEndPlan = getEndpointJoinSidePlan(plan.end, 1)
  const joinedNegativeStartPlan = getEndpointJoinSidePlan(plan.start, -1)
  const joinedNegativeEndPlan = getEndpointJoinSidePlan(plan.end, -1)

  plan.faces.forEach((facePlan) => {
    const sideStart = facePlan.side === 1 ? positiveStart : negativeStart
    const sideEnd = facePlan.side === 1 ? positiveEnd : negativeEnd

    facePlan.intervals.forEach((interval) =>
      addSideFaces({
        faces,
        interval,
        plan,
        side: facePlan.side,
        sideEnd,
        sideStart,
        wall,
      }),
    )
  })

  if (
    !shouldOmitEndpointJoinSideFace({
      endpointPlan: plan.start,
      endpointSidePlan: joinedPositiveStartPlan,
      joinContextsByNodeId,
      options,
      wall,
      wallsById,
    })
  ) {
    addEndpointJoinSideFace({
      endpoint: 'start',
      faces,
      joinedSidePoint: joinedPositiveStart,
      joinKind: joinedPositiveStartPlan?.type,
      side: 1,
      sidePoint: positiveStart,
      wall,
    })
  }
  if (
    !shouldOmitEndpointJoinSideFace({
      endpointPlan: plan.start,
      endpointSidePlan: joinedNegativeStartPlan,
      joinContextsByNodeId,
      options,
      wall,
      wallsById,
    })
  ) {
    addEndpointJoinSideFace({
      endpoint: 'start',
      faces,
      joinedSidePoint: joinedNegativeStart,
      joinKind: joinedNegativeStartPlan?.type,
      side: -1,
      sidePoint: negativeStart,
      wall,
    })
  }
  if (
    !shouldOmitEndpointJoinSideFace({
      endpointPlan: plan.end,
      endpointSidePlan: joinedPositiveEndPlan,
      joinContextsByNodeId,
      options,
      wall,
      wallsById,
    })
  ) {
    addEndpointJoinSideFace({
      endpoint: 'end',
      faces,
      joinedSidePoint: joinedPositiveEnd,
      joinKind: joinedPositiveEndPlan?.type,
      side: 1,
      sidePoint: positiveEnd,
      wall,
    })
  }
  if (
    !shouldOmitEndpointJoinSideFace({
      endpointPlan: plan.end,
      endpointSidePlan: joinedNegativeEndPlan,
      joinContextsByNodeId,
      options,
      wall,
      wallsById,
    })
  ) {
    addEndpointJoinSideFace({
      endpoint: 'end',
      faces,
      joinedSidePoint: joinedNegativeEnd,
      joinKind: joinedNegativeEndPlan?.type,
      side: -1,
      sidePoint: negativeEnd,
      wall,
    })
  }
  addCapFace({
    endpoint: 'start',
    faces,
    negativeSidePoint: negativeStart,
    options,
    plan: plan.start,
    positiveSidePoint: positiveStart,
    wall,
  })
  addCapFace({
    endpoint: 'end',
    faces,
    negativeSidePoint: negativeEnd,
    options,
    plan: plan.end,
    positiveSidePoint: positiveEnd,
    wall,
  })
  addHorizontalFaces({
    faces,
    kind: 'top',
    negativeEnd,
    negativeStart,
    plan,
    positiveEnd,
    positiveStart,
    wall,
  })
  addHorizontalFaces({
    faces,
    kind: 'bottom',
    negativeEnd,
    negativeStart,
    plan,
    positiveEnd,
    positiveStart,
    wall,
  })
  addOpeningRevealFaces({
    faces,
    options,
    wall,
  })

  return faces
}

export function buildWallMeshFaces(
  walls: Wall[],
  options: WallMeshBuildOptions = {},
) {
  const plans = buildWallGeometryPlans(walls, options)
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const joinContextsByNodeId = getEndpointJoinContexts(plans)
  const buildOptions = {
    ...options,
    omitSideAttachmentCapsForRenderedTargetWallIds:
      options.omitSideAttachmentCapsForRenderedTargetWallIds ?? new Set(wallsById.keys()),
  }
  const faces = plans.flatMap((plan) => {
    const wall = wallsById.get(plan.wallId)

    return wall
      ? buildWallFaces(
          wall,
          plan,
          buildOptions,
          joinContextsByNodeId,
          wallsById,
        )
      : []
  })

  addEndpointTopCaps({
    faces,
    plans,
    wallsById,
  })

  return faces
}

export function buildWallBodyPerimeterMeshFaces(
  walls: Wall[],
  options: WallBodyPerimeterMeshBuildOptions = {},
) {
  const perimeterPlan = buildWallBodyPerimeters(walls, options)
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const faces: WallMeshFace[] = []

  perimeterPlan.perimeters.forEach((perimeter) => {
    const perimeterWalls = perimeter.wallIds
      .map((wallId) => wallsById.get(wallId))
      .filter((wall): wall is Wall => Boolean(wall))
    const heightLevels = Array.from(
      new Set(
        perimeterWalls
          .map((wall) => Math.round(wall.height * 1000000) / 1000000)
          .filter((height) => height > 0),
      ),
    ).sort((firstHeight, secondHeight) => firstHeight - secondHeight)
    const height = heightLevels.at(-1) ?? 0

    if (height <= 0 || perimeter.outline.length < 3) {
      return
    }

    addPerimeterCapFaces({
      faces,
      height,
      kinds: ['bottom'],
      perimeter,
    })
    const layers = heightLevels.map((yTop) => {
      const layerWalls = perimeterWalls.filter(
        (wall) => wall.height >= yTop - 0.000001,
      )

      return {
        layerPlan: buildWallBodyPerimeters(layerWalls, options),
        layerWalls,
        yTop,
      }
    })
    let yBottom = 0

    layers.forEach(({ layerPlan, layerWalls, yTop }, layerIndex) => {
      const nextLayerPerimeters = layers[layerIndex + 1]?.layerPlan.perimeters ?? []

      layerPlan.perimeters.forEach((layerPerimeter) => {
        addPerimeterVerticalFaces({
          faces,
          perimeter: layerPerimeter,
          walls: layerWalls,
          yBottom,
          yTop,
        })
        subtractWallBodyPerimeters(layerPerimeter, nextLayerPerimeters).forEach(
          (exposedPerimeter) => {
            addPerimeterCapFaces({
              faces,
              height: yTop,
              kinds: ['top'],
              perimeter: exposedPerimeter,
            })
          },
        )
      })
      yBottom = yTop
    })
    perimeterWalls
      .filter((wall) => (wall.openings ?? []).length > 0)
      .forEach((wall) => addOpeningRevealFaces({ faces, options, wall }))
  })

  return faces
}
