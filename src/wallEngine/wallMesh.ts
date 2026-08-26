import type { Point, Wall } from '../types.ts'
import {
  buildWallGeometryPlans,
  type WallEndpointJoinKind,
  type WallEndpointPlan,
  type WallEndpointSidePlan,
  type WallFaceInterval,
  type WallGeometryPlan,
} from './wallPlan.ts'
import type { WallEndpointKey, WallGraphOptions, WallSide } from './wallGraph.ts'

export type WallMeshVertex = {
  position: [number, number, number]
  uv: [number, number]
}

export type WallMeshFaceKind = 'bottom' | 'cap' | 'side' | 'top'

export type WallMeshSource = {
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
  omitSideAttachmentCapsForRenderedTargetWallIds?: ReadonlySet<string>
  omitSideAttachmentCapsForTargetWallIds?: ReadonlySet<string>
}

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
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
            right,
            top,
          }
        : null
    })
    .filter(
      (
        opening,
      ): opening is {
        bottom: number
        id: string
        left: number
        right: number
        top: number
      } => Boolean(opening),
    )
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
  const length = Math.max(plan.length, 0.001)
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
    (options.omitSideAttachmentCapsForTargetWallIds?.has(plan.targetWallId) ||
      options.omitSideAttachmentCapsForRenderedTargetWallIds?.has(plan.targetWallId))
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
  const normal = getEndpointNormal(wall, endpoint)

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
  const length = Math.max(plan.length, 0.001)
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
  wall,
}: {
  faces: WallMeshFace[]
  wall: Wall
}) {
  const source = { wallId: wall.id }

  getWallOpeningRects(wall).forEach((opening) => {
    const positiveLeft = getWallSidePointAtDistance(wall, opening.left, 1)
    const negativeLeft = getWallSidePointAtDistance(wall, opening.left, -1)
    const positiveRight = getWallSidePointAtDistance(wall, opening.right, 1)
    const negativeRight = getWallSidePointAtDistance(wall, opening.right, -1)
    const openingWidth = opening.right - opening.left

    faces.push({
      faceId: `${wall.id}:opening:${opening.id}:left`,
      kind: 'cap',
      materialSource: source,
      normal: getEndpointNormal(wall, 'start'),
      pickSource: source,
      uvSource: source,
      vertices: [
        toVertex(negativeLeft, opening.bottom, [0, opening.bottom]),
        toVertex(positiveLeft, opening.bottom, [wall.thickness, opening.bottom]),
        toVertex(positiveLeft, opening.top, [wall.thickness, opening.top]),
        toVertex(negativeLeft, opening.top, [0, opening.top]),
      ],
      wallId: wall.id,
    })
    faces.push({
      faceId: `${wall.id}:opening:${opening.id}:right`,
      kind: 'cap',
      materialSource: source,
      normal: getEndpointNormal(wall, 'end'),
      pickSource: source,
      uvSource: source,
      vertices: [
        toVertex(positiveRight, opening.bottom, [0, opening.bottom]),
        toVertex(negativeRight, opening.bottom, [wall.thickness, opening.bottom]),
        toVertex(negativeRight, opening.top, [wall.thickness, opening.top]),
        toVertex(positiveRight, opening.top, [0, opening.top]),
      ],
      wallId: wall.id,
    })

    if (opening.top < wall.height - 0.0001) {
      faces.push({
        faceId: `${wall.id}:opening:${opening.id}:top`,
        kind: 'cap',
        materialSource: source,
        normal: [0, -1, 0],
        pickSource: source,
        uvSource: source,
        vertices: [
          toVertex(positiveLeft, opening.top, [0, wall.thickness]),
          toVertex(positiveRight, opening.top, [openingWidth, wall.thickness]),
          toVertex(negativeRight, opening.top, [openingWidth, 0]),
          toVertex(negativeLeft, opening.top, [0, 0]),
        ],
        wallId: wall.id,
      })
    }

    if (opening.bottom > 0.0001) {
      faces.push({
        faceId: `${wall.id}:opening:${opening.id}:bottom`,
        kind: 'cap',
        materialSource: source,
        normal: [0, 1, 0],
        pickSource: source,
        uvSource: source,
        vertices: [
          toVertex(negativeLeft, opening.bottom, [0, 0]),
          toVertex(negativeRight, opening.bottom, [openingWidth, 0]),
          toVertex(positiveRight, opening.bottom, [openingWidth, wall.thickness]),
          toVertex(positiveLeft, opening.bottom, [0, wall.thickness]),
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
    if (entries.length < 2) {
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

function buildWallFaces(
  wall: Wall,
  plan: WallGeometryPlan,
  options: WallMeshBuildOptions,
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

  addEndpointJoinSideFace({
    endpoint: 'start',
    faces,
    joinedSidePoint: joinedPositiveStart,
    joinKind: joinedPositiveStartPlan?.type,
    side: 1,
    sidePoint: positiveStart,
    wall,
  })
  addEndpointJoinSideFace({
    endpoint: 'start',
    faces,
    joinedSidePoint: joinedNegativeStart,
    joinKind: joinedNegativeStartPlan?.type,
    side: -1,
    sidePoint: negativeStart,
    wall,
  })
  addEndpointJoinSideFace({
    endpoint: 'end',
    faces,
    joinedSidePoint: joinedPositiveEnd,
    joinKind: joinedPositiveEndPlan?.type,
    side: 1,
    sidePoint: positiveEnd,
    wall,
  })
  addEndpointJoinSideFace({
    endpoint: 'end',
    faces,
    joinedSidePoint: joinedNegativeEnd,
    joinKind: joinedNegativeEndPlan?.type,
    side: -1,
    sidePoint: negativeEnd,
    wall,
  })
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
  const buildOptions = {
    ...options,
    omitSideAttachmentCapsForRenderedTargetWallIds:
      options.omitSideAttachmentCapsForRenderedTargetWallIds ?? new Set(wallsById.keys()),
  }
  const faces = plans.flatMap((plan) => {
    const wall = wallsById.get(plan.wallId)

    return wall ? buildWallFaces(wall, plan, buildOptions) : []
  })

  addEndpointTopCaps({
    faces,
    plans,
    wallsById,
  })

  return faces
}
