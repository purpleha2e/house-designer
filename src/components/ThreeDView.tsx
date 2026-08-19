import {
  Edges,
  OrbitControls,
  PointerLockControls,
  useGLTF,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  Box3,
  Vector3,
} from 'three'
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { FloorLevel, PlacedModel, Point, Wall } from '../types'
import { modelsById } from '../models/modelLibrary'
import { getRenderedWalls, getWallPolygon, type RenderedWall } from '../wallGeometry'
import { buildWallTopology } from '../wallTopology'

type ThreeDViewProps = {
  activeFloorId: string
  floors: FloorLevel[]
  selectedModelId: string | null
  showAllFloors: boolean
}

type RenderOptions = {
  ambientOcclusion: boolean
  floorSlabs: boolean
  groundPlane: boolean
  referenceFloors: boolean
  shadows: boolean
  skybox: boolean
  wireframe: boolean
}

const ambientOcclusionColor = new Color('black')
const FLOOR_PLANE_MARGIN = 5
const SHADOW_MARGIN = 8
const FOOTPRINT_EPSILON = 0.04
const WALK_CAMERA_SPEED = 4.2
const WALK_CAMERA_SHIFT_MULTIPLIER = 2
const WALK_HEAD_HEIGHT_METERS = 1.8
const WINDOW_SILL_HEIGHT_METERS = 0.9
const SUN_MIN_ELEVATION = 0.08
const SUN_MAX_ELEVATION = 1.2
const LIGHT_GIMBAL_KNOB_RADIUS = 42

type CameraMode = 'orbit' | 'walk'
type AspectRatioMode = 'normal' | 'super-wide' | 'wide'

type LightDirection = {
  azimuth: number
  elevation: number
}

class ModelLoadBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn('Failed to render model in 3D view.', error, errorInfo)
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

function getCameraFov(aspectRatioMode: AspectRatioMode) {
  if (aspectRatioMode === 'super-wide') {
    return 78
  }

  if (aspectRatioMode === 'wide') {
    return 62
  }

  return 45
}

function createCountrysideSkyTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  const skyGradient = context.createLinearGradient(0, 0, 0, canvas.height)
  skyGradient.addColorStop(0, '#7cb7f2')
  skyGradient.addColorStop(0.42, '#c7e3ff')
  skyGradient.addColorStop(0.58, '#eef7ff')
  skyGradient.addColorStop(1, '#bfdc9b')
  context.fillStyle = skyGradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = 'rgba(255, 255, 255, 0.72)'
  for (const cloud of [
    [220, 190, 72],
    [720, 140, 58],
    [1220, 210, 86],
    [1720, 165, 66],
  ] as const) {
    const [x, y, radius] = cloud
    context.beginPath()
    context.ellipse(x, y, radius * 1.35, radius * 0.55, 0, 0, Math.PI * 2)
    context.ellipse(x + radius * 0.8, y + 8, radius, radius * 0.48, 0, 0, Math.PI * 2)
    context.ellipse(x - radius * 0.9, y + 12, radius * 0.95, radius * 0.42, 0, 0, Math.PI * 2)
    context.fill()
  }

  const drawHills = (color: string, baseline: number, amplitude: number, phase: number) => {
    context.beginPath()
    context.moveTo(0, canvas.height)

    for (let x = 0; x <= canvas.width; x += 32) {
      const wave =
        Math.sin(x / 170 + phase) * amplitude +
        Math.sin(x / 83 + phase * 0.7) * amplitude * 0.35
      context.lineTo(x, baseline + wave)
    }

    context.lineTo(canvas.width, canvas.height)
    context.closePath()
    context.fillStyle = color
    context.fill()
  }

  drawHills('#8ebf73', 590, 34, 0.6)
  drawHills('#6aa85e', 650, 42, 2.1)
  drawHills('#4d8f49', 730, 30, 4.4)

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createBrickTexture(repeatX: number, repeatY: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  context.fillStyle = '#d8c6b4'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const brickHeight = 42
  const brickWidth = 128
  const mortar = 5

  for (let row = 0; row < Math.ceil(canvas.height / brickHeight) + 1; row += 1) {
    const y = row * brickHeight
    const offset = row % 2 === 0 ? 0 : -brickWidth / 2

    for (
      let column = -1;
      column < Math.ceil(canvas.width / brickWidth) + 1;
      column += 1
    ) {
      const x = column * brickWidth + offset
      const variation = (row * 17 + column * 29) % 24
      context.fillStyle = `rgb(${150 + variation}, ${78 + variation / 2}, ${52 + variation / 3})`
      context.fillRect(
        x + mortar,
        y + mortar,
        brickWidth - mortar * 2,
        brickHeight - mortar * 2,
      )
      context.fillStyle = 'rgba(255, 255, 255, 0.08)'
      context.fillRect(
        x + mortar,
        y + mortar,
        brickWidth - mortar * 2,
        Math.max(3, brickHeight * 0.18),
      )
      context.fillStyle = 'rgba(40, 24, 18, 0.1)'
      context.fillRect(
        x + mortar,
        y + brickHeight - mortar - 5,
        brickWidth - mortar * 2,
        5,
      )
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.needsUpdate = true
  return texture
}

type FootprintEdge = {
  wall: Wall
  startKey: string
  endKey: string
}

type FootprintCandidate = {
  edge: FootprintEdge
  nextKey: string
}

function getFloorPlaneBounds(floor: FloorLevel) {
  if (floor.walls.length === 0) {
    return null
  }

  const points = floor.walls.flatMap((wall) => [wall.start, wall.end])
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const width = maxX - minX + FLOOR_PLANE_MARGIN * 2
  const depth = maxZ - minZ + FLOOR_PLANE_MARGIN * 2
  const size = Math.max(width, depth, FLOOR_PLANE_MARGIN * 2)

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
  }
}

function getPointKey(point: Point) {
  return `${Math.round(point.x / FOOTPRINT_EPSILON)}:${Math.round(point.y / FOOTPRINT_EPSILON)}`
}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= FOOTPRINT_EPSILON
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared

  if (t < -FOOTPRINT_EPSILON || t > 1 + FOOTPRINT_EPSILON) {
    return false
  }

  const projectedPoint = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  }

  return Math.hypot(point.x - projectedPoint.x, point.y - projectedPoint.y) <= FOOTPRINT_EPSILON
}

