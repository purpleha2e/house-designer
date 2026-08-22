/* eslint-disable react-hooks/immutability */
import {
  Edges,
  TransformControls,
  useGLTF,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Object3D,
  PointLight,
  Raycaster,
  Shape,
  Box3,
  Spherical,
  SpotLight,
  Vector2,
  Vector3,
} from 'three'
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  FloorLevel,
  PlacedModel,
  Point,
  SurfaceMaterialAssignment,
  SurfaceWallSide,
  Wall,
  WallKind,
} from '../types'
import { surfaceMaterialsById } from '../materials/materialCatalog'
import { modelsById } from '../models/modelLibrary'
import { getRenderedWalls, getWallPolygon, type RenderedWall } from '../wallGeometry'
import { buildWallTopology, type DetectedRoom } from '../wallTopology'

type ThreeDViewProps = {
  activeFloorId: string
  floors: FloorLevel[]
  onClearSelection: () => void
  onSelectModel: (modelId: string, floorId: string) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  selectedModelId: string | null
  showAllFloors: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
}

type RenderOptions = {
  ambientOcclusion: boolean
  daylight: boolean
  floorSlabs: boolean
  groundPlane: boolean
  lightMarkers: boolean
  lightShadows: boolean
  lights: boolean
  nightFill: boolean
  referenceFloors: boolean
  shadows: boolean
  skybox: boolean
  wireframe: boolean
}

type RenderedFloorData = {
  externalWallPolygons: Point[][]
  floor: FloorLevel
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}

type LocalLightSlot = {
  angle: number
  color: string
  distance: number
  id: string
  kind: 'point' | 'spot'
  penumbra: number
  position: [number, number, number]
  power: number
  target: [number, number, number]
}

type RendererStats = {
  calls: number
  geometries: number
  programs: number
  textures: number
  triangles: number
}

const ambientOcclusionColor = new Color('black')
const FLOOR_PLANE_MARGIN = 5
const SHADOW_MARGIN = 8
const FOOTPRINT_EPSILON = 0.04
const WALK_CAMERA_SPEED = 4.2
const WALK_CAMERA_SHIFT_MULTIPLIER = 2
const WALK_HEAD_HEIGHT_METERS = 1.8
const WALK_LOOK_SENSITIVITY = 0.002
const WALK_MAX_PITCH_RADIANS = Math.PI / 2 - 0.05
const WINDOW_SILL_HEIGHT_METERS = 0.9
const SUN_MIN_ELEVATION = 0.08
const SUN_MAX_ELEVATION = 1.2
const LIGHT_GIMBAL_KNOB_RADIUS = 42
const MODEL_OUTLINE_COLOR = '#f97316'
const MODEL_BOUNDS_SCALE = 1.035
const MODEL_BOUNDS_LINE_THICKNESS = 0.010
const MODEL_WALL_SNAP_DISTANCE_METERS = 0.75
const FALLBACK_REALTIME_LOCAL_LIGHTS = 8
const MAX_REALTIME_LOCAL_LIGHTS = 11
const SKIRTING_HEIGHT_METERS = 0.09
const SKIRTING_DEPTH_METERS = 0.018
const SKIRTING_MIN_SEGMENT_METERS = 0.05
const SKIRTING_OPENING_FLOOR_TOLERANCE_METERS = 0.03
const SKIRTING_OPENING_EDGE_CLEARANCE_METERS = 0.025
const SKIRTING_WALL_MATCH_TOLERANCE_METERS = 0.08
const SKIRTING_DOOR_PROJECTION_TOLERANCE_METERS = 0.18

type AspectRatioMode = 'normal' | 'super-wide' | 'wide'
type LookMouseButton = 'left' | 'right'
type TransformMode = 'rotate' | 'scale' | 'translate'

type LightDirection = {
  azimuth: number
  elevation: number
}

type WalkNavigationMode = 'look' | 'orbit'

type PickGesture = {
  pointerId: number
  x: number
  y: number
}

type LookGesture = PickGesture

type PickTarget = {
  blocksCollision: boolean
  floorId: string
  modelId: string
  object: Object3D
}

type ModelHorizontalBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

type PlanAabb = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

type ObjectTransformSnapshot = {
  position: Vector3
  rotationY: number
  scale: Vector3
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

class FloorRenderBoundary extends Component<
  { children: ReactNode; floorId: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn(
      `Failed to render floor ${this.props.floorId} in 3D view.`,
      error,
      errorInfo,
    )
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

function getFloorsPlaneBounds(floors: FloorLevel[]) {
  const walls = floors.flatMap((floor) => floor.walls)

  if (walls.length === 0) {
    return null
  }

  const points = walls.flatMap((wall) => [wall.start, wall.end])
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

function getWallClipSegmentIntersection(
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
      const intersection = getWallClipSegmentIntersection(
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
  enabled,
  lightDirection,
  sceneBounds,
  shadows,
}: {
  enabled: boolean
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
  const shadowCameraFar =
    horizontalDistance + verticalDistance + sceneBounds.size + sceneBounds.maxElevation

  return (
    <>
      <object3D
        ref={targetRef}
        position={[sceneBounds.centerX, 0, sceneBounds.centerZ]}
      />
      <directionalLight
        ref={lightRef}
        position={lightPosition}
        intensity={enabled ? 1.3 : 0}
        castShadow={enabled && shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-sceneBounds.size / 2}
        shadow-camera-right={sceneBounds.size / 2}
        shadow-camera-top={sceneBounds.size / 2}
        shadow-camera-bottom={-sceneBounds.size / 2}
        shadow-camera-near={0.5}
        shadow-camera-far={shadowCameraFar}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
    </>
  )
}

function ExternalWallMaterial({
  attach,
  wireframe,
}: {
  attach?: string
  wireframe: boolean
}) {
  return (
    <meshStandardMaterial
      attach={attach}
      color="#94a3b8"
      roughness={0.82}
      shadowSide={FrontSide}
      wireframe={wireframe}
    />
  )
}

function getPolygonArea(points: Point[]) {
  return points.reduce((area, point, index) => {
    const nextPoint = points[(index + 1) % points.length]
    return area + point.x * nextPoint.y - nextPoint.x * point.y
  }, 0) / 2
}

function dedupePoints(points: Point[]) {
  return points.filter(
    (point, index) =>
      points.findIndex(
        (candidatePoint) =>
          Math.hypot(candidatePoint.x - point.x, candidatePoint.y - point.y) <
          0.0001,
      ) === index,
  )
}

function isPointOnSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point,
  tolerance = 0.0001,
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLength = Math.hypot(segmentDx, segmentDy)

  if (segmentLength < tolerance) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y) <= tolerance
  }

  const cross =
    (point.x - segmentStart.x) * segmentDy -
    (point.y - segmentStart.y) * segmentDx

  if (Math.abs(cross) > tolerance * segmentLength) {
    return false
  }

  const dot =
    (point.x - segmentStart.x) * segmentDx +
    (point.y - segmentStart.y) * segmentDy

  return dot >= -tolerance && dot <= segmentLength * segmentLength + tolerance
}

function isPointInsidePolygon(point: Point, polygon: Point[]) {
  let inside = false

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInsideOrOnPolygon(point: Point, polygon: Point[]) {
  return (
    polygon.some((polygonPoint, index) =>
      isPointOnSegment(
        point,
        polygonPoint,
        polygon[(index + 1) % polygon.length],
      ),
    ) || isPointInsidePolygon(point, polygon)
  )
}

function createWallPrismGeometry(footprint: Point[], height: number) {
  const geometry = new BufferGeometry()
  const points = getPolygonArea(footprint) > 0 ? [...footprint].reverse() : footprint
  const positions: number[] = []
  const normals: number[] = []
  const pushTriangle = (
    firstPoint: [number, number, number],
    secondPoint: [number, number, number],
    thirdPoint: [number, number, number],
  ) => {
    const firstEdge = [
      secondPoint[0] - firstPoint[0],
      secondPoint[1] - firstPoint[1],
      secondPoint[2] - firstPoint[2],
    ]
    const secondEdge = [
      thirdPoint[0] - firstPoint[0],
      thirdPoint[1] - firstPoint[1],
      thirdPoint[2] - firstPoint[2],
    ]
    const normal = [
      firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
      firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
      firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
    ]
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]) || 1
    const unitNormal = [
      normal[0] / normalLength,
      normal[1] / normalLength,
      normal[2] / normalLength,
    ]

    positions.push(...firstPoint, ...secondPoint, ...thirdPoint)
    normals.push(...unitNormal, ...unitNormal, ...unitNormal)
  }
  const bottomPoint = (point: Point): [number, number, number] => [
    point.x,
    0,
    point.y,
  ]
  const topPoint = (point: Point): [number, number, number] => [
    point.x,
    height,
    point.y,
  ]

  for (let index = 1; index < points.length - 1; index += 1) {
    pushTriangle(bottomPoint(points[0]), bottomPoint(points[index + 1]), bottomPoint(points[index]))
    pushTriangle(topPoint(points[0]), topPoint(points[index]), topPoint(points[index + 1]))
  }

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length
    pushTriangle(
      bottomPoint(points[index]),
      bottomPoint(points[nextIndex]),
      topPoint(points[nextIndex]),
    )
    pushTriangle(
      bottomPoint(points[index]),
      topPoint(points[nextIndex]),
      topPoint(points[index]),
    )
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))

  return geometry
}

function getRaySegmentIntersection(
  rayStart: Point,
  rayDirection: Point,
  segmentStart: Point,
  segmentEnd: Point,
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const denominator = rayDirection.x * segmentDy - rayDirection.y * segmentDx

  if (Math.abs(denominator) < 0.000001) {
    return null
  }

  const startDx = segmentStart.x - rayStart.x
  const startDy = segmentStart.y - rayStart.y
  const rayT = (startDx * segmentDy - startDy * segmentDx) / denominator
  const segmentT = (startDx * rayDirection.y - startDy * rayDirection.x) / denominator

  if (rayT < 0.0001 || segmentT < -0.0001 || segmentT > 1.0001) {
    return null
  }

  return {
    point: {
      x: rayStart.x + rayDirection.x * rayT,
      y: rayStart.y + rayDirection.y * rayT,
    },
    rayT,
  }
}

function getNearestPolygonRayHit(
  rayStart: Point,
  rayDirection: Point,
  polygon: Point[],
) {
  let nearestHit: { point: Point; rayT: number } | null = null

  for (let index = 0; index < polygon.length; index += 1) {
    const hit = getRaySegmentIntersection(
      rayStart,
      rayDirection,
      polygon[index],
      polygon[(index + 1) % polygon.length],
    )

    if (hit && (!nearestHit || hit.rayT < nearestHit.rayT)) {
      nearestHit = hit
    }
  }

  return nearestHit?.point ?? null
}

function getRenderedWallEndpointFace(
  { wall, startExtension, endExtension }: RenderedWall,
  endpoint: 'start' | 'end',
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return null
  }

  const unit = { x: dx / length, y: dy / length }
  const normal = { x: -unit.y, y: unit.x }
  const center =
    endpoint === 'start'
      ? {
          x: wall.start.x - unit.x * startExtension,
          y: wall.start.y - unit.y * startExtension,
        }
      : {
          x: wall.end.x + unit.x * endExtension,
          y: wall.end.y + unit.y * endExtension,
        }
  const outwardDirection =
    endpoint === 'start' ? { x: -unit.x, y: -unit.y } : unit
  const halfThickness = wall.thickness / 2

  return {
    corners: [
      {
        x: center.x + normal.x * halfThickness,
        y: center.y + normal.y * halfThickness,
      },
      {
        x: center.x - normal.x * halfThickness,
        y: center.y - normal.y * halfThickness,
      },
    ] as [Point, Point],
    outwardDirection,
  }
}