function pointIsInPolygon(point: Point, polygon: Point[]) {
  let isInside = false

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previousIndex]

    if (pointIsOnSegment(point, previousPoint, currentPoint)) {
      return true
    }

    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x

    if (intersects) {
      isInside = !isInside
    }
  }

  return isInside
}

function normalizeAngleRadians(angle: number) {
  const fullCircle = Math.PI * 2
  let normalized = angle % fullCircle

  if (normalized < 0) {
    normalized += fullCircle
  }

  return normalized
}

function getLineIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const x1 = firstStart.x
  const y1 = firstStart.y
  const x2 = firstEnd.x
  const y2 = firstEnd.y
  const x3 = secondStart.x
  const y3 = secondStart.y
  const x4 = secondEnd.x
  const y4 = secondEnd.y
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)

  if (Math.abs(denominator) < 0.0001) {
    return null
  }

  const firstDeterminant = x1 * y2 - y1 * x2
  const secondDeterminant = x3 * y4 - y3 * x4

  return {
    x:
      (firstDeterminant * (x3 - x4) - (x1 - x2) * secondDeterminant) /
      denominator,
    y:
      (firstDeterminant * (y3 - y4) - (y1 - y2) * secondDeterminant) /
      denominator,
  }
}

function getExternalWallLoop(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind !== 'internal')

  if (externalWalls.length < 3) {
    return null
  }

  const edges = externalWalls.map((wall) => ({
    wall,
    startKey: getPointKey(wall.start),
    endKey: getPointKey(wall.end),
  }))
  const connections = new Map<string, FootprintEdge[]>()
  const pointGroups = new Map<string, Point[]>()

  for (const edge of edges) {
    connections.set(edge.startKey, [...(connections.get(edge.startKey) ?? []), edge])
    connections.set(edge.endKey, [...(connections.get(edge.endKey) ?? []), edge])
    pointGroups.set(edge.startKey, [
      ...(pointGroups.get(edge.startKey) ?? []),
      edge.wall.start,
    ])
    pointGroups.set(edge.endKey, [
      ...(pointGroups.get(edge.endKey) ?? []),
      edge.wall.end,
    ])
  }

  const pointsByKey = new Map(
    [...pointGroups.entries()].map(([key, points]) => [
      key,
      {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      },
    ]),
  )
  const loops: Point[][] = []

  for (const edge of edges) {
    for (const [startKey, endKey] of [
      [edge.startKey, edge.endKey],
      [edge.endKey, edge.startKey],
    ] as const) {
      const rightTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        true,
      )

      if (rightTurnLoop) {
        loops.push(rightTurnLoop)
      }

      const leftTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        false,
      )

      if (leftTurnLoop) {
        loops.push(leftTurnLoop)
      }
    }
  }

  return loops.reduce<Point[] | null>((bestLoop, loop) => {
    const area = Math.abs(getSignedArea(loop))

    if (area < 0.01 || loop.length < 3) {
      return bestLoop
    }

    return !bestLoop || area > Math.abs(getSignedArea(bestLoop)) ? loop : bestLoop
  }, null)
}

function traceWallLoop(
  firstEdge: FootprintEdge,
  startKey: string,
  endKey: string,
  connections: Map<string, FootprintEdge[]>,
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const loopKeys = [startKey]
  const visitedStates = new Set<string>()
  let previousKey = startKey
  let currentKey = endKey
  let currentEdge = firstEdge
  const maxSteps = connections.size * 4

  for (let step = 0; step < maxSteps; step += 1) {
    const stateKey = `${currentEdge.wall.id}:${previousKey}:${currentKey}`

    if (visitedStates.has(stateKey)) {
      return null
    }

    visitedStates.add(stateKey)
    loopKeys.push(currentKey)

    if (currentKey === startKey) {
      const uniqueKeys = new Set(loopKeys.slice(0, -1))

      return uniqueKeys.size >= 3
        ? loopKeys.slice(0, -1).map((key) => pointsByKey.get(key)!)
        : null
    }

    const candidates = (connections.get(currentKey) ?? [])
      .map((edge): FootprintCandidate => {
        const nextKey = edge.startKey === currentKey ? edge.endKey : edge.startKey
        return { edge, nextKey }
      })
      .filter(
        (candidate) =>
          candidate.edge.wall.id !== currentEdge.wall.id ||
          candidate.nextKey !== previousKey,
      )

    if (candidates.length === 0) {
      return null
    }

    const nextCandidate = chooseNextFootprintEdge(
      previousKey,
      currentKey,
      candidates,
      pointsByKey,
      preferRightTurn,
    )

    previousKey = currentKey
    currentKey = nextCandidate.nextKey
    currentEdge = nextCandidate.edge
  }

  return null
}

function chooseNextFootprintEdge(
  previousKey: string,
  currentKey: string,
  candidates: FootprintCandidate[],
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const previousPoint = pointsByKey.get(previousKey)!
  const currentPoint = pointsByKey.get(currentKey)!
  const incomingAngle = Math.atan2(
    currentPoint.y - previousPoint.y,
    currentPoint.x - previousPoint.x,
  )

  return candidates.reduce((bestCandidate, candidate) => {
    const bestPoint = pointsByKey.get(bestCandidate.nextKey)!
    const candidatePoint = pointsByKey.get(candidate.nextKey)!
    const bestOutgoingAngle = Math.atan2(
      bestPoint.y - currentPoint.y,
      bestPoint.x - currentPoint.x,
    )
    const candidateOutgoingAngle = Math.atan2(
      candidatePoint.y - currentPoint.y,
      candidatePoint.x - currentPoint.x,
    )
    const bestTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - bestOutgoingAngle)
      : normalizeAngleRadians(bestOutgoingAngle - incomingAngle)
    const candidateTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - candidateOutgoingAngle)
      : normalizeAngleRadians(candidateOutgoingAngle - incomingAngle)

    return candidateTurn < bestTurn ? candidate : bestCandidate
  }, candidates[0])
}

function getOffsetFootprint(loop: Point[], offset: number) {
  const isCounterClockwise = getSignedArea(loop) > 0

  return loop.map((point, index) => {
    const previousPoint = loop[(index - 1 + loop.length) % loop.length]
    const nextPoint = loop[(index + 1) % loop.length]
    const previousDirection = {
      x: point.x - previousPoint.x,
      y: point.y - previousPoint.y,
    }
    const nextDirection = {
      x: nextPoint.x - point.x,
      y: nextPoint.y - point.y,
    }
    const previousLength = Math.hypot(previousDirection.x, previousDirection.y)
    const nextLength = Math.hypot(nextDirection.x, nextDirection.y)

    if (previousLength === 0 || nextLength === 0) {
      return point
    }

    const previousUnit = {
      x: previousDirection.x / previousLength,
      y: previousDirection.y / previousLength,
    }
    const nextUnit = {
      x: nextDirection.x / nextLength,
      y: nextDirection.y / nextLength,
    }
    const getOutwardNormal = (unit: Point) =>
      isCounterClockwise
        ? { x: unit.y, y: -unit.x }
        : { x: -unit.y, y: unit.x }
    const previousNormal = getOutwardNormal(previousUnit)
    const nextNormal = getOutwardNormal(nextUnit)
    const previousOffsetStart = {
      x: previousPoint.x + previousNormal.x * offset,
      y: previousPoint.y + previousNormal.y * offset,
    }
    const previousOffsetEnd = {
      x: point.x + previousNormal.x * offset,
      y: point.y + previousNormal.y * offset,
    }
    const nextOffsetStart = {
      x: point.x + nextNormal.x * offset,
      y: point.y + nextNormal.y * offset,
    }
    const nextOffsetEnd = {
      x: nextPoint.x + nextNormal.x * offset,
      y: nextPoint.y + nextNormal.y * offset,
    }

    return (
      getLineIntersection(
        previousOffsetStart,
        previousOffsetEnd,
        nextOffsetStart,
        nextOffsetEnd,
      ) ?? {
        x: point.x + (previousNormal.x + nextNormal.x) * offset,
        y: point.y + (previousNormal.y + nextNormal.y) * offset,
      }
    )
  })
}

function getFloorFootprint(floor: FloorLevel) {
  const loop = getExternalWallLoop(floor.walls)
  const externalThickness =
    floor.walls.find((wall) => wall.kind !== 'internal')?.thickness ?? 0

  return loop ? getOffsetFootprint(loop, externalThickness / 2) : null
}

function getNearestFloorFootprint(floor: FloorLevel, floors: FloorLevel[]) {
  const ownFootprint = getFloorFootprint(floor)

  if (ownFootprint) {
    return ownFootprint
  }

  for (const candidateFloor of [...floors]
    .filter((candidateFloor) => candidateFloor.elevation < floor.elevation)
    .sort((firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation)) {
    const candidateFootprint = getFloorFootprint(candidateFloor)

    if (candidateFootprint) {
      return candidateFootprint
    }
  }

  return null
}

function getSegmentIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const firstDx = firstEnd.x - firstStart.x
  const firstDy = firstEnd.y - firstStart.y
  const secondDx = secondEnd.x - secondStart.x
  const secondDy = secondEnd.y - secondStart.y
  const denominator = firstDx * secondDy - firstDy * secondDx

  if (Math.abs(denominator) <= 0.000001) {
    return null
  }

  const startDx = secondStart.x - firstStart.x
  const startDy = secondStart.y - firstStart.y
  const firstT = (startDx * secondDy - startDy * secondDx) / denominator
  const secondT = (startDx * firstDy - startDy * firstDx) / denominator

  if (
    firstT < -FOOTPRINT_EPSILON ||
    firstT > 1 + FOOTPRINT_EPSILON ||
    secondT < -FOOTPRINT_EPSILON ||
    secondT > 1 + FOOTPRINT_EPSILON
  ) {
    return null
  }

  return {
    x: firstStart.x + firstDx * firstT,
    y: firstStart.y + firstDy * firstT,
  }
}

function getPolygonIntersectionCandidates(firstPolygon: Point[], secondPolygon: Point[]) {
  const candidates: Point[] = [
    ...firstPolygon.filter((point) => pointIsInPolygon(point, secondPolygon)),
    ...secondPolygon.filter((point) => pointIsInPolygon(point, firstPolygon)),
  ]

  for (let firstIndex = 0; firstIndex < firstPolygon.length; firstIndex += 1) {
    const firstStart = firstPolygon[firstIndex]
    const firstEnd = firstPolygon[(firstIndex + 1) % firstPolygon.length]

    for (let secondIndex = 0; secondIndex < secondPolygon.length; secondIndex += 1) {
      const secondStart = secondPolygon[secondIndex]
      const secondEnd = secondPolygon[(secondIndex + 1) % secondPolygon.length]
      const intersection = getSegmentIntersection(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      )

      if (intersection) {
        candidates.push(intersection)
      }
    }
  }

  return candidates.reduce<Point[]>((uniquePoints, point) => {
    if (
      !uniquePoints.some(
        (uniquePoint) =>
          Math.hypot(uniquePoint.x - point.x, uniquePoint.y - point.y) <=
          FOOTPRINT_EPSILON,
      )
    ) {
      uniquePoints.push(point)
    }

    return uniquePoints
  }, [])
}

function getConvexHull(points: Point[]) {
  if (points.length <= 3) {
    return points
  }

  const sortedPoints = [...points].sort(
    (firstPoint, secondPoint) =>
      firstPoint.x - secondPoint.x || firstPoint.y - secondPoint.y,
  )
  const cross = (origin: Point, firstPoint: Point, secondPoint: Point) =>
    (firstPoint.x - origin.x) * (secondPoint.y - origin.y) -
    (firstPoint.y - origin.y) * (secondPoint.x - origin.x)
  const lowerHull: Point[] = []
  const upperHull: Point[] = []

  for (const point of sortedPoints) {
    while (
      lowerHull.length >= 2 &&
      cross(lowerHull[lowerHull.length - 2], lowerHull[lowerHull.length - 1], point) <= 0
    ) {
      lowerHull.pop()
    }

    lowerHull.push(point)
  }

  for (const point of [...sortedPoints].reverse()) {
    while (
      upperHull.length >= 2 &&
      cross(upperHull[upperHull.length - 2], upperHull[upperHull.length - 1], point) <= 0
    ) {
      upperHull.pop()
    }

    upperHull.push(point)
  }

  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)]
}