function getInternalWallJoinFillFootprints(
  renderedWall: RenderedWall,
  externalWallPolygons: Point[][],
) {
  if (renderedWall.wall.kind !== 'internal') {
    return []
  }

  return (['start', 'end'] as const).flatMap((endpoint) => {
    const endpointFace = getRenderedWallEndpointFace(renderedWall, endpoint)

    if (!endpointFace) {
      return []
    }

    return externalWallPolygons.flatMap((externalWallPolygon) => {
      const cornerStates = endpointFace.corners.map((corner) => ({
        corner,
        hit: getNearestPolygonRayHit(
          corner,
          endpointFace.outwardDirection,
          externalWallPolygon,
        ),
        inside: isPointInsideOrOnPolygon(corner, externalWallPolygon),
      }))
      const outsideStates = cornerStates.filter((state) => !state.inside && state.hit)
      const insideStates = cornerStates.filter((state) => state.inside)

      if (outsideStates.length === 1 && insideStates.length === 1) {
        const outsideState = outsideStates[0]
        const insideState = insideStates[0]
        const fillDepth = outsideState.hit
          ? Math.hypot(
              outsideState.hit.x - outsideState.corner.x,
              outsideState.hit.y - outsideState.corner.y,
            )
          : 0
        const footprint = outsideState.hit
          ? dedupePoints([outsideState.corner, insideState.corner, outsideState.hit])
          : []

        return footprint.length >= 3 && fillDepth <= renderedWall.wall.thickness * 3
          ? [footprint]
          : []
      }

      if (outsideStates.length !== 2 || !outsideStates[0].hit || !outsideStates[1].hit) {
        return []
      }

      const fillDepth = Math.max(
        ...outsideStates.map((state) =>
          state.hit
            ? Math.hypot(
                state.hit.x - state.corner.x,
                state.hit.y - state.corner.y,
              )
            : 0,
        ),
      )
      const footprint = dedupePoints([
        outsideStates[0].corner,
        outsideStates[1].corner,
        outsideStates[1].hit,
        outsideStates[0].hit,
      ])

      return footprint.length >= 3 && fillDepth <= renderedWall.wall.thickness * 3
        ? [footprint]
        : []
    })
  })
}

function createWallSegmentGeometry({
  segment,
  wallThickness,
}: {
  segment: { center: number; height: number; length: number; y: number }
  wallThickness: number
}) {
  const geometry = new BoxGeometry(segment.length, segment.height, wallThickness)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const segmentLocalStart = segment.center - segment.length / 2

  for (let index = 0; index < position.count; index += 1) {
    const localX = position.getX(index)
    const localY = position.getY(index)
    const localZ = position.getZ(index)
    const wallDistance = segmentLocalStart + localX + segment.length / 2
    const wallHeight = segment.y + localY
    const isEndCap =
      Math.abs(Math.abs(localX) - segment.length / 2) < 0.0001
    const isTopOrBottom =
      Math.abs(Math.abs(localY) - segment.height / 2) < 0.0001

    if (isEndCap) {
      uv.setXY(index, localZ + wallThickness / 2, wallHeight)
    } else if (isTopOrBottom) {
      uv.setXY(index, wallDistance, localZ + wallThickness / 2)
    } else {
      uv.setXY(index, wallDistance, wallHeight)
    }
  }

  uv.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function WallSegmentMesh({
  castsShadow,
  renderedLength,
  segment,
  wallHeight,
  wallKind,
  wallThickness,
  wireframe,
}: {
  castsShadow: boolean
  renderedLength: number
  segment: { center: number; height: number; length: number; y: number }
  wallHeight: number
  wallKind: WallKind
  wallThickness: number
  wireframe: boolean
}) {
  const geometry = useMemo(
    () =>
      createWallSegmentGeometry({
        segment,
        wallThickness,
      }),
    [segment, wallThickness],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      castShadow={castsShadow}
      geometry={geometry}
      position={[
        segment.center - renderedLength / 2,
        segment.y - wallHeight / 2,
        0,
      ]}
      receiveShadow={castsShadow}
    >
      {wallKind === 'external' ? (
        <ExternalWallMaterial wireframe={wireframe} />
      ) : (
        <meshStandardMaterial
          color="#cbd5e1"
          roughness={0.72}
          shadowSide={FrontSide}
          wireframe={wireframe}
        />
      )}
    </mesh>
  )
}

function getWallMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wallId: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'wall-face' && assignment.target.wallId === wallId,
  )
}

function WallFinishOverlay({
  renderedLength,
  segments,
  surfaceAssignments,
  wall,
  wallHeight,
  wallThickness,
  wireframe,
}: {
  renderedLength: number
  segments: Array<{ center: number; height: number; length: number; y: number }>
  surfaceAssignments: SurfaceMaterialAssignment[]
  wall: Wall
  wallHeight: number
  wallThickness: number
  wireframe: boolean
}) {
  const assignment = getWallMaterialAssignment(surfaceAssignments, wall.id)
  const material = assignment ? surfaceMaterialsById.get(assignment.materialId) : null

  if (!assignment || !material || assignment.target.type !== 'wall-face') {
    return null
  }

  const coverageHeight = Math.min(
    wallHeight,
    Math.max(0.01, assignment.coverageHeight ?? wallHeight),
  )
  const sides: Array<Exclude<SurfaceWallSide, 'both'>> =
    assignment.target.side === 'both' ? [1, -1] : [assignment.target.side]

  return (
    <>
      {segments.flatMap((segment, segmentIndex) => {
        const segmentBottom = segment.y - segment.height / 2
        const segmentTop = segment.y + segment.height / 2
        const finishBottom = Math.max(0, segmentBottom)
        const finishTop = Math.min(coverageHeight, segmentTop)
        const finishHeight = finishTop - finishBottom

        if (finishHeight <= 0.001) {
          return []
        }

        const finishCenterY = (finishBottom + finishTop) / 2

        return sides.map((side) => (
          <mesh
            key={`${segmentIndex}-${side}`}
            position={[
              segment.center - renderedLength / 2,
              finishCenterY - wallHeight / 2,
              side * (wallThickness / 2 + 0.006),
            ]}
            rotation={[0, side === 1 ? 0 : Math.PI, 0]}
            receiveShadow
            renderOrder={4}
          >
            <planeGeometry args={[segment.length, finishHeight]} />
            <meshStandardMaterial
              color={material.pbr.baseColor ?? '#e2e8f0'}
              metalness={material.pbr.metalness ?? 0}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
              roughness={material.pbr.roughness ?? 0.7}
              wireframe={wireframe}
            />
          </mesh>
        ))
      })}
    </>
  )
}

const WallMesh = memo(function WallMesh({
  castsShadow,
  elevation,
  externalWallPolygons,
  isActive,
  renderedWall,
  surfaceAssignments,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  externalWallPolygons: Point[][]
  isActive: boolean
  renderedWall: RenderedWall
  surfaceAssignments: SurfaceMaterialAssignment[]
  wireframe: boolean
}) {
  const { wall, startExtension, endExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dz)
  const renderedLength = Math.max(0.01, length + startExtension + endExtension)
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
  const joinFillGeometries = useMemo(() => {
    if (wall.kind !== 'internal' || wall.openings?.length) {
      return []
    }

    return getInternalWallJoinFillFootprints(
      renderedWall,
      externalWallPolygons,
    ).map((footprint) => createWallPrismGeometry(footprint, wall.height))
  }, [
    externalWallPolygons,
    renderedWall,
    wall.height,
    wall.kind,
    wall.openings?.length,
  ])

  useEffect(
    () => () => {
      joinFillGeometries.forEach((geometry) => geometry.dispose())
    },
    [joinFillGeometries],
  )

  return (
    <>
      <group
        position={[centerX, elevation + wall.height / 2, centerZ]}
        rotation={[0, rotationY, 0]}
        renderOrder={isActive ? 2 : 1}
      >
        {isActive ? (
          <>
            {activeWallSegments.map((segment, index) => (
              <WallSegmentMesh
                key={index}
                castsShadow={castsShadow}
                renderedLength={renderedLength}
                segment={segment}
                wallHeight={wall.height}
                wallKind={wall.kind}
                wallThickness={wall.thickness}
                wireframe={wireframe}
              />
            ))}
            <WallFinishOverlay
              renderedLength={renderedLength}
              segments={activeWallSegments}
              surfaceAssignments={surfaceAssignments}
              wall={wall}
              wallHeight={wall.height}
              wallThickness={wall.thickness}
              wireframe={wireframe}
            />
          </>
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
      {joinFillGeometries.map((geometry, index) => (
        <mesh
          key={`join-fill-${index}`}
          castShadow={castsShadow}
          geometry={geometry}
          position={[0, elevation, 0]}
          receiveShadow={castsShadow}
          renderOrder={isActive ? 2 : 1}
        >
          <meshStandardMaterial
            color={isActive ? '#cbd5e1' : '#94a3b8'}
            opacity={isActive ? 1 : 0.18}
            roughness={0.72}
            shadowSide={FrontSide}
            transparent={!isActive}
            wireframe={wireframe}
          />
        </mesh>
      ))}
    </>
  )
})

type SkirtingWallFace = {
  end: Point
  length: number
  renderedWall: RenderedWall
  start: Point
  unit: Point
}

function getDistanceToSegment(point: Point, segmentStart: Point, segmentEnd: Point) {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
        lengthSquared,
    ),
  )
  const projection = {
    x: segmentStart.x + dx * t,
    y: segmentStart.y + dy * t,
  }

  return Math.hypot(point.x - projection.x, point.y - projection.y)
}

function pointAtDistanceOnSkirtingFace(face: SkirtingWallFace, distance: number) {
  return {
    x: face.start.x + face.unit.x * distance,
    y: face.start.y + face.unit.y * distance,
  }
}

function getDistanceAlongSkirtingFace(face: SkirtingWallFace, point: Point) {
  return (
    (point.x - face.start.x) * face.unit.x +
    (point.y - face.start.y) * face.unit.y
  )
}

function getSkirtingWallFace(
  edgeStart: Point,
  edgeEnd: Point,
  renderedWalls: RenderedWall[],
): SkirtingWallFace | null {
  for (const renderedWall of renderedWalls) {
    const polygon = getWallPolygon(renderedWall)
    const faces = [
      [polygon[0], polygon[1]],
      [polygon[3], polygon[2]],
    ] as const

    for (const [faceStart, faceEnd] of faces) {
      const faceDx = faceEnd.x - faceStart.x
      const faceDy = faceEnd.y - faceStart.y
      const faceLength = Math.hypot(faceDx, faceDy)

      if (
        faceLength < SKIRTING_MIN_SEGMENT_METERS ||
        getDistanceToSegment(edgeStart, faceStart, faceEnd) >
          SKIRTING_WALL_MATCH_TOLERANCE_METERS ||
        getDistanceToSegment(edgeEnd, faceStart, faceEnd) >
          SKIRTING_WALL_MATCH_TOLERANCE_METERS
      ) {
        continue
      }

      return {
        end: faceEnd,
        length: faceLength,
        renderedWall,
        start: faceStart,
        unit: {
          x: faceDx / faceLength,
          y: faceDy / faceLength,
        },
      }
    }
  }

  return null
}