function getFloorRoomFootprints(floor: FloorLevel) {
  return buildWallTopology(floor.walls).rooms.map((room) => room.polygon)
}

function getFloorWallBodyFootprints(floor: FloorLevel) {
  return getRenderedWalls(floor.walls).map((renderedWall) => getWallPolygon(renderedWall))
}

function getUpperFloorCoverageFootprints(floor: FloorLevel) {
  const floorFootprint = getFloorFootprint(floor)

  if (floorFootprint) {
    return [floorFootprint]
  }

  return [...getFloorRoomFootprints(floor), ...getFloorWallBodyFootprints(floor)]
}

function getIntersectionFootprint(firstFootprint: Point[], secondFootprint: Point[]) {
  if (secondFootprint.every((point) => pointIsInPolygon(point, firstFootprint))) {
    return secondFootprint
  }

  if (firstFootprint.every((point) => pointIsInPolygon(point, secondFootprint))) {
    return firstFootprint
  }

  const intersectionPoints = getPolygonIntersectionCandidates(
    firstFootprint,
    secondFootprint,
  )

  return intersectionPoints.length >= 3 ? getConvexHull(intersectionPoints) : null
}

function getSlabFootprints(
  lowerFloor: FloorLevel,
  upperFloor: FloorLevel | null,
  floors: FloorLevel[],
) {
  const lowerFootprint = getNearestFloorFootprint(lowerFloor, floors)

  if (!upperFloor) {
    return lowerFootprint ? [lowerFootprint] : []
  }

  const upperFootprints = getUpperFloorCoverageFootprints(upperFloor)

  if (!lowerFootprint) {
    return upperFootprints
  }

  if (upperFootprints.length === 0) {
    return []
  }

  return upperFootprints
    .map((upperFootprint) => getIntersectionFootprint(lowerFootprint, upperFootprint))
    .filter((footprint): footprint is Point[] => Boolean(footprint))
}

function getSceneBounds(floors: FloorLevel[]) {
  const walls = floors.flatMap((floor) => floor.walls)

  if (walls.length === 0) {
    return {
      centerX: 0,
      centerZ: 0,
      size: 20,
      maxElevation: 8,
    }
  }

  const points = walls.flatMap((wall) => [wall.start, wall.end])
  const maxTop = Math.max(
    ...floors.flatMap((floor) =>
      floor.walls.map((wall) => floor.elevation + wall.height),
    ),
    8,
  )
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const size = Math.max(maxX - minX, maxZ - minZ, maxTop) + SHADOW_MARGIN * 2

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
    maxElevation: maxTop,
  }
}

type FloorPlaneBounds = NonNullable<ReturnType<typeof getFloorPlaneBounds>>

function GroundGrid({
  floorPlane,
  isActive,
}: {
  floorPlane: FloorPlaneBounds
  isActive: boolean
}) {
  const geometry = useMemo(() => {
    const halfSize = floorPlane.size / 2
    const firstLine = Math.ceil(-halfSize)
    const lastLine = Math.floor(halfSize)
    const positions: number[] = []

    for (let position = firstLine; position <= lastLine; position += 1) {
      positions.push(position, 0, -halfSize, position, 0, halfSize)
      positions.push(-halfSize, 0, position, halfSize, 0, position)
    }

    const gridGeometry = new BufferGeometry()
    gridGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return gridGeometry
  }, [floorPlane.size])

  return (
    <lineSegments
      geometry={geometry}
      position={[floorPlane.centerX, 0.006, floorPlane.centerZ]}
    >
      <lineBasicMaterial
        color={isActive ? '#64748b' : '#94a3b8'}
        depthWrite={false}
        opacity={isActive ? 0.34 : 0.2}
        transparent
      />
    </lineSegments>
  )
}

function SunLight({
  lightDirection,
  sceneBounds,
  shadows,
}: {
  lightDirection: LightDirection
  sceneBounds: ReturnType<typeof getSceneBounds>
  shadows: boolean
}) {
  const lightRef = useRef<DirectionalLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [sceneBounds])
  const horizontalDistance = Math.max(sceneBounds.size * 0.9, 12)
  const verticalDistance = Math.max(sceneBounds.maxElevation + 8, 8)
  const lightHeight = Math.max(
    0.8,
    Math.sin(lightDirection.elevation) * verticalDistance,
  )
  const lightRadius =
    horizontalDistance * Math.max(0.08, Math.cos(lightDirection.elevation))
  const lightPosition = [
    sceneBounds.centerX + Math.cos(lightDirection.azimuth) * lightRadius,
    lightHeight,
    sceneBounds.centerZ + Math.sin(lightDirection.azimuth) * lightRadius,
  ] as const

  return (
    <>
      <object3D
        ref={targetRef}
        position={[sceneBounds.centerX, 0, sceneBounds.centerZ]}
      />
      <directionalLight
        ref={lightRef}
        position={lightPosition}
        intensity={1.3}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-sceneBounds.size / 2}
        shadow-camera-right={sceneBounds.size / 2}
        shadow-camera-top={sceneBounds.size / 2}
        shadow-camera-bottom={-sceneBounds.size / 2}
        shadow-camera-near={0.5}
        shadow-camera-far={sceneBounds.maxElevation + 30}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
    </>
  )
}

function ExternalWallMaterial({
  attach,
  height,
  length,
  wireframe,
}: {
  attach?: string
  height: number
  length: number
  wireframe: boolean
}) {
  const brickTexture = useMemo(
    () =>
      createBrickTexture(
        Math.max(1, length / 0.85),
        Math.max(1, height / 0.32),
      ),
    [height, length],
  )

  useEffect(
    () => () => {
      brickTexture?.dispose()
    },
    [brickTexture],
  )

  return (
    <meshStandardMaterial
      attach={attach}
      color="#ffffff"
      map={brickTexture}
      roughness={0.82}
      wireframe={wireframe}
    />
  )
}

function WallMesh({
  castsShadow,
  elevation,
  isActive,
  renderedWall,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  isActive: boolean
  renderedWall: RenderedWall
  wireframe: boolean
}) {
  const { wall, startExtension, endExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dz)
  const renderedLength = length + startExtension + endExtension
  const unitX = length === 0 ? 0 : dx / length
  const unitZ = length === 0 ? 0 : dz / length
  const centerX =
    (wall.start.x + wall.end.x) / 2 + unitX * ((endExtension - startExtension) / 2)
  const centerZ =
    (wall.start.y + wall.end.y) / 2 + unitZ * ((endExtension - startExtension) / 2)
  const rotationY = -Math.atan2(dz, dx)
  const openings = (wall.openings ?? [])
    .map((opening) => {
      const center = startExtension + opening.center
      const left = Math.max(0, center - opening.width / 2)
      const right = Math.min(renderedLength, center + opening.width / 2)
      const bottom = Math.max(0, Math.min(wall.height, opening.bottom))
      const top = Math.max(bottom, Math.min(wall.height, opening.bottom + opening.height))

      return right > left && top > bottom
        ? {
            bottom,
            left,
            right,
            top,
          }
        : null
    })
    .filter(
      (
        opening,
      ): opening is { bottom: number; left: number; right: number; top: number } =>
        Boolean(opening),
    )
  const activeWallSegments = (() => {
    if (openings.length === 0) {
      return [
        {
          center: renderedLength / 2,
          height: wall.height,
          length: renderedLength,
          y: wall.height / 2,
        },
      ]
    }

    const xBreaks = [
      0,
      renderedLength,
      ...openings.flatMap((opening) => [opening.left, opening.right]),
    ]
      .filter((position) => position >= 0 && position <= renderedLength)
      .sort((firstPosition, secondPosition) => firstPosition - secondPosition)
    const uniqueBreaks = xBreaks.filter(
      (position, index) => index === 0 || Math.abs(position - xBreaks[index - 1]) > 0.001,
    )

    return uniqueBreaks.slice(0, -1).flatMap((start, index) => {
      const end = uniqueBreaks[index + 1]
      const segmentLength = end - start

      if (segmentLength <= 0.001) {
        return []
      }

      const midpoint = (start + end) / 2
      const opening = openings.find(
        (candidateOpening) =>
          midpoint >= candidateOpening.left && midpoint <= candidateOpening.right,
      )

      if (!opening) {
        return [
          {
            center: midpoint,
            height: wall.height,
            length: segmentLength,
            y: wall.height / 2,
          },
        ]
      }

      return [
        opening.bottom > 0.001
          ? {
              center: midpoint,
              height: opening.bottom,
              length: segmentLength,
              y: opening.bottom / 2,
            }
          : null,
        wall.height - opening.top > 0.001
          ? {
              center: midpoint,
              height: wall.height - opening.top,
              length: segmentLength,
              y: opening.top + (wall.height - opening.top) / 2,
            }
          : null,
      ].filter(
        (segment): segment is { center: number; height: number; length: number; y: number } =>
          Boolean(segment),
      )
    })
  })()

  return (
    <group
      position={[centerX, elevation + wall.height / 2, centerZ]}
      rotation={[0, rotationY, 0]}
      renderOrder={isActive ? 2 : 1}
    >
      {isActive ? (
        activeWallSegments.map((segment, index) => (
          <mesh
            key={index}
            castShadow={castsShadow}
            position={[
              segment.center - renderedLength / 2,
              segment.y - wall.height / 2,
              0,
            ]}
            receiveShadow={castsShadow}
          >
            <boxGeometry args={[segment.length, segment.height, wall.thickness]} />
            {wall.kind === 'external' ? (
              <ExternalWallMaterial
                height={segment.height}
                length={segment.length}
                wireframe={wireframe}
              />
            ) : (
              <meshStandardMaterial
                color="#cbd5e1"
                roughness={0.72}
                wireframe={wireframe}
              />
            )}
          </mesh>
        ))
      ) : (
        <mesh castShadow={castsShadow} receiveShadow={castsShadow}>
          <boxGeometry args={[renderedLength, wall.height, wall.thickness]} />
          <meshBasicMaterial
            color="#94a3b8"
            depthWrite={false}
            opacity={0.015}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            transparent
            wireframe={wireframe}
          />
          <Edges color="#64748b" threshold={15} />
        </mesh>
      )}
    </group>
  )
}