function getSkirtingSegmentsAroundOpenings(
  edgeStart: Point,
  edgeEnd: Point,
  face: SkirtingWallFace,
  models: PlacedModel[],
) {
  const edgeStartDistance = getDistanceAlongSkirtingFace(face, edgeStart)
  const edgeEndDistance = getDistanceAlongSkirtingFace(face, edgeEnd)
  const startDistance = Math.max(0, Math.min(edgeStartDistance, edgeEndDistance))
  const endDistance = Math.min(face.length, Math.max(edgeStartDistance, edgeEndDistance))
  const { renderedWall } = face
  const doorwayIntervals = (renderedWall.wall.openings ?? [])
    .filter(
      (opening) =>
        opening.bottom <= SKIRTING_OPENING_FLOOR_TOLERANCE_METERS &&
        opening.height > SKIRTING_HEIGHT_METERS,
    )
    .map((opening) => {
      const openingCenter = renderedWall.startExtension + opening.center
      return {
        end: Math.min(
          endDistance,
          openingCenter + opening.width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
        ),
        start: Math.max(
          startDistance,
          openingCenter - opening.width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
        ),
      }
    })
    .concat(
      models
        .filter((model) => model.wallAttachment?.wallId === renderedWall.wall.id)
        .flatMap((model) => {
          const definition = modelsById.get(model.modelId)

          if (!definition?.wallMount || definition.wallMount === 'window') {
            return []
          }

          const scale = model.scale ?? 1
          const width = Math.max(
            (definition.openingWidth ?? definition.width) * scale,
            0.3,
          )
          const openingCenter =
            renderedWall.startExtension +
            (model.wallAttachment?.offset ?? 0) +
            (definition.openingCenterOffset ?? 0) * scale

          return [
            {
              end: Math.min(
                endDistance,
                openingCenter + width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
              ),
              start: Math.max(
                startDistance,
                openingCenter - width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
              ),
            },
          ]
        }),
    )
    .filter((interval) => interval.end > interval.start)
    .sort((firstInterval, secondInterval) => firstInterval.start - secondInterval.start)

  if (doorwayIntervals.length === 0) {
    return [{ end: edgeEnd, start: edgeStart }]
  }

  const segments: Array<{ end: Point; start: Point }> = []
  let cursor = startDistance

  for (const interval of doorwayIntervals) {
    if (interval.start - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
      segments.push({
        end: pointAtDistanceOnSkirtingFace(face, interval.start),
        start: pointAtDistanceOnSkirtingFace(face, cursor),
      })
    }

    cursor = Math.max(cursor, interval.end)
  }

  if (endDistance - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
    segments.push({
      end: pointAtDistanceOnSkirtingFace(face, endDistance),
      start: pointAtDistanceOnSkirtingFace(face, cursor),
    })
  }

  return segments
}

function getPointAtSegmentDistance(start: Point, unit: Point, distance: number) {
  return {
    x: start.x + unit.x * distance,
    y: start.y + unit.y * distance,
  }
}

function getDistanceAlongSegment(start: Point, unit: Point, point: Point) {
  return (point.x - start.x) * unit.x + (point.y - start.y) * unit.y
}

function getDoorwayClipIntervalsForSkirtingSegment(
  segmentStart: Point,
  segmentEnd: Point,
  renderedWalls: RenderedWall[],
  models: PlacedModel[],
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLength = Math.hypot(segmentDx, segmentDy)

  if (segmentLength < SKIRTING_MIN_SEGMENT_METERS) {
    return []
  }

  const segmentUnit = {
    x: segmentDx / segmentLength,
    y: segmentDy / segmentLength,
  }
  const getProjectedInterval = (
    wall: Wall,
    centerDistance: number,
    width: number,
  ) => {
    const wallLength = Math.hypot(
      wall.end.x - wall.start.x,
      wall.end.y - wall.start.y,
    )

    if (wallLength < SKIRTING_MIN_SEGMENT_METERS) {
      return null
    }

    const wallUnit = {
      x: (wall.end.x - wall.start.x) / wallLength,
      y: (wall.end.y - wall.start.y) / wallLength,
    }
    const parallel = Math.abs(
      wallUnit.x * segmentUnit.x + wallUnit.y * segmentUnit.y,
    )

    if (parallel < 0.94) {
      return null
    }

    const centerPoint = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance,
    )
    const maxDistanceFromWallFace =
      wall.thickness / 2 + SKIRTING_DOOR_PROJECTION_TOLERANCE_METERS

    if (
      getDistanceToSegment(centerPoint, segmentStart, segmentEnd) >
      maxDistanceFromWallFace
    ) {
      return null
    }

    const openingStart = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance - width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
    )
    const openingEnd = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance + width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
    )
    const firstDistance = getDistanceAlongSegment(
      segmentStart,
      segmentUnit,
      openingStart,
    )
    const secondDistance = getDistanceAlongSegment(
      segmentStart,
      segmentUnit,
      openingEnd,
    )

    return {
      end: Math.min(segmentLength, Math.max(firstDistance, secondDistance)),
      start: Math.max(0, Math.min(firstDistance, secondDistance)),
    }
  }
  const openingIntervals = renderedWalls.flatMap((renderedWall) =>
    (renderedWall.wall.openings ?? []).flatMap((opening) => {
      if (
        opening.bottom > SKIRTING_OPENING_FLOOR_TOLERANCE_METERS ||
        opening.height <= SKIRTING_HEIGHT_METERS
      ) {
        return []
      }

      const interval = getProjectedInterval(
        renderedWall.wall,
        opening.center,
        opening.width,
      )

      return interval ? [interval] : []
    }),
  )
  const modelIntervals = models.flatMap((model) => {
    const definition = modelsById.get(model.modelId)

    if (!definition?.wallMount || definition.wallMount === 'window') {
      return []
    }

    const renderedWall = renderedWalls.find(
      (candidateWall) =>
        candidateWall.wall.id === model.wallAttachment?.wallId,
    )

    if (!renderedWall || !model.wallAttachment) {
      return []
    }

    const scale = model.scale ?? 1
    const width = Math.max(
      (definition.openingWidth ?? definition.width) * scale,
      0.3,
    )
    const interval = getProjectedInterval(
      renderedWall.wall,
      model.wallAttachment.offset +
        (definition.openingCenterOffset ?? 0) * scale,
      width,
    )

    return interval ? [interval] : []
  })

  return [...openingIntervals, ...modelIntervals]
    .filter((interval) => interval.end - interval.start >= SKIRTING_MIN_SEGMENT_METERS)
    .sort((firstInterval, secondInterval) => firstInterval.start - secondInterval.start)
}

function clipSkirtingSegmentsForDoorways(
  segments: Array<{ end: Point; start: Point }>,
  renderedWalls: RenderedWall[],
  models: PlacedModel[],
) {
  return segments.flatMap((segment) => {
    const segmentDx = segment.end.x - segment.start.x
    const segmentDy = segment.end.y - segment.start.y
    const segmentLength = Math.hypot(segmentDx, segmentDy)

    if (segmentLength < SKIRTING_MIN_SEGMENT_METERS) {
      return []
    }

    const unit = {
      x: segmentDx / segmentLength,
      y: segmentDy / segmentLength,
    }
    const intervals = getDoorwayClipIntervalsForSkirtingSegment(
      segment.start,
      segment.end,
      renderedWalls,
      models,
    )

    if (intervals.length === 0) {
      return [segment]
    }

    const clippedSegments: Array<{ end: Point; start: Point }> = []
    let cursor = 0

    for (const interval of intervals) {
      if (interval.start - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
        clippedSegments.push({
          end: getPointAtSegmentDistance(segment.start, unit, interval.start),
          start: getPointAtSegmentDistance(segment.start, unit, cursor),
        })
      }

      cursor = Math.max(cursor, interval.end)
    }

    if (segmentLength - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
      clippedSegments.push({
        end: getPointAtSegmentDistance(segment.start, unit, segmentLength),
        start: getPointAtSegmentDistance(segment.start, unit, cursor),
      })
    }

    return clippedSegments
  })
}

const SkirtingBoards = memo(function SkirtingBoards({
  elevation,
  models,
  renderedWalls,
  rooms,
  wireframe,
}: {
  elevation: number
  models: PlacedModel[]
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
  wireframe: boolean
}) {
  const skirtingRuns = useMemo(
    () =>
      rooms.flatMap((room, roomIndex) => {
        const isCounterClockwise = getSignedArea(room.polygon) > 0

        return room.polygon.flatMap((start, edgeIndex) => {
          const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
          const dx = end.x - start.x
          const dz = end.y - start.y
          const length = Math.hypot(dx, dz)

          if (length < SKIRTING_MIN_SEGMENT_METERS) {
            return []
          }

          const inwardNormal = isCounterClockwise
            ? { x: -dz / length, z: dx / length }
            : { x: dz / length, z: -dx / length }
          const wallFace = getSkirtingWallFace(start, end, renderedWalls)
          const baseSegments = wallFace
            ? getSkirtingSegmentsAroundOpenings(start, end, wallFace, models)
            : [{ end, start }]
          const segments = clipSkirtingSegmentsForDoorways(
            baseSegments,
            renderedWalls,
            models,
          )

          return segments
            .filter(
              (segment) =>
                Math.hypot(
                  segment.end.x - segment.start.x,
                  segment.end.y - segment.start.y,
                ) >= SKIRTING_MIN_SEGMENT_METERS,
            )
            .map((segment, segmentIndex) => ({
              end: segment.end,
              inwardNormal,
              key: `${room.signature}-${roomIndex}-${edgeIndex}-${segmentIndex}`,
              start: segment.start,
            }))
        })
      }),
    [models, renderedWalls, rooms],
  )

  return (
    <group renderOrder={3}>
      {skirtingRuns.map((run) => {
          const dx = run.end.x - run.start.x
          const dz = run.end.y - run.start.y
          const length = Math.hypot(dx, dz)
          const centerX =
            (run.start.x + run.end.x) / 2 +
            run.inwardNormal.x * (SKIRTING_DEPTH_METERS / 2)
          const centerZ =
            (run.start.y + run.end.y) / 2 +
            run.inwardNormal.z * (SKIRTING_DEPTH_METERS / 2)
          const rotationY = -Math.atan2(dz, dx)

          return (
            <mesh
              key={run.key}
              position={[
                centerX,
                elevation + SKIRTING_HEIGHT_METERS / 2,
                centerZ,
              ]}
              receiveShadow
              rotation={[0, rotationY, 0]}
            >
              <boxGeometry
                args={[length, SKIRTING_HEIGHT_METERS, SKIRTING_DEPTH_METERS]}
              />
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.58}
                wireframe={wireframe}
              />
            </mesh>
          )
      })}
    </group>
  )
})

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
          <meshStandardMaterial
            attach="material-1"
            color="#94a3b8"
            depthWrite={isSolid}
            opacity={isSolid ? 1 : 0.18}
            roughness={0.82}
            shadowSide={FrontSide}
            transparent={!isSolid}
            wireframe={wireframe}
          />
        </mesh>
      ))}
    </group>
  )
}

function createPlanShape(points: Point[]) {
  const [firstPoint, ...remainingPoints] = points
  const shape = new Shape()

  shape.moveTo(firstPoint.x, -firstPoint.y)

  for (const point of remainingPoints) {
    shape.lineTo(point.x, -point.y)
  }

  shape.closePath()
  return shape
}

function getRoomFloorMaterialId(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  roomSignature: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'room-floor' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )?.materialId
}

function getRoomCeilingMaterialId(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  roomSignature: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'ceiling' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )?.materialId
}