function FloorSlab({
  floor,
  floors,
  isSolid,
  upperFloor,
  wireframe,
}: {
  floor: FloorLevel
  floors: FloorLevel[]
  isSolid: boolean
  upperFloor: FloorLevel | null
  wireframe: boolean
}) {
  const footprints = getSlabFootprints(floor, upperFloor, floors)
  const slabShapes = useMemo(
    () =>
      footprints.map((footprint) => {
        const [firstPoint, ...remainingPoints] = footprint
        const shape = new Shape()
        shape.moveTo(firstPoint.x, -firstPoint.y)

        for (const point of remainingPoints) {
          shape.lineTo(point.x, -point.y)
        }

        shape.closePath()
        return shape
      }),
    [footprints],
  )

  if (slabShapes.length === 0) {
    return null
  }

  return (
    <group>
      {slabShapes.map((slabShape, index) => (
        <mesh
          key={index}
          castShadow={isSolid}
          position={[0, floor.elevation + floor.roomHeight, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow={isSolid}
          renderOrder={isSolid ? 1 : 0}
        >
          <extrudeGeometry
            args={[
              slabShape,
              {
                bevelEnabled: false,
                depth: floor.slabThickness,
              },
            ]}
          />
          <meshStandardMaterial
            attach="material-0"
            color="#e2e8f0"
            opacity={isSolid ? 1 : 0.18}
            transparent={!isSolid}
            depthWrite={isSolid}
            roughness={0.82}
            wireframe={wireframe}
          />
          <ExternalWallMaterial
            attach="material-1"
            height={floor.slabThickness}
            length={10}
            wireframe={wireframe}
          />
        </mesh>
      ))}
    </group>
  )
}

function ModelMesh({
  elevation,
  isActive,
  isSelected,
  model,
  wireframe,
}: {
  elevation: number
  isActive: boolean
  isSelected: boolean
  model: PlacedModel
  wireframe: boolean
}) {
  const modelDefinition = modelsById.get(model.modelId)

  if (!modelDefinition) {
    return null
  }

  const verticalOffset =
    modelDefinition.wallMount === 'window' ? WINDOW_SILL_HEIGHT_METERS : 0
  const castsShadow =
    isActive &&
    modelDefinition.wallMount !== 'window' &&
    modelDefinition.wallMount !== 'patio-door'

  if (modelDefinition.sourceUrl) {
    return (
      <ImportedModelMesh
        castsShadow={castsShadow}
        elevation={elevation + verticalOffset}
        isActive={isActive}
        isSelected={isSelected}
        model={model}
        sourceUrl={modelDefinition.sourceUrl}
        wireframe={wireframe}
      />
    )
  }

  return (
    <mesh
      position={[
        model.position.x,
        elevation + verticalOffset + (modelDefinition.height * model.scale) / 2,
        model.position.y,
      ]}
      rotation={[0, -model.rotation, 0]}
      castShadow={castsShadow}
      receiveShadow={isActive}
      renderOrder={isActive ? 3 : 1}
    >
      {modelDefinition.shape === 'round' ? (
        <cylinderGeometry
          args={[
            (Math.max(modelDefinition.width, modelDefinition.depth) * model.scale) / 2,
            (Math.max(modelDefinition.width, modelDefinition.depth) * model.scale) / 2,
            modelDefinition.height * model.scale,
            32,
          ]}
        />
      ) : (
        <boxGeometry
          args={[
            modelDefinition.width * model.scale,
            modelDefinition.height * model.scale,
            modelDefinition.depth * model.scale,
          ]}
        />
      )}
      <meshStandardMaterial
        color={isSelected ? '#f97316' : modelDefinition.color}
        opacity={isActive ? 1 : 0.24}
        transparent={!isActive}
        roughness={0.68}
        wireframe={wireframe}
      />
      {isSelected ? <Edges color="#f97316" threshold={1} /> : null}
    </mesh>
  )
}

function ImportedModelMesh({
  castsShadow,
  elevation,
  isActive,
  isSelected,
  model,
  sourceUrl,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  isActive: boolean
  isSelected: boolean
  model: PlacedModel
  sourceUrl: string
  wireframe: boolean
}) {
  const gltf = useGLTF(sourceUrl)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const size = new Vector3()
    const center = new Vector3()

    box.getSize(size)
    box.getCenter(center)

    return {
      center,
      size,
    }
  }, [scene])

  useEffect(() => {
    scene.traverse((object) => {
      if ('castShadow' in object) {
        object.castShadow = castsShadow
      }

      if ('receiveShadow' in object) {
        object.receiveShadow = isActive
      }

      if ('material' in object) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]

        for (const material of materials) {
          if (material && 'wireframe' in material) {
            material.wireframe = wireframe
            material.needsUpdate = true
          }
        }
      }
    })
  }, [castsShadow, isActive, scene, wireframe])

  return (
    <group
      position={[model.position.x, elevation, model.position.y]}
      rotation={[0, -model.rotation, 0]}
      scale={model.scale}
      renderOrder={isActive ? 3 : 1}
    >
      <primitive object={scene} />
      {isSelected ? (
        <mesh position={[bounds.center.x, bounds.center.y, bounds.center.z]}>
          <boxGeometry
            args={[
              Math.max(bounds.size.x, 0.1),
              Math.max(bounds.size.y, 0.1),
              Math.max(bounds.size.z, 0.1),
            ]}
          />
          <meshBasicMaterial
            color="#f97316"
            opacity={0.18}
            transparent
            wireframe
          />
        </mesh>
      ) : null}
    </group>
  )
}

function CameraFovController({ fov }: { fov: number }) {
  const { camera } = useThree()

  useEffect(() => {
    if ('fov' in camera) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }, [camera, fov])

  return null
}

function CountrysideSkybox() {
  const { camera } = useThree()
  const groupRef = useRef<Object3D>(null)
  const texture = useMemo(() => createCountrysideSkyTexture(), [])

  useEffect(
    () => () => {
      texture?.dispose()
    },
    [texture],
  )

  useFrame(() => {
    groupRef.current?.position.copy(camera.position)
  })

  if (!texture) {
    return null
  }

  return (
    <group ref={groupRef} renderOrder={-1000}>
      <mesh>
        <sphereGeometry args={[120, 64, 32]} />
        <meshBasicMaterial
          map={texture}
          side={BackSide}
          fog={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function LightGimbal({
  lightDirection,
  onLightDirectionChange,
}: {
  lightDirection: LightDirection
  onLightDirectionChange: (lightDirection: LightDirection) => void
}) {
  const controlRef = useRef<HTMLDivElement>(null)
  const handlePointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = controlRef.current?.getBoundingClientRect()

    if (!bounds) {
      return
    }

    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const dx = event.clientX - centerX
    const dy = event.clientY - centerY
    const radius = Math.max(bounds.width, bounds.height) / 2
    const distanceFromCenter = Math.min(1, Math.hypot(dx, dy) / radius)

    onLightDirectionChange({
      azimuth: Math.atan2(dy, dx),
      elevation:
        SUN_MIN_ELEVATION +
        (1 - distanceFromCenter) * (SUN_MAX_ELEVATION - SUN_MIN_ELEVATION),
    })
  }
  const normalizedElevation =
    (lightDirection.elevation - SUN_MIN_ELEVATION) /
    (SUN_MAX_ELEVATION - SUN_MIN_ELEVATION)
  const knobDistance =
    (1 - Math.min(1, Math.max(0, normalizedElevation))) *
    LIGHT_GIMBAL_KNOB_RADIUS
  const knobX = Math.cos(lightDirection.azimuth) * knobDistance
  const knobY = Math.sin(lightDirection.azimuth) * knobDistance

  return (
    <div className="light-gimbal" aria-label="Light direction control">
      <div
        ref={controlRef}
        className="light-gimbal-pad"
        role="slider"
        aria-label="Move light source"
        aria-valuetext={`${Math.round((lightDirection.azimuth * 180) / Math.PI)} degrees`}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          handlePointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            handlePointer(event)
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      >
        <span className="light-gimbal-ring" />
        <span
          className="light-gimbal-knob"
          style={{
            transform: `translate(${knobX}px, ${knobY}px)`,
          }}
        />
      </div>
    </div>
  )
}

function isTextEntryElement(target: EventTarget | null) {
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }

  if (!(target instanceof HTMLInputElement)) {
    return false
  }

  return !['button', 'checkbox', 'radio', 'range'].includes(target.type)
}

function WalkCameraControls({
  enabled,
  headHeightEnabled,
  headHeightY,
}: {
  enabled: boolean
  headHeightEnabled: boolean
  headHeightY: number
}) {
  const { camera, gl } = useThree()
  const controlsRef = useRef<PointerLockControlsImpl>(null)
  const keysRef = useRef(new Set<string>())
  const isShiftPressedRef = useRef(false)

  useEffect(() => {
    if (!enabled && controlsRef.current?.isLocked) {
      controlsRef.current.unlock()
      gl.domElement.style.cursor = ''
    }
  }, [enabled, gl.domElement])

  useEffect(() => {
    if (!enabled) {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryElement(event.target)) {
        return
      }

      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault()
        isShiftPressedRef.current = true
        return
      }

      if (['KeyA', 'KeyD', 'KeyS', 'KeyW'].includes(event.code)) {
        event.preventDefault()
        keysRef.current.add(event.code)
        isShiftPressedRef.current = event.shiftKey || isShiftPressedRef.current
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code)

      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        isShiftPressedRef.current = false
      }
    }
    const startLooking = (event: MouseEvent) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      gl.domElement.focus()
      gl.domElement.style.cursor = 'none'
      controlsRef.current?.lock()
    }
    const stopLooking = () => {
      gl.domElement.style.cursor = ''

      if (controlsRef.current?.isLocked) {
        controlsRef.current.unlock()
      }
    }
    const handlePointerLockChange = () => {
      if (!controlsRef.current?.isLocked) {
        gl.domElement.style.cursor = ''
      }
    }
    const handleBlur = () => {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      stopLooking()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('mouseup', stopLooking)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    gl.domElement.addEventListener('mousedown', startLooking)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('mouseup', stopLooking)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      gl.domElement.removeEventListener('mousedown', startLooking)
      stopLooking()
    }
  }, [enabled, gl.domElement])

  useFrame((_, delta) => {
    if (!enabled || keysRef.current.size === 0) {
      return
    }

    const forward = new Vector3()
    const right = new Vector3()
    const movement = new Vector3()

    camera.getWorldDirection(forward)
    right.setFromMatrixColumn(camera.matrix, 0).normalize()

    if (headHeightEnabled) {
      forward.y = 0
      right.y = 0

      if (forward.lengthSq() > 0) {
        forward.normalize()
      }

      if (right.lengthSq() > 0) {
        right.normalize()
      }
    }

    if (keysRef.current.has('KeyW')) {
      movement.add(forward)
    }

    if (keysRef.current.has('KeyS')) {
      movement.sub(forward)
    }

    if (keysRef.current.has('KeyD')) {
      movement.add(right)
    }

    if (keysRef.current.has('KeyA')) {
      movement.sub(right)
    }

    if (movement.lengthSq() > 0) {
      const speedMultiplier = isShiftPressedRef.current
        ? WALK_CAMERA_SHIFT_MULTIPLIER
        : 1

      camera.position.add(
        movement
          .normalize()
          .multiplyScalar(WALK_CAMERA_SPEED * speedMultiplier * delta),
      )
    }

    if (headHeightEnabled) {
      camera.position.y = headHeightY
    }
  })

  return (
    <PointerLockControls
      ref={controlsRef}
      enabled={enabled}
      domElement={gl.domElement}
      pointerSpeed={0.9}
      selector=".three-host canvas"
    />
  )
}