function RoomFloorFinishMesh({
  elevation,
  materialId,
  room,
  wireframe,
}: {
  elevation: number
  materialId: string
  room: DetectedRoom
  wireframe: boolean
}) {
  const material = surfaceMaterialsById.get(materialId)
  const shape = useMemo(() => createPlanShape(room.polygon), [room.polygon])

  if (!material) {
    return null
  }

  return (
    <mesh
      position={[0, elevation + 0.004, 0]}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={material.pbr.baseColor ?? '#e2e8f0'}
        metalness={material.pbr.metalness ?? 0}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        roughness={material.pbr.roughness ?? 0.78}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomFloorFinishes({
  elevation,
  floorId,
  rooms,
  surfaceAssignments,
  wireframe,
}: {
  elevation: number
  floorId: string
  rooms: DetectedRoom[]
  surfaceAssignments: SurfaceMaterialAssignment[]
  wireframe: boolean
}) {
  return (
    <group>
      {rooms.map((room) => {
        const materialId = getRoomFloorMaterialId(
          surfaceAssignments,
          floorId,
          room.signature,
        )

        return materialId ? (
          <RoomFloorFinishMesh
            key={room.signature}
            elevation={elevation}
            materialId={materialId}
            room={room}
            wireframe={wireframe}
          />
        ) : null
      })}
    </group>
  )
}

function RoomCeilingFinishMesh({
  elevation,
  materialId,
  room,
  roomHeight,
  wireframe,
}: {
  elevation: number
  materialId: string
  room: DetectedRoom
  roomHeight: number
  wireframe: boolean
}) {
  const material = surfaceMaterialsById.get(materialId)
  const shape = useMemo(() => createPlanShape(room.polygon), [room.polygon])

  if (!material) {
    return null
  }

  return (
    <mesh
      position={[0, elevation + roomHeight - 0.006, 0]}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={material.pbr.baseColor ?? '#f8fafc'}
        metalness={material.pbr.metalness ?? 0}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        roughness={material.pbr.roughness ?? 0.82}
        side={DoubleSide}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomCeilingFinishes({
  elevation,
  floorId,
  roomHeight,
  rooms,
  surfaceAssignments,
  wireframe,
}: {
  elevation: number
  floorId: string
  roomHeight: number
  rooms: DetectedRoom[]
  surfaceAssignments: SurfaceMaterialAssignment[]
  wireframe: boolean
}) {
  return (
    <group>
      {rooms.map((room) => {
        const materialId = getRoomCeilingMaterialId(
          surfaceAssignments,
          floorId,
          room.signature,
        )

        return materialId ? (
          <RoomCeilingFinishMesh
            key={room.signature}
            elevation={elevation}
            materialId={materialId}
            room={room}
            roomHeight={roomHeight}
            wireframe={wireframe}
          />
        ) : null
      })}
    </group>
  )
}

function getPlanAabbFromBox(box: Box3): PlanAabb {
  return {
    maxX: box.max.x,
    maxY: box.max.z,
    minX: box.min.x,
    minY: box.min.z,
  }
}

function getPlanAabbFromPoints(points: Point[]): PlanAabb {
  return points.reduce<PlanAabb>(
    (bounds, point) => ({
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
    }),
    {
      maxX: -Infinity,
      maxY: -Infinity,
      minX: Infinity,
      minY: Infinity,
    },
  )
}

function planAabbsOverlap(
  firstBounds: PlanAabb,
  secondBounds: PlanAabb,
  tolerance = 0,
) {
  return (
    firstBounds.minX < secondBounds.maxX - tolerance &&
    firstBounds.maxX > secondBounds.minX + tolerance &&
    firstBounds.minY < secondBounds.maxY - tolerance &&
    firstBounds.maxY > secondBounds.minY + tolerance
  )
}

function getModelWallSnap(
  position: Point,
  localBounds: ModelHorizontalBounds | null,
  localForwardAngle: number | null,
  walls: Wall[],
) {
  const getOutwardProjection = (rotationY: number, localPoint: Point, outwardDirection: Point) => {
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    const worldX = localPoint.x * cos + localPoint.y * sin
    const worldZ = -localPoint.x * sin + localPoint.y * cos

    return worldX * outwardDirection.x + worldZ * outwardDirection.y
  }
  const getWallInset = (rotationY: number, outwardDirection: Point) => {
    if (!localBounds) {
      return 0
    }

    const localCorners = [
      { x: localBounds.minX, y: localBounds.minZ },
      { x: localBounds.minX, y: localBounds.maxZ },
      { x: localBounds.maxX, y: localBounds.minZ },
      { x: localBounds.maxX, y: localBounds.maxZ },
    ]
    const minOutwardProjection = Math.min(
      ...localCorners.map((corner) =>
        getOutwardProjection(rotationY, corner, outwardDirection),
      ),
    )

    return Math.max(0, -minOutwardProjection)
  }

  return walls
    .map((wall) => {
      const dx = wall.end.x - wall.start.x
      const dy = wall.end.y - wall.start.y
      const lengthSquared = dx * dx + dy * dy

      if (lengthSquared === 0) {
        return null
      }

      const length = Math.sqrt(lengthSquared)
      const unit = { x: dx / length, y: dy / length }
      const normal = { x: -unit.y, y: unit.x }
      const t =
        ((position.x - wall.start.x) * dx + (position.y - wall.start.y) * dy) /
        lengthSquared

      if (t < 0 || t > 1) {
        return null
      }

      const projection = {
        x: wall.start.x + dx * t,
        y: wall.start.y + dy * t,
      }
      const signedDistance =
        (position.x - projection.x) * normal.x +
        (position.y - projection.y) * normal.y
      const side = signedDistance < 0 ? -1 : 1
      const outwardDirection = {
        x: normal.x * side,
        y: normal.y * side,
      }
      const outwardAngle = Math.atan2(outwardDirection.y, outwardDirection.x)
      const rotation =
        localForwardAngle === null
          ? Math.atan2(dy, dx) + (side < 0 ? Math.PI : 0)
          : outwardAngle - localForwardAngle
      const wallInset = getWallInset(-rotation, {
        x: outwardDirection.x,
        y: outwardDirection.y,
      })
      const targetDistance = wall.thickness / 2 + wallInset
      const distanceToWallFace = Math.max(0, Math.abs(signedDistance) - wall.thickness / 2)
      const snapDistance = distanceToWallFace

      if (distanceToWallFace > MODEL_WALL_SNAP_DISTANCE_METERS) {
        return null
      }

      return {
        distance: snapDistance,
        position: {
          x: projection.x + normal.x * side * targetDistance,
          y: projection.y + normal.y * side * targetDistance,
        },
        rotation,
        wallId: wall.id,
      }
    })
    .filter(
      (
        snap,
      ): snap is { distance: number; position: Point; rotation: number; wallId: string } =>
        Boolean(snap),
    )
    .sort((firstSnap, secondSnap) => firstSnap.distance - secondSnap.distance)[0] ?? null
}

function ModelMesh({
  daylightEnabled,
  elevation,
  floorId,
  isActive,
  isSelected,
  lightMarkersVisible,
  model,
  pickTargetsRef,
  onRegisterPickTarget,
  onTransformActiveChange,
  onUpdateModel,
  shadowsEnabled,
  transformEnabled,
  transformMode,
  walls,
  wireframe,
}: {
  daylightEnabled: boolean
  elevation: number
  floorId: string
  isActive: boolean
  isSelected: boolean
  lightMarkersVisible: boolean
  model: PlacedModel
  pickTargetsRef: MutableRefObject<PickTarget[]>
  onRegisterPickTarget: (target: PickTarget) => () => void
  onTransformActiveChange: (isActive: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  shadowsEnabled: boolean
  transformEnabled: boolean
  transformMode: TransformMode
  walls: Wall[]
  wireframe: boolean
}) {
  const groupRef = useRef<Object3D>(null!)
  const lastValidTransformRef = useRef<ObjectTransformSnapshot | null>(null)
  const [importedLocalBounds, setImportedLocalBounds] =
    useState<ModelHorizontalBounds | null>(null)
  const modelDefinition = modelsById.get(model.modelId)

  if (!modelDefinition) {
    return null
  }

  const verticalOffset =
    modelDefinition.isLight
      ? model.height ?? modelDefinition.height
      : modelDefinition.wallMount === 'window'
        ? WINDOW_SILL_HEIGHT_METERS
        : 0
  const castsShadow =
    shadowsEnabled &&
    isActive &&
    !modelDefinition.isLight &&
    modelDefinition.wallMount !== 'window' &&
    modelDefinition.wallMount !== 'patio-door'
  const floorSnapY = elevation + verticalOffset
  const snapObjectToFloor = () => {
    const object = groupRef.current

    if (object && !modelDefinition.isLight) {
      object.position.y = floorSnapY
    }
  }
  const getObjectUniformScale = (object: Object3D) =>
    Math.max(
      0.2,
      (Math.abs(object.scale.x) + Math.abs(object.scale.y) + Math.abs(object.scale.z)) / 3,
    )
  const importedForwardAngle = modelDefinition.sourceUrl ? -Math.PI / 2 : null
  const getObjectTransformSnapshot = (object: Object3D): ObjectTransformSnapshot => ({
    position: object.position.clone(),
    rotationY: object.rotation.y,
    scale: object.scale.clone(),
  })
  const restoreObjectTransform = (
    object: Object3D,
    snapshot: ObjectTransformSnapshot,
  ) => {
    object.position.copy(snapshot.position)
    object.rotation.y = snapshot.rotationY
    object.scale.copy(snapshot.scale)
    object.updateWorldMatrix(true, true)
  }
  const updateLastValidTransform = () => {
    const object = groupRef.current

    if (!object) {
      return
    }

    lastValidTransformRef.current = getObjectTransformSnapshot(object)
  }
  const objectCollides = (ignoredWallId?: string) => {
    const object = groupRef.current

    if (!object || modelDefinition.isLight) {
      return false
    }

    object.updateWorldMatrix(true, true)

    const collisionTarget =
      pickTargetsRef.current.find((target) => target.modelId === model.id)
        ?.object ?? object
    collisionTarget.updateWorldMatrix(true, false)

    const objectBox = new Box3().setFromObject(collisionTarget)
    const objectBounds = getPlanAabbFromBox(objectBox)
    const collidesWithWall = walls.some((wall) => {
      if (wall.id === ignoredWallId) {
        return false
      }

      return planAabbsOverlap(
        objectBounds,
        getPlanAabbFromPoints(getWallPolygon({ wall, startExtension: 0, endExtension: 0 })),
      )
    })

    if (collidesWithWall) {
      return true
    }

    return pickTargetsRef.current.some((target) => {
      if (
        !target.blocksCollision ||
        target.modelId === model.id ||
        target.floorId !== floorId
      ) {
        return false
      }

      target.object.updateWorldMatrix(true, false)

      return planAabbsOverlap(
        objectBounds,
        getPlanAabbFromBox(new Box3().setFromObject(target.object)),
      )
    })
  }
  const applyObjectSnaps = () => {
    const object = groupRef.current

    if (!object) {
      return null
    }

    snapObjectToFloor()

    const uniformScale = getObjectUniformScale(object)
    const transformedPosition = {
      x: object.position.x,
      y: object.position.z,
    }
    const wallSnap = modelDefinition.wallMount || modelDefinition.isLight
      ? null
      : getModelWallSnap(
          transformedPosition,
          modelDefinition.sourceUrl ? importedLocalBounds : null,
          importedForwardAngle,
          walls,
        )

    if (wallSnap) {
      object.position.x = wallSnap.position.x
      object.position.z = wallSnap.position.y
      object.rotation.y = -wallSnap.rotation
    }

    if (objectCollides(wallSnap?.wallId)) {
      const lastValidTransform = lastValidTransformRef.current

      if (lastValidTransform) {
        restoreObjectTransform(object, lastValidTransform)
      }

      return null
    }

    updateLastValidTransform()

    return {
      height: modelDefinition.isLight
        ? Math.max(0.05, object.position.y - elevation)
        : undefined,
      position: wallSnap?.position ?? transformedPosition,
      rotation: wallSnap?.rotation ?? -object.rotation.y,
      scale: uniformScale,
    }
  }
  const commitObjectTransform = () => {
    const snappedTransform = applyObjectSnaps()

    if (!snappedTransform) {
      return
    }

    onUpdateModel(model.id, {
      height: snappedTransform.height,
      position: snappedTransform.position,
      rotation: snappedTransform.rotation,
      scale: snappedTransform.scale,
      wallAttachment: undefined,
    })
  }
  const modelGroup = (
    <group
      ref={groupRef}
      position={[model.position.x, floorSnapY, model.position.y]}
      rotation={[0, -model.rotation, 0]}
      scale={model.scale}
      renderOrder={isActive ? 3 : 1}
    >
      {modelDefinition.isLight ? (
        <LightModelContent
          floorId={floorId}
          isActive={isActive}
          isSelected={isSelected}
          markersVisible={lightMarkersVisible}
          model={model}
          onRegisterPickTarget={onRegisterPickTarget}
        />
      ) : modelDefinition.sourceUrl ? (
        <ImportedModelContent
          castsShadow={castsShadow}
          daylightEnabled={daylightEnabled}
          floorId={floorId}
          isActive={isActive}
          isSelected={isSelected}
          blocksCollision={!modelDefinition.wallMount}
          modelId={model.id}
          onBoundsChange={setImportedLocalBounds}
          onRegisterPickTarget={onRegisterPickTarget}
          sourceUrl={modelDefinition.sourceUrl}
          wireframe={wireframe}
        />
      ) : (
        <FallbackModelContent
          castsShadow={castsShadow}
          isActive={isActive}
          isSelected={isSelected}
          model={model}
          floorId={floorId}
          onRegisterPickTarget={onRegisterPickTarget}
          wireframe={wireframe}
        />
      )}
    </group>
  )

  if (isSelected && isActive && transformEnabled) {
    return (
      <>
        {modelGroup}
        <TransformControls
          object={groupRef}
          mode={transformMode}
          onMouseDown={() => {
            updateLastValidTransform()
            onTransformActiveChange(true)
          }}
          onObjectChange={() => {
            if (transformMode === 'translate') {
              applyObjectSnaps()
            }
          }}
          onMouseUp={() => {
            commitObjectTransform()
            onTransformActiveChange(false)
          }}
        />
      </>
    )
  }

  return modelGroup
}

function SolidFloorScene({
  daylightEnabled,
  floor,
  isSelectedModel,
  lightMarkersVisible,
  onRegisterPickTarget,
  onTransformActiveChange,
  onUpdateModel,
  pickTargetsRef,
  renderedWalls,
  rooms,
  shadowsEnabled,
  surfaceAssignments,
  transformEnabled,
  transformMode,
  wallPolygons,
  wireframe,
}: {
  daylightEnabled: boolean
  floor: FloorLevel
  isSelectedModel: (modelId: string) => boolean
  lightMarkersVisible: boolean
  onRegisterPickTarget: (target: PickTarget) => () => void
  onTransformActiveChange: (isActive: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  pickTargetsRef: MutableRefObject<PickTarget[]>
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
  shadowsEnabled: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
  transformEnabled: boolean
  transformMode: TransformMode
  wallPolygons: Point[][]
  wireframe: boolean
}) {
  return (
    <>
      {renderedWalls.map((renderedWall) => (
        <WallMesh
          key={renderedWall.wall.id}
          castsShadow={shadowsEnabled}
          elevation={floor.elevation}
          externalWallPolygons={wallPolygons}
          isActive
          renderedWall={renderedWall}
          surfaceAssignments={surfaceAssignments}
          wireframe={wireframe}
        />
      ))}
      <SkirtingBoards
        elevation={floor.elevation}
        models={floor.models ?? []}
        renderedWalls={renderedWalls}
        rooms={rooms}
        wireframe={wireframe}
      />
      <Suspense fallback={null}>
        {(floor.models ?? []).map((model) => (
          <ModelLoadBoundary key={model.id}>
            <ModelMesh
              daylightEnabled={daylightEnabled}
              elevation={floor.elevation}
              floorId={floor.id}
              isActive
              isSelected={isSelectedModel(model.id)}
              lightMarkersVisible={lightMarkersVisible}
              model={model}
              pickTargetsRef={pickTargetsRef}
              onRegisterPickTarget={onRegisterPickTarget}
              onTransformActiveChange={onTransformActiveChange}
              onUpdateModel={onUpdateModel}
              shadowsEnabled={shadowsEnabled}
              transformEnabled={transformEnabled}
              transformMode={transformMode}
              walls={floor.walls}
              wireframe={wireframe}
            />
          </ModelLoadBoundary>
        ))}
      </Suspense>
    </>
  )
}

function SelectionBoundsBox({
  center,
  size,
}: {
  center: [number, number, number]
  size: [number, number, number]
}) {
  const scaledSize = [
    Math.max(size[0] * MODEL_BOUNDS_SCALE, 0.04),
    Math.max(size[1] * MODEL_BOUNDS_SCALE, 0.04),
    Math.max(size[2] * MODEL_BOUNDS_SCALE, 0.04),
  ] as const
  const halfX = scaledSize[0] / 2
  const halfY = scaledSize[1] / 2
  const halfZ = scaledSize[2] / 2
  const thickness = Math.min(
    MODEL_BOUNDS_LINE_THICKNESS,
    Math.min(scaledSize[0], scaledSize[1], scaledSize[2]) / 3,
  )
  const edges = [
    { position: [0, halfY, halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, halfY, -halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, -halfY, halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, -halfY, -halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [halfX, 0, halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [halfX, 0, -halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [-halfX, 0, halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [-halfX, 0, -halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [halfX, halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [halfX, -halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [-halfX, halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [-halfX, -halfY, 0], size: [thickness, thickness, scaledSize[2]] },
  ] as const

  return (
    <group position={center} renderOrder={6}>
      {edges.map((edge, index) => (
        <mesh key={index} position={edge.position}>
          <boxGeometry args={edge.size} />
          <meshBasicMaterial
            color={MODEL_OUTLINE_COLOR}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function FallbackModelContent({
  castsShadow,
  floorId,
  isActive,
  isSelected,
  model,
  onRegisterPickTarget,
  wireframe,
}: {
  castsShadow: boolean
  floorId: string
  isActive: boolean
  isSelected: boolean
  model: PlacedModel
  onRegisterPickTarget: (target: PickTarget) => () => void
  wireframe: boolean
}) {
  const hitboxRef = useRef<Object3D>(null!)
  const modelDefinition = modelsById.get(model.modelId)

  useEffect(() => {
    const object = hitboxRef.current

    if (!object) {
      return
    }

    return onRegisterPickTarget({
      blocksCollision: !modelDefinition?.wallMount,
      floorId,
      modelId: model.id,
      object,
    })
  }, [floorId, model.id, modelDefinition?.wallMount, onRegisterPickTarget])

  if (!modelDefinition) {
    return null
  }

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox
          center={[
            0,
            modelDefinition.height / 2,
            modelDefinition.depth / 2,
          ]}
          size={[
            modelDefinition.width,
            modelDefinition.height,
            modelDefinition.depth,
          ]}
        />
      ) : null}
      <mesh
        position={[
          0,
          modelDefinition.height / 2,
          modelDefinition.depth / 2,
        ]}
        castShadow={castsShadow}
        receiveShadow={isActive}
      >
        {modelDefinition.shape === 'round' ? (
          <cylinderGeometry
            args={[
              Math.max(modelDefinition.width, modelDefinition.depth) / 2,
              Math.max(modelDefinition.width, modelDefinition.depth) / 2,
              modelDefinition.height,
              32,
            ]}
          />
        ) : (
          <boxGeometry
            args={[
              modelDefinition.width,
              modelDefinition.height,
              modelDefinition.depth,
            ]}
          />
        )}
        <meshStandardMaterial
          color={modelDefinition.color}
          opacity={isActive ? 1 : 0.24}
          transparent={!isActive}
          roughness={0.68}
          wireframe={wireframe}
        />
      </mesh>
      <mesh
        ref={hitboxRef}
        position={[0, modelDefinition.height / 2, modelDefinition.depth / 2]}
      >
        <boxGeometry
          args={[
            Math.max(modelDefinition.width, 0.35),
            Math.max(modelDefinition.height, 0.35),
            Math.max(modelDefinition.depth, 0.35),
          ]}
        />
        <meshBasicMaterial
          color="#ffffff"
          depthWrite={false}
          opacity={0}
          transparent
        />
      </mesh>
    </>
  )
}

function LightModelContent({
  floorId,
  isActive,
  isSelected,
  markersVisible,
  model,
  onRegisterPickTarget,
}: {
  floorId: string
  isActive: boolean
  isSelected: boolean
  markersVisible: boolean
  model: PlacedModel
  onRegisterPickTarget: (target: PickTarget) => () => void
}) {
  const hitboxRef = useRef<Object3D>(null!)
  const modelDefinition = modelsById.get(model.modelId)
  const lightColor =
    model.lightColor ?? modelDefinition?.lightColor ?? modelDefinition?.color ?? '#fff3c4'
  const lightKind = modelDefinition?.lightKind ?? 'point'
  const showMarker = isSelected || markersVisible

  useEffect(() => {
    const object = hitboxRef.current

    if (!object) {
      return
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      modelId: model.id,
      object,
    })
  }, [floorId, model.id, onRegisterPickTarget])

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox center={[0, 0, 0]} size={[0.42, 0.42, 0.42]} />
      ) : null}
      {showMarker ? (
        <>
          <mesh>
            <sphereGeometry args={[0.12, 24, 16]} />
            <meshBasicMaterial color={lightColor} toneMapped={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.18, 0.2, 32]} />
            <meshBasicMaterial color={lightColor} toneMapped={false} />
          </mesh>
          {lightKind === 'spot' ? (
            <mesh position={[0, -0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.16, 0.24, 24, 1, true]} />
              <meshBasicMaterial
                color={lightColor}
                opacity={0.38}
                transparent
                toneMapped={false}
                wireframe
              />
            </mesh>
          ) : null}
        </>
      ) : null}
      <mesh ref={hitboxRef}>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshBasicMaterial
          color="#ffffff"
          depthWrite={false}
          opacity={0}
          transparent
        />
      </mesh>
    </>
  )
}

function ImportedModelContent({
  blocksCollision,
  castsShadow,
  daylightEnabled,
  floorId,
  isActive,
  isSelected,
  modelId,
  onBoundsChange,
  onRegisterPickTarget,
  sourceUrl,
  wireframe,
}: {
  blocksCollision: boolean
  castsShadow: boolean
  daylightEnabled: boolean
  floorId: string
  isActive: boolean
  isSelected: boolean
  modelId: string
  onBoundsChange: (bounds: ModelHorizontalBounds) => void
  onRegisterPickTarget: (target: PickTarget) => () => void
  sourceUrl: string
  wireframe: boolean
}) {
  const hitboxRef = useRef<Object3D>(null!)
  const gltf = useGLTF(sourceUrl)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const size = new Vector3()
    const center = new Vector3()

    box.getSize(size)
    box.getCenter(center)

    return {
      box,
      center,
      size,
    }
  }, [scene])

  useEffect(() => {
    onBoundsChange({
      maxX: bounds.box.max.x,
      maxZ: bounds.box.max.z,
      minX: bounds.box.min.x,
      minZ: bounds.box.min.z,
    })
  }, [bounds, onBoundsChange])

  useEffect(() => {
    const object = hitboxRef.current

    if (!object) {
      return
    }

    return onRegisterPickTarget({
      blocksCollision,
      floorId,
      modelId,
      object,
    })
  }, [blocksCollision, floorId, modelId, onRegisterPickTarget])

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
          if (!material) {
            continue
          }

          const materialName = 'name' in material ? String(material.name) : ''
          const objectName = 'name' in object ? String(object.name) : ''
          const isGlassMaterial = /glass/i.test(`${objectName} ${materialName}`)

          if (
            isGlassMaterial &&
            'color' in material &&
            material.color instanceof Color &&
            'opacity' in material &&
            'transparent' in material &&
            'userData' in material
          ) {
            const originalGlass = material.userData.originalGlass as
              | { color: number; opacity: number; transparent: boolean }
              | undefined

            if (!originalGlass) {
              material.userData.originalGlass = {
                color: material.color.getHex(),
                opacity: material.opacity,
                transparent: material.transparent,
              }
            }

            const glass =
              (material.userData.originalGlass as {
                color: number
                opacity: number
                transparent: boolean
              }) ?? {
                color: material.color.getHex(),
                opacity: material.opacity,
                transparent: material.transparent,
              }

            if (daylightEnabled) {
              material.color.setHex(glass.color)
              material.opacity = glass.opacity
              material.transparent = glass.transparent
            } else {
              material.color.set('#020617')
              material.opacity = Math.min(glass.opacity, 0.1)
              material.transparent = true
            }

            material.needsUpdate = true
          }

          if (
            'metalness' in material &&
            'roughness' in material &&
            'map' in material &&
            'normalMap' in material &&
            'roughnessMap' in material &&
            'metalnessMap' in material &&
            material.metalness > 0.8 &&
            !material.map &&
            !material.normalMap &&
            !material.roughnessMap &&
            !material.metalnessMap
          ) {
            material.metalness = 0
            material.roughness = Math.max(material.roughness, 0.55)
            material.needsUpdate = true
          }

          if ('side' in material) {
            material.side = DoubleSide
          }

          if ('opacity' in material && material.opacity <= 0.001) {
            material.opacity = 1
            material.transparent = false
          }

          if ('wireframe' in material) {
            material.wireframe = wireframe
            material.needsUpdate = true
          }
        }
      }
    })
  }, [castsShadow, daylightEnabled, isActive, scene, wireframe])

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox
          center={[bounds.center.x, bounds.center.y, bounds.center.z]}
          size={[bounds.size.x, bounds.size.y, bounds.size.z]}
        />
      ) : null}
      <primitive object={scene} />
      <mesh
        ref={hitboxRef}
        position={[bounds.center.x, bounds.center.y, bounds.center.z]}
      >
        <boxGeometry
          args={[
            Math.max(bounds.size.x, 0.35),
            Math.max(bounds.size.y, 0.35),
            Math.max(bounds.size.z, 0.35),
          ]}
        />
        <meshBasicMaterial
          color="#ffffff"
          depthWrite={false}
          opacity={0}
          transparent
        />
      </mesh>
    </>
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

function setIdsEqual(firstIds: ReadonlySet<string>, secondIds: ReadonlySet<string>) {
  if (firstIds.size !== secondIds.size) {
    return false
  }

  for (const id of firstIds) {
    if (!secondIds.has(id)) {
      return false
    }
  }

  return true
}

function estimateRealtimeLocalLightLimit(maxFragmentUniforms: number) {
  if (maxFragmentUniforms >= 1024) {
    return MAX_REALTIME_LOCAL_LIGHTS
  }

  if (maxFragmentUniforms >= 512) {
    return 8
  }

  return 4
}

function RendererLightCapabilities({
  onLocalLightLimitChange,
}: {
  onLocalLightLimitChange: (lightLimit: number) => void
}) {
  const { gl } = useThree()

  useEffect(() => {
    onLocalLightLimitChange(
      estimateRealtimeLocalLightLimit(gl.capabilities.maxFragmentUniforms),
    )
  }, [gl, onLocalLightLimitChange])

  return null
}

function getStableLocalLightIds({
  activeFloorId,
  limit,
  selectedModelId,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  limit: number
  selectedModelId?: string | null
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const selectedLightIds: string[] = []
  const otherLightIds: string[] = []

  for (const renderedFloor of visibleRenderedFloors) {
    const floor = renderedFloor.floor

    if (floor.id !== activeFloorId) {
      continue
    }

    for (const model of floor.models ?? []) {
      const modelDefinition = modelsById.get(model.modelId)

      if (!modelDefinition?.isLight || model.lightEnabled === false) {
        continue
      }

      if (model.id === selectedModelId) {
        selectedLightIds.push(model.id)
      } else {
        otherLightIds.push(model.id)
      }
    }
  }

  return new Set(
    [...selectedLightIds, ...otherLightIds]
      .slice(0, limit)
  )
}

function LocalLightBudgetController({
  activeFloorId,
  enabled,
  localLightLimit,
  onLocalLightIdsChange,
  selectedModelId,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  enabled: boolean
  localLightLimit: number
  onLocalLightIdsChange: (lightIds: ReadonlySet<string>) => void
  selectedModelId: string | null
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const lastIdsRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const nextIds = enabled
      ? getStableLocalLightIds({
          activeFloorId,
          limit: localLightLimit,
          selectedModelId,
          visibleRenderedFloors,
        })
      : new Set<string>()

    if (!setIdsEqual(lastIdsRef.current, nextIds)) {
      lastIdsRef.current = nextIds
      onLocalLightIdsChange(nextIds)
    }
  }, [
    activeFloorId,
    enabled,
    localLightLimit,
    onLocalLightIdsChange,
    selectedModelId,
    visibleRenderedFloors,
  ])

  return null
}

function getLocalLightSlots({
  activeFloorId,
  localLightIds,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  localLightIds: ReadonlySet<string>
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const slots: LocalLightSlot[] = []

  for (const renderedFloor of visibleRenderedFloors) {
    const floor = renderedFloor.floor

    if (floor.id !== activeFloorId) {
      continue
    }

    for (const model of floor.models ?? []) {
      const modelDefinition = modelsById.get(model.modelId)

      if (
        !modelDefinition?.isLight ||
        model.lightEnabled === false ||
        !localLightIds.has(model.id)
      ) {
        continue
      }

      const height = model.height ?? modelDefinition.height
      const lightKind = modelDefinition.lightKind ?? 'point'
      const spreadDegrees =
        lightKind === 'spot'
          ? Math.max(5, Math.min(120, model.lightSpread ?? modelDefinition.lightSpread ?? 36))
          : 120
      const y = floor.elevation + height

      slots.push({
        angle: (spreadDegrees * Math.PI) / 360,
        color: model.lightColor ?? modelDefinition.lightColor ?? modelDefinition.color,
        distance: lightKind === 'spot' ? 12 : 18,
        id: model.id,
        kind: lightKind,
        penumbra: lightKind === 'spot' ? 0.45 : 0.75,
        position: [model.position.x, y, model.position.y],
        power: model.lightPower ?? modelDefinition.lightPower ?? 450,
        target: [model.position.x, y - 1, model.position.y],
      })
    }
  }

  return slots.slice(0, MAX_REALTIME_LOCAL_LIGHTS)
}

function PooledLocalSpotLight({
  castShadow,
  slot,
}: {
  castShadow: boolean
  slot: LocalLightSlot | null
}) {
  const lightRef = useRef<SpotLight>(null!)
  const targetRef = useRef<Object3D>(null!)
  const isActiveSlot = Boolean(slot)
  const position = slot?.position ?? ([0, -1000, 0] as [number, number, number])
  const target = slot?.target ?? ([0, -1001, 0] as [number, number, number])

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [])

  return (
    <>
      <spotLight
        ref={lightRef}
        angle={slot?.angle ?? Math.PI / 3}
        castShadow={isActiveSlot && castShadow}
        color={slot?.color ?? '#ffffff'}
        decay={2}
        distance={slot?.distance ?? 1}
        penumbra={slot?.penumbra ?? 0.75}
        position={position}
        power={slot ? slot.power : 0}
        shadow-bias={-0.0008}
        shadow-camera-far={slot?.distance ?? 12}
        shadow-camera-near={0.25}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-normalBias={0.1}
        shadow-radius={2}
        visible={isActiveSlot}
      />
      <object3D ref={targetRef} position={target} />
    </>
  )
}

function PooledLocalPointLight({
  castShadow,
  slot,
}: {
  castShadow: boolean
  slot: LocalLightSlot | null
}) {
  const lightRef = useRef<PointLight>(null!)
  const isActiveSlot = Boolean(slot)
  const position = slot?.position ?? ([0, -1000, 0] as [number, number, number])

  return (
    <pointLight
      ref={lightRef}
      castShadow={isActiveSlot && castShadow}
      color={slot?.color ?? '#ffffff'}
      decay={2}
      distance={slot?.distance ?? 1}
      position={position}
      power={slot ? slot.power : 0}
      shadow-bias={-0.0008}
      shadow-camera-far={slot?.distance ?? 18}
      shadow-camera-near={0.25}
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      shadow-normalBias={0.1}
      shadow-radius={2}
      visible={isActiveSlot}
    />
  )
}

function FixedLocalLightPool({
  activeFloorId,
  localLightIds,
  lightShadowsEnabled,
  shadowsEnabled,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  localLightIds: ReadonlySet<string>
  lightShadowsEnabled: boolean
  shadowsEnabled: boolean
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const slots = useMemo(
    () =>
      getLocalLightSlots({
        activeFloorId,
        localLightIds,
        visibleRenderedFloors,
      }),
    [activeFloorId, localLightIds, visibleRenderedFloors],
  )
  const pointSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.kind === 'point')
        .slice(0, MAX_REALTIME_LOCAL_LIGHTS),
    [slots],
  )
  const spotSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.kind === 'spot')
        .slice(0, MAX_REALTIME_LOCAL_LIGHTS),
    [slots],
  )
  const pointPoolSlots = useMemo(
    () =>
      Array.from(
        { length: MAX_REALTIME_LOCAL_LIGHTS },
        (_, index) => pointSlots[index] ?? null,
      ),
    [pointSlots],
  )
  const spotPoolSlots = useMemo(
    () =>
      Array.from(
        { length: MAX_REALTIME_LOCAL_LIGHTS },
        (_, index) => spotSlots[index] ?? null,
      ),
    [spotSlots],
  )
  const castPooledShadows = shadowsEnabled && lightShadowsEnabled

  return (
    <>
      {pointPoolSlots.map((slot, index) => (
        <PooledLocalPointLight
          key={`point-${index}`}
          castShadow={castPooledShadows}
          slot={slot}
        />
      ))}
      {spotPoolSlots.map((slot, index) => (
        <PooledLocalSpotLight
          key={`spot-${index}`}
          castShadow={castPooledShadows}
          slot={slot}
        />
      ))}
    </>
  )
}