export function ThreeDView({
  activeFloorId,
  floors,
  selectedModelId,
  showAllFloors,
}: ThreeDViewProps) {
  const [isRenderMenuOpen, setIsRenderMenuOpen] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit')
  const [aspectRatioMode, setAspectRatioMode] =
    useState<AspectRatioMode>('normal')
  const [headHeightEnabled, setHeadHeightEnabled] = useState(false)
  const [lightDirection, setLightDirection] = useState<LightDirection>({
    azimuth: Math.atan2(6, 4),
    elevation: 0.78,
  })
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ambientOcclusion: false,
    floorSlabs: true,
    groundPlane: true,
    referenceFloors: true,
    shadows: true,
    skybox: false,
    wireframe: false,
  })
  const sceneBounds = getSceneBounds(floors)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? null
  const cameraFov = getCameraFov(aspectRatioMode)
  const headHeightY = (activeFloor?.elevation ?? 0) + WALK_HEAD_HEIGHT_METERS
  const floorBelowActive = activeFloor
    ? floors
        .filter((floor) => floor.elevation < activeFloor.elevation)
        .sort((firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation)[0] ??
      null
    : null
  const floorsByElevation = [...floors].sort(
    (firstFloor, secondFloor) => firstFloor.elevation - secondFloor.elevation,
  )
  const visibleFloors = showAllFloors
    ? floors
    : renderOptions.referenceFloors
    ? floors
    : floors.filter(
        (floor) => floor.id === activeFloorId || floor.id === floorBelowActive?.id,
      )

  const updateRenderOption = (option: keyof RenderOptions) => {
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      [option]: !currentOptions[option],
    }))
  }

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>3D View</h2>
        <span>{cameraMode === 'walk' ? 'WASD movement' : 'Orbit enabled'}</span>
        <div className="three-header-controls">
          <label className="aspect-ratio-select">
            <span>Aspect</span>
            <select
              value={aspectRatioMode}
              onChange={(event) =>
                setAspectRatioMode(event.target.value as AspectRatioMode)
              }
            >
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
              <option value="super-wide">Super-wide</option>
            </select>
          </label>
          <div className="segmented-control compact" aria-label="3D camera mode">
            <button
              type="button"
              className={cameraMode === 'orbit' ? 'active' : ''}
              onClick={() => setCameraMode('orbit')}
            >
              Orbit
            </button>
            <button
              type="button"
              className={cameraMode === 'walk' ? 'active' : ''}
              onClick={() => setCameraMode('walk')}
            >
              Walk
            </button>
          </div>
          {cameraMode === 'walk' ? (
            <label className="head-height-toggle">
              <input
                type="checkbox"
                checked={headHeightEnabled}
                onChange={(event) => {
                  setHeadHeightEnabled(event.target.checked)
                  event.currentTarget.blur()
                }}
              />
              Head height
            </label>
          ) : null}
          <div className="render-options">
            <button
              type="button"
              aria-expanded={isRenderMenuOpen}
              onClick={() => setIsRenderMenuOpen((value) => !value)}
            >
              Render
            </button>
            {isRenderMenuOpen ? (
              <div className="render-options-menu">
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.ambientOcclusion}
                    onChange={() => updateRenderOption('ambientOcclusion')}
                  />
                  Ambient occlusion
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.shadows}
                    onChange={() => updateRenderOption('shadows')}
                  />
                  Shadows
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.skybox}
                    onChange={() => updateRenderOption('skybox')}
                  />
                  Countryside skybox
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.wireframe}
                    onChange={() => updateRenderOption('wireframe')}
                  />
                  Wireframe
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.referenceFloors}
                    onChange={() => updateRenderOption('referenceFloors')}
                  />
                  Reference floors
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.groundPlane}
                    onChange={() => updateRenderOption('groundPlane')}
                  />
                  Ground plane
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.floorSlabs}
                    onChange={() => updateRenderOption('floorSlabs')}
                  />
                  Floor slabs
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="three-host">
        <Canvas
          shadows={renderOptions.shadows}
          camera={{ position: [6, 5, 8], fov: cameraFov }}
          gl={{ antialias: true }}
          tabIndex={0}
        >
          <CameraFovController fov={cameraFov} />
          <color attach="background" args={['#eef2f7']} />
          {renderOptions.skybox ? <CountrysideSkybox /> : null}
          <ambientLight intensity={0.55} />
          <SunLight
            lightDirection={lightDirection}
            sceneBounds={sceneBounds}
            shadows={renderOptions.shadows}
          />

          {visibleFloors.map((floor) => {
            const isActive = showAllFloors || floor.id === activeFloorId
            const slabIsSolid = showAllFloors || floor.id === floorBelowActive?.id
            const floorIndex = floorsByElevation.findIndex(
              (candidateFloor) => candidateFloor.id === floor.id,
            )
            const upperFloor =
              floorIndex >= 0 ? floorsByElevation[floorIndex + 1] ?? null : null
            const hasShadowSurface = renderOptions.shadows && isActive
            const floorPlane =
              renderOptions.groundPlane && isActive
                ? getFloorPlaneBounds(floor)
                : null
            const shouldRenderSlab =
              renderOptions.floorSlabs &&
              (showAllFloors ||
                floor.id === activeFloorId ||
                floor.id === floorBelowActive?.id)

            return (
              <group key={floor.id}>
                {shouldRenderSlab ? (
                    <FloorSlab
                      floor={floor}
                      floors={floors}
                      isSolid={slabIsSolid}
                      upperFloor={upperFloor}
                      wireframe={renderOptions.wireframe}
                    />
                ) : null}
                {floorPlane ? (
                  <>
                    <GroundGrid floorPlane={floorPlane} isActive={isActive} />
                    <mesh
                      position={[
                        floorPlane.centerX,
                        -0.01,
                        floorPlane.centerZ,
                      ]}
                      rotation={[-Math.PI / 2, 0, 0]}
                      receiveShadow={hasShadowSurface}
                      renderOrder={isActive ? 0 : -1}
                    >
                      <planeGeometry args={[floorPlane.size, floorPlane.size]} />
                      <meshStandardMaterial
                        color={isActive ? '#f8fafc' : '#eef2f7'}
                        depthWrite={isActive}
                        opacity={isActive ? 1 : 0.035}
                        polygonOffset={!isActive}
                        polygonOffsetFactor={2}
                        polygonOffsetUnits={2}
                        transparent={!isActive}
                        wireframe={renderOptions.wireframe}
                      />
                    </mesh>
                  </>
                ) : null}
                {getRenderedWalls(floor.walls).map((renderedWall) => (
                  <WallMesh
                    key={renderedWall.wall.id}
                    castsShadow={hasShadowSurface}
                    elevation={floor.elevation}
                    isActive={isActive}
                    renderedWall={renderedWall}
                    wireframe={renderOptions.wireframe}
                  />
                ))}
                {isActive ? (
                  <Suspense fallback={null}>
                    {(floor.models ?? []).map((model) => (
                      <ModelLoadBoundary key={model.id}>
                        <ModelMesh
                          elevation={floor.elevation}
                          isActive={isActive}
                          isSelected={model.id === selectedModelId}
                          model={model}
                          wireframe={renderOptions.wireframe}
                        />
                      </ModelLoadBoundary>
                    ))}
                  </Suspense>
                ) : null}
              </group>
            )
          })}

          <WalkCameraControls
            enabled={cameraMode === 'walk'}
            headHeightEnabled={headHeightEnabled}
            headHeightY={headHeightY}
          />
          {cameraMode === 'orbit' ? <OrbitControls makeDefault target={[3, 1.2, 3]} /> : null}
          {renderOptions.ambientOcclusion ? (
            <EffectComposer multisampling={0}>
              <N8AO
                aoRadius={0.75}
                distanceFalloff={0.45}
                intensity={3.2}
                quality="medium"
                aoSamples={16}
                denoiseSamples={4}
                denoiseRadius={6}
                color={ambientOcclusionColor}
              />
            </EffectComposer>
          ) : null}
        </Canvas>
        <LightGimbal
          lightDirection={lightDirection}
          onLightDirectionChange={setLightDirection}
        />
      </div>
    </section>
  )
}