function FpsCounter({ onFpsChange }: { onFpsChange: (fps: number) => void }) {
  const frameCountRef = useRef(0)
  const elapsedRef = useRef(0)

  useFrame((_, delta) => {
    frameCountRef.current += 1
    elapsedRef.current += delta

    if (elapsedRef.current < 0.35) {
      return
    }

    onFpsChange(Math.round(frameCountRef.current / elapsedRef.current))
    frameCountRef.current = 0
    elapsedRef.current = 0
  })

  return null
}

function RendererStatsSampler({
  onStatsChange,
}: {
  onStatsChange: (stats: RendererStats) => void
}) {
  const { gl } = useThree()
  const elapsedRef = useRef(0)

  useFrame((_, delta) => {
    elapsedRef.current += delta

    if (elapsedRef.current < 0.35) {
      return
    }

    onStatsChange({
      calls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      programs: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      triangles: gl.info.render.triangles,
    })
    elapsedRef.current = 0
  })

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
  const handlePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
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
  isTransformingRef,
  lookMouseButton,
  movementEnabled,
  navigationLocked,
  pickTargetsRef,
  selectedModelId,
}: {
  enabled: boolean
  headHeightEnabled: boolean
  headHeightY: number
  isTransformingRef: MutableRefObject<boolean>
  lookMouseButton: LookMouseButton
  movementEnabled: boolean
  navigationLocked: boolean
  pickTargetsRef: MutableRefObject<PickTarget[]>
  selectedModelId: string | null
}) {
  const { camera, gl } = useThree()
  const keysRef = useRef(new Set<string>())
  const isShiftPressedRef = useRef(false)
  const isLookingRef = useRef(false)
  const ignoreNextLookMoveRef = useRef(false)
  const navigationModeRef = useRef<WalkNavigationMode>('look')
  const orbitTargetRef = useRef(new Vector3())
  const orbitOffsetRef = useRef(new Vector3())
  const orbitSphericalRef = useRef(new Spherical())
  const pendingLookGestureRef = useRef<LookGesture | null>(null)

  useEffect(() => {
    if (!enabled || navigationLocked) {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      isLookingRef.current = false
      ignoreNextLookMoveRef.current = false
      pendingLookGestureRef.current = null
      return
    }

    if (!movementEnabled) {
      keysRef.current.clear()
      isShiftPressedRef.current = false
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!movementEnabled) {
        return
      }

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
      if (!movementEnabled) {
        return
      }

      keysRef.current.delete(event.code)

      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        isShiftPressedRef.current = false
      }
    }
    const focusCanvas = () => {
      gl.domElement.focus({ preventScroll: true })
    }
    const startLooking = (event: globalThis.PointerEvent) => {
      const lookButton = lookMouseButton === 'left' ? 0 : 2

      if (
        event.button !== lookButton ||
        navigationLocked ||
        isTransformingRef.current
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      focusCanvas()
      navigationModeRef.current = 'look'

      if (event.ctrlKey && selectedModelId) {
        const pickTarget = pickTargetsRef.current.find(
          (target) => target.modelId === selectedModelId,
        )

        if (pickTarget) {
          pickTarget.object.updateWorldMatrix(true, false)
          pickTarget.object.getWorldPosition(orbitTargetRef.current)
          navigationModeRef.current = 'orbit'
        }
      }

      gl.domElement.requestPointerLock()
      pendingLookGestureRef.current = null
      isLookingRef.current = true
      ignoreNextLookMoveRef.current = true
    }
    const maybeLockForLook = (event: globalThis.PointerEvent) => {
      const pendingLookGesture = pendingLookGestureRef.current

      if (
        !pendingLookGesture ||
        pendingLookGesture.pointerId !== event.pointerId ||
        navigationLocked ||
        isTransformingRef.current ||
        document.pointerLockElement === gl.domElement
      ) {
        return
      }

      if (
        event.clientX === pendingLookGesture.x &&
        event.clientY === pendingLookGesture.y
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      gl.domElement.requestPointerLock()
      pendingLookGestureRef.current = null
      isLookingRef.current = true
      ignoreNextLookMoveRef.current = true
    }
    const updateLooking = (event: MouseEvent) => {
      if (!isLookingRef.current || document.pointerLockElement !== gl.domElement) {
        return
      }

      if (ignoreNextLookMoveRef.current) {
        ignoreNextLookMoveRef.current = false
        return
      }

      if (navigationModeRef.current === 'orbit') {
        orbitOffsetRef.current.subVectors(camera.position, orbitTargetRef.current)
        orbitSphericalRef.current.setFromVector3(orbitOffsetRef.current)
        orbitSphericalRef.current.theta -= event.movementX * WALK_LOOK_SENSITIVITY
        orbitSphericalRef.current.phi = Math.max(
          0.05,
          Math.min(
            Math.PI - 0.05,
            orbitSphericalRef.current.phi -
              event.movementY * WALK_LOOK_SENSITIVITY,
          ),
        )
        orbitOffsetRef.current.setFromSpherical(orbitSphericalRef.current)
        camera.position.copy(orbitTargetRef.current).add(orbitOffsetRef.current)
        camera.lookAt(orbitTargetRef.current)
        return
      }

      camera.rotation.order = 'YXZ'
      camera.rotation.y -= event.movementX * WALK_LOOK_SENSITIVITY
      camera.rotation.x = Math.max(
        -WALK_MAX_PITCH_RADIANS,
        Math.min(
          WALK_MAX_PITCH_RADIANS,
          camera.rotation.x - event.movementY * WALK_LOOK_SENSITIVITY,
        ),
      )
      camera.rotation.z = 0
    }
    const stopLooking = () => {
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock()
      }

      isLookingRef.current = false
      ignoreNextLookMoveRef.current = false
      navigationModeRef.current = 'look'
      pendingLookGestureRef.current = null
    }
    const handlePointerLockChange = () => {
      const isLocked = document.pointerLockElement === gl.domElement

      isLookingRef.current = isLocked
      ignoreNextLookMoveRef.current = isLocked
      focusCanvas()

      if (!isLocked) {
        isLookingRef.current = false
        ignoreNextLookMoveRef.current = false
      }
    }
    const handleBlur = () => {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      stopLooking()
    }
    const handleMouseUp = () => {
      pendingLookGestureRef.current = null
      stopLooking()
    }
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }
    const handlePointerPresence = () => {
      if (!isTextEntryElement(document.activeElement)) {
        focusCanvas()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('mousemove', updateLooking)
    window.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    gl.domElement.addEventListener('pointerdown', startLooking, true)
    gl.domElement.addEventListener('pointerenter', handlePointerPresence)
    gl.domElement.addEventListener('pointermove', maybeLockForLook, true)
    gl.domElement.addEventListener('pointermove', handlePointerPresence)
    gl.domElement.addEventListener('contextmenu', handleContextMenu)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('mousemove', updateLooking)
      window.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      gl.domElement.removeEventListener('pointerdown', startLooking, true)
      gl.domElement.removeEventListener('pointerenter', handlePointerPresence)
      gl.domElement.removeEventListener('pointermove', maybeLockForLook, true)
      gl.domElement.removeEventListener('pointermove', handlePointerPresence)
      gl.domElement.removeEventListener('contextmenu', handleContextMenu)
      stopLooking()
    }
  }, [
    camera,
    enabled,
    gl.domElement,
    isTransformingRef,
    lookMouseButton,
    movementEnabled,
    navigationLocked,
    pickTargetsRef,
    selectedModelId,
  ])

  useFrame((_, delta) => {
    if (
      !enabled ||
      !movementEnabled ||
      navigationLocked ||
      keysRef.current.size === 0
    ) {
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

  return null
}

function ModelPicker({
  active,
  isTransformingRef,
  lookMouseButton,
  onClearSelection,
  onSelectModel,
  pickTargetsRef,
}: {
  active: boolean
  isTransformingRef: MutableRefObject<boolean>
  lookMouseButton: LookMouseButton
  onClearSelection: () => void
  onSelectModel: (modelId: string, floorId: string) => void
  pickTargetsRef: MutableRefObject<PickTarget[]>
}) {
  const { camera, gl } = useThree()
  const pickGestureRef = useRef<PickGesture | null>(null)
  const pointer = useMemo(() => new Vector2(), [])
  const raycaster = useMemo(() => new Raycaster(), [])

  useEffect(() => {
    const element = gl.domElement

    const handlePointerDown = (event: PointerEvent) => {
      if (
        !active ||
        event.button !== 0 ||
        lookMouseButton === 'left' ||
        isTransformingRef.current
      ) {
        return
      }

      pickGestureRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const pickGesture = pickGestureRef.current

      pickGestureRef.current = null

      if (
        !active ||
        lookMouseButton === 'left' ||
        isTransformingRef.current ||
        !pickGesture ||
        pickGesture.pointerId !== event.pointerId
      ) {
        return
      }

      if (event.clientX !== pickGesture.x || event.clientY !== pickGesture.y) {
        return
      }

      const bounds = element.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)

      const targets = pickTargetsRef.current
      const hits = raycaster.intersectObjects(
        targets.map((target) => target.object),
        false,
      )
      const hit = hits[0]

      if (!hit) {
        onClearSelection()
        return
      }

      const pickedTarget = targets.find((target) => target.object === hit.object)

      if (pickedTarget) {
        onSelectModel(pickedTarget.modelId, pickedTarget.floorId)
      }
    }

    element.addEventListener('pointerdown', handlePointerDown, true)
    element.addEventListener('pointerup', handlePointerUp, true)

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown, true)
      element.removeEventListener('pointerup', handlePointerUp, true)
    }
  }, [
    camera,
    gl.domElement,
    active,
    isTransformingRef,
    lookMouseButton,
    onClearSelection,
    onSelectModel,
    pickTargetsRef,
    pointer,
    raycaster,
  ])

  return null
}

export function ThreeDView({
  activeFloorId,
  floors,
  onClearSelection,
  onSelectModel,
  onUpdateModel,
  selectedModelId,
  showAllFloors,
  surfaceAssignments,
}: ThreeDViewProps) {
  const [isRenderMenuOpen, setIsRenderMenuOpen] = useState(false)
  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [lookMouseButton, setLookMouseButton] =
    useState<LookMouseButton>('right')
  const [isTransformingModel, setIsTransformingModel] = useState(false)
  const [fps, setFps] = useState(0)
  const [rendererStats, setRendererStats] = useState<RendererStats>({
    calls: 0,
    geometries: 0,
    programs: 0,
    textures: 0,
    triangles: 0,
  })
  const isTransformingModelRef = useRef(false)
  const pickTargetsRef = useRef<PickTarget[]>([])
  const [aspectRatioMode, setAspectRatioMode] =
    useState<AspectRatioMode>('normal')
  const [headHeightEnabled, setHeadHeightEnabled] = useState(false)
  const [localLightLimit, setLocalLightLimit] = useState(FALLBACK_REALTIME_LOCAL_LIGHTS)
  const [localLightIds, setLocalLightIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [lightDirection, setLightDirection] = useState<LightDirection>({
    azimuth: Math.atan2(6, 4),
    elevation: 0.78,
  })
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ambientOcclusion: false,
    daylight: true,
    floorSlabs: true,
    groundPlane: true,
    lightMarkers: false,
    lightShadows: false,
    lights: true,
    nightFill: true,
    referenceFloors: false,
    shadows: true,
    skybox: false,
    wireframe: false,
  })
  const sceneBounds = useMemo(() => getSceneBounds(floors), [floors])
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? null
  const cameraFov = getCameraFov(aspectRatioMode)
  const headHeightY = (activeFloor?.elevation ?? 0) + WALK_HEAD_HEIGHT_METERS
  const floorsByElevation = useMemo(
    () =>
      [...floors].sort(
        (firstFloor, secondFloor) => firstFloor.elevation - secondFloor.elevation,
      ),
    [floors],
  )
  const floorBelowActive = activeFloor
    ? floorsByElevation
        .filter((floor) => floor.elevation < activeFloor.elevation)
        .at(-1) ?? null
    : null
  const renderedFloors = useMemo<RenderedFloorData[]>(
    () =>
      floors.map((floor) => {
        const topology = buildWallTopology(floor.walls)
        const renderedWalls = getRenderedWalls(floor.walls)

        return {
          externalWallPolygons: renderedWalls
            .filter((renderedWall) => renderedWall.wall.kind !== 'internal')
            .map(getWallPolygon),
          floor,
          renderedWalls,
          rooms: topology.rooms,
        }
      }),
    [floors],
  )
  const renderedFloorsById = useMemo(
    () =>
      new Map(
        renderedFloors.map((renderedFloor) => [
          renderedFloor.floor.id,
          renderedFloor,
        ]),
      ),
    [renderedFloors],
  )
  const visibleRenderedFloors = showAllFloors
    ? renderedFloors
    : (renderOptions.referenceFloors
        ? floors.filter(
            (floor) => floor.id === activeFloorId || floor.id === floorBelowActive?.id,
          )
        : floors.filter((floor) => floor.id === activeFloorId)
      )
        .map((floor) => renderedFloorsById.get(floor.id))
        .filter((floor): floor is RenderedFloorData => Boolean(floor))
  const allFloorsPlane = useMemo(
    () =>
      showAllFloors && renderOptions.groundPlane
        ? getFloorsPlaneBounds(visibleRenderedFloors.map((renderedFloor) => renderedFloor.floor))
        : null,
    [renderOptions.groundPlane, showAllFloors, visibleRenderedFloors],
  )
  const lightIndicator = useMemo(() => {
    const scopedFloors = showAllFloors
      ? floors
      : floors.filter((floor) => floor.id === activeFloorId)
    const scopedLightModels = scopedFloors.flatMap((floor) =>
      (floor.models ?? []).filter((model) =>
        Boolean(modelsById.get(model.modelId)?.isLight),
      ),
    )

    return {
      contributing: scopedLightModels.filter(
        (model) => model.lightEnabled !== false && localLightIds.has(model.id),
      ).length,
      total: scopedLightModels.length,
    }
  }, [activeFloorId, floors, localLightIds, showAllFloors])
  const transformEnabled = true
  const navigationLocked = isTransformingModel

  const updateRenderOption = (option: keyof RenderOptions) => {
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      [option]: !currentOptions[option],
    }))
  }
  const setTransformingModel = useCallback((isTransforming: boolean) => {
    isTransformingModelRef.current = isTransforming
    setIsTransformingModel(isTransforming)
  }, [])
  const updateFps = useCallback((nextFps: number) => {
    setFps((currentFps) => (currentFps === nextFps ? currentFps : nextFps))
  }, [])
  const updateRendererStats = useCallback((nextStats: RendererStats) => {
    setRendererStats((currentStats) =>
      currentStats.calls === nextStats.calls &&
      currentStats.geometries === nextStats.geometries &&
      currentStats.programs === nextStats.programs &&
      currentStats.textures === nextStats.textures &&
      currentStats.triangles === nextStats.triangles
        ? currentStats
        : nextStats,
    )
  }, [])
  const updateLocalLightIds = useCallback((nextLightIds: ReadonlySet<string>) => {
    setLocalLightIds((currentLightIds) =>
      setIdsEqual(currentLightIds, nextLightIds) ? currentLightIds : nextLightIds,
    )
  }, [])
  const updateLocalLightLimit = useCallback((nextLightLimit: number) => {
    setLocalLightLimit((currentLightLimit) =>
      currentLightLimit === nextLightLimit ? currentLightLimit : nextLightLimit,
    )
  }, [])
  const registerPickTarget = useCallback((target: PickTarget) => {
    pickTargetsRef.current = [...pickTargetsRef.current, target]

    return () => {
      pickTargetsRef.current = pickTargetsRef.current.filter(
        (candidateTarget) => candidateTarget.object !== target.object,
      )
    }
  }, [])

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>3D View</h2>
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
          <div className="segmented-control compact" aria-label="3D transform mode">
            <button
              type="button"
              className={transformMode === 'translate' ? 'active' : ''}
              onClick={() => setTransformMode('translate')}
            >
              Move
            </button>
            <button
              type="button"
              className={transformMode === 'rotate' ? 'active' : ''}
              onClick={() => setTransformMode('rotate')}
            >
              Rotate
            </button>
            <button
              type="button"
              className={transformMode === 'scale' ? 'active' : ''}
              onClick={() => setTransformMode('scale')}
            >
              Scale
            </button>
          </div>
          <div className="segmented-control compact" aria-label="Look mouse button">
            <button
              type="button"
              className={lookMouseButton === 'left' ? 'active' : ''}
              onClick={() => setLookMouseButton('left')}
            >
              Left
            </button>
            <button
              type="button"
              className={lookMouseButton === 'right' ? 'active' : ''}
              onClick={() => setLookMouseButton('right')}
            >
              Right
            </button>
          </div>
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
                    checked={renderOptions.daylight}
                    onChange={() => updateRenderOption('daylight')}
                  />
                  Daylight
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.nightFill}
                    onChange={() => updateRenderOption('nightFill')}
                  />
                  Night fill
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lights}
                    onChange={() => updateRenderOption('lights')}
                  />
                  Lights
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lightShadows}
                    onChange={() => updateRenderOption('lightShadows')}
                  />
                  Light shadows
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lightMarkers}
                    onChange={() => updateRenderOption('lightMarkers')}
                  />
                  Light markers
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
          dpr={renderOptions.ambientOcclusion ? 1 : [1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          tabIndex={0}
        >
          <ModelPicker
            active
            isTransformingRef={isTransformingModelRef}
            lookMouseButton={lookMouseButton}
            onClearSelection={onClearSelection}
            onSelectModel={onSelectModel}
            pickTargetsRef={pickTargetsRef}
          />
          <FpsCounter onFpsChange={updateFps} />
          <RendererStatsSampler onStatsChange={updateRendererStats} />
          <CameraFovController fov={cameraFov} />
            <RendererLightCapabilities
              onLocalLightLimitChange={updateLocalLightLimit}
            />
            <LocalLightBudgetController
              activeFloorId={activeFloorId}
              enabled={renderOptions.lights}
              localLightLimit={localLightLimit}
              onLocalLightIdsChange={updateLocalLightIds}
              selectedModelId={selectedModelId}
              visibleRenderedFloors={visibleRenderedFloors}
            />
            <color
              attach="background"
              args={[renderOptions.daylight ? '#eef2f7' : '#020617']}
            />
            {renderOptions.daylight && renderOptions.skybox ? (
              <CountrysideSkybox />
            ) : null}
            <ambientLight
              intensity={
                renderOptions.daylight
                  ? 0.55
                  : renderOptions.nightFill
                    ? 0.14
                    : 0
              }
            />
            <SunLight
              enabled={renderOptions.daylight}
              lightDirection={lightDirection}
              sceneBounds={sceneBounds}
              shadows={renderOptions.shadows}
            />
            <FixedLocalLightPool
              activeFloorId={activeFloorId}
              localLightIds={localLightIds}
              lightShadowsEnabled={renderOptions.lightShadows}
              shadowsEnabled={renderOptions.shadows}
              visibleRenderedFloors={visibleRenderedFloors}
            />

            {allFloorsPlane ? (
              <>
                <GroundGrid floorPlane={allFloorsPlane} isActive />
                <mesh
                  position={[
                    allFloorsPlane.centerX,
                    -0.01,
                    allFloorsPlane.centerZ,
                  ]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  receiveShadow={renderOptions.shadows}
                  renderOrder={0}
                >
                  <planeGeometry args={[allFloorsPlane.size, allFloorsPlane.size]} />
                  <meshStandardMaterial
                    color="#f8fafc"
                    depthWrite
                    wireframe={renderOptions.wireframe}
                  />
                </mesh>
              </>
            ) : null}

            {visibleRenderedFloors.map((renderedFloor) => {
              const { floor, renderedWalls, externalWallPolygons, rooms } = renderedFloor
              const isActive = floor.id === activeFloorId
              const slabIsSolid = floor.id === floorBelowActive?.id
              const floorIndex = floorsByElevation.findIndex(
                (candidateFloor) => candidateFloor.id === floor.id,
              )
              const upperFloor =
                floorIndex >= 0 ? floorsByElevation[floorIndex + 1] ?? null : null
              const hasShadowSurface = renderOptions.shadows && isActive
              const floorPlane =
                renderOptions.groundPlane && !showAllFloors && isActive
                  ? getFloorPlaneBounds(floor)
                  : null
              const shouldRenderSlab =
                !showAllFloors &&
                renderOptions.floorSlabs &&
                (floor.id === activeFloorId || floor.id === floorBelowActive?.id)

              if (showAllFloors) {
                return (
                  <group key={floor.id}>
                    <FloorRenderBoundary floorId={floor.id}>
                      {renderOptions.floorSlabs ? (
                        <FloorSlab
                          floor={floor}
                          floors={floors}
                          isSolid
                          upperFloor={upperFloor}
                          wireframe={renderOptions.wireframe}
                        />
                      ) : null}
                      <RoomFloorFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        wireframe={renderOptions.wireframe}
                      />
                      <RoomCeilingFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        roomHeight={floor.roomHeight}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        wireframe={renderOptions.wireframe}
                      />
                      <SolidFloorScene
                        daylightEnabled={renderOptions.daylight}
                        floor={floor}
                        isSelectedModel={(modelId) => modelId === selectedModelId}
                        lightMarkersVisible={renderOptions.lightMarkers}
                        onRegisterPickTarget={registerPickTarget}
                        onTransformActiveChange={setTransformingModel}
                        onUpdateModel={onUpdateModel}
                        pickTargetsRef={pickTargetsRef}
                        renderedWalls={renderedWalls}
                        rooms={rooms}
                        shadowsEnabled={renderOptions.shadows}
                        surfaceAssignments={surfaceAssignments}
                        transformEnabled={transformEnabled}
                        transformMode={transformMode}
                        wallPolygons={externalWallPolygons}
                        wireframe={renderOptions.wireframe}
                      />
                    </FloorRenderBoundary>
                  </group>
                )
              }

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
                  {isActive ? (
                    <>
                      <RoomFloorFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        wireframe={renderOptions.wireframe}
                      />
                      <RoomCeilingFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        roomHeight={floor.roomHeight}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        wireframe={renderOptions.wireframe}
                      />
                    </>
                  ) : null}
                  {renderedWalls.map((renderedWall) => (
                    <WallMesh
                      key={renderedWall.wall.id}
                      castsShadow={hasShadowSurface}
                      elevation={floor.elevation}
                      externalWallPolygons={externalWallPolygons}
                      isActive={isActive}
                      renderedWall={renderedWall}
                      surfaceAssignments={surfaceAssignments}
                      wireframe={renderOptions.wireframe}
                    />
                  ))}
                  {isActive ? (
                    <SkirtingBoards
                      elevation={floor.elevation}
                      models={floor.models ?? []}
                      renderedWalls={renderedWalls}
                      rooms={rooms}
                      wireframe={renderOptions.wireframe}
                    />
                  ) : null}
                  {isActive ? (
                    <Suspense fallback={null}>
                      {(floor.models ?? []).map((model) => (
                        <ModelLoadBoundary key={model.id}>
                          <ModelMesh
                            daylightEnabled={renderOptions.daylight}
                            elevation={floor.elevation}
                            floorId={floor.id}
                            isActive={isActive}
                            isSelected={model.id === selectedModelId}
                            lightMarkersVisible={renderOptions.lightMarkers}
                            model={model}
                            pickTargetsRef={pickTargetsRef}
                            onRegisterPickTarget={registerPickTarget}
                            onTransformActiveChange={setTransformingModel}
                            onUpdateModel={onUpdateModel}
                            shadowsEnabled={renderOptions.shadows}
                            transformEnabled={transformEnabled}
                            transformMode={transformMode}
                            walls={floor.walls}
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
              enabled={!navigationLocked}
              headHeightEnabled={headHeightEnabled}
              headHeightY={headHeightY}
              isTransformingRef={isTransformingModelRef}
              lookMouseButton={lookMouseButton}
              movementEnabled
              navigationLocked={navigationLocked}
              pickTargetsRef={pickTargetsRef}
              selectedModelId={selectedModelId}
            />
            {renderOptions.ambientOcclusion ? (
              <EffectComposer
                multisampling={0}
                resolutionScale={0.75}
              >
                <N8AO
                  aoRadius={0.75}
                  distanceFalloff={0.45}
                  intensity={2.6}
                  quality="low"
                  aoSamples={8}
                  denoiseSamples={2}
                  denoiseRadius={4}
                  color={ambientOcclusionColor}
                />
              </EffectComposer>
            ) : null}
        </Canvas>
        <div className="viewport-indicators">
          <div className="viewport-indicator" aria-label="3D frames per second">
            {fps > 0 ? fps : '--'} FPS
          </div>
          <div className="viewport-indicator" aria-label="Contributing lights">
            {lightIndicator.contributing}/{lightIndicator.total} lights
          </div>
          <div className="viewport-indicator" aria-label="Compiled shader programs">
            {rendererStats.programs} shaders
          </div>
          <div className="viewport-indicator" aria-label="3D draw calls">
            {rendererStats.calls} calls
          </div>
          <div className="viewport-indicator" aria-label="3D scene resources">
            {rendererStats.geometries} geo / {rendererStats.textures} tex
          </div>
          <div className="viewport-indicator" aria-label="3D rendered triangles">
            {rendererStats.triangles.toLocaleString()} tris
          </div>
        </div>
        <LightGimbal
          lightDirection={lightDirection}
          onLightDirectionChange={setLightDirection}
        />
      </div>
    </section>
  )
}
