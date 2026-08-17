import { Fragment, useEffect, useRef, useState } from 'react'
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { FloorLevel, Point, Wall } from '../types'
import { getRenderedWalls, getWallPolygon } from '../wallGeometry'

const METERS_TO_PIXELS = 60
const MIN_WALL_LENGTH_METERS = 0.15
const CONNECTION_SNAP_METERS = 0.25
const ALIGNMENT_GUIDE_TOLERANCE_METERS = 0.5
const DIMENSION_OFFSET_METERS = 0.28
const DIMENSION_TICK_METERS = 0.1
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.8
const ZOOM_STEP = 1.2
const ANGLE_WIDGET_RADIUS_METERS = 0.65

type FloorplanCanvasProps = {
  activeFloor: FloorLevel
  floors: FloorLevel[]
  isAddingWall: boolean
  selectedWallId: string | null
  onAddWall: (wall: { start: Point; end: Point }) => void
  onDeleteWall: (wallId: string) => void
  onExitAddWall: () => void
  onSelectWall: (wallId: string | null) => void
}

type CanvasSize = {
  width: number
  height: number
}

type Viewport = {
  x: number
  y: number
  scale: number
}

type ContextMenuState = {
  wallId: string
  x: number
  y: number
}

type PanState = {
  clientX: number
  clientY: number
}

type SnapTarget = {
  point: Point
  kind: 'endpoint' | 'junction'
}

type EndpointGuide = {
  endpoint: Point
  projection: Point
  distance: number
  crossDistance: number
}

type Axis = 'horizontal' | 'vertical'
type AlignmentAxis = 'x' | 'y'

type AlignmentGuide = EndpointGuide & {
  axis: AlignmentAxis
}

type DimensionGuide = {
  start: Point
  end: Point
  labelPoint: Point
  text: string
  rotation: number
}

type AngleWidget = {
  arcPoints: number[]
  baselineEnd: Point
  labelPoint: Point
  label: string
}

function toCanvasPoint(point: Point): Point {
  return {
    x: point.x * METERS_TO_PIXELS,
    y: point.y * METERS_TO_PIXELS,
  }
}

function toPlanPoint(point: Point): Point {
  return {
    x: point.x / METERS_TO_PIXELS,
    y: point.y / METERS_TO_PIXELS,
  }
}

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function parseLengthInput(value: string) {
  const length = Number.parseFloat(value)
  return Number.isFinite(length) && length > 0 ? length : null
}

function parseAngleInput(value: string) {
  const angle = Number.parseFloat(value)
  return Number.isFinite(angle) ? angle : null
}

function getAngleDegrees(start: Point, end: Point) {
  return (normalizeAngle(Math.atan2(end.y - start.y, end.x - start.x)) * 180) /
    Math.PI
}

function applyLengthAndAngle(
  start: Point,
  pointerEnd: Point,
  lengthInput: string | null,
  angleInput: string | null,
) {
  const typedLength = parseLengthInput(lengthInput ?? '')
  const typedAngle = parseAngleInput(angleInput ?? '')
  const length = typedLength ?? distance(start, pointerEnd)
  const angle = ((typedAngle ?? getAngleDegrees(start, pointerEnd)) * Math.PI) / 180

  return {
    x: start.x + Math.cos(angle) * length,
    y: start.y + Math.sin(angle) * length,
  }
}

function normalize(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return { x: dx / length, y: dy / length }
}

function getEndpointDirectionFrom(endpoint: Point, wall: Wall): Point | null {
  if (distance(endpoint, wall.start) <= CONNECTION_SNAP_METERS) {
    return normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  }

  if (distance(endpoint, wall.end) <= CONNECTION_SNAP_METERS) {
    return normalize(wall.start.x - wall.end.x, wall.start.y - wall.end.y)
  }

  return null
}

function getFaceContinuation(
  wall: Wall,
  endpoint: 'start' | 'end',
  side: -1 | 1,
  walls: Wall[],
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const centerlineDirection = normalize(dx, dy)
  const directionAwayFromEndpoint =
    endpoint === 'start'
      ? centerlineDirection
      : { x: -centerlineDirection.x, y: -centerlineDirection.y }
  const faceNormal = {
    x: -centerlineDirection.y * side,
    y: centerlineDirection.x * side,
  }
  const endpointPoint = endpoint === 'start' ? wall.start : wall.end
  let continuation = 0

  for (const otherWall of walls) {
    if (otherWall.id === wall.id) {
      continue
    }

    const otherDirection = getEndpointDirectionFrom(endpointPoint, otherWall)
    if (!otherDirection) {
      continue
    }

    const cross =
      directionAwayFromEndpoint.x * otherDirection.y -
      directionAwayFromEndpoint.y * otherDirection.x

    if (Math.abs(cross) < 0.08) {
      continue
    }

    const adjacentHalfThickness = otherWall.thickness / 2
    const otherWallGoesTowardFace =
      otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0
    const sideContinuation = otherWallGoesTowardFace
      ? -adjacentHalfThickness
      : adjacentHalfThickness

    if (Math.abs(sideContinuation) > Math.abs(continuation)) {
      continuation = sideContinuation
    }
  }

  return continuation
}

function getDimensionGuides(wall: Wall, walls: Wall[]): DimensionGuide[] {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const centerlineLength = Math.hypot(dx, dy)

  if (centerlineLength === 0) {
    return []
  }

  const unitX = dx / centerlineLength
  const unitY = dy / centerlineLength
  const normalX = -unitY
  const normalY = unitX
  const offset = wall.thickness / 2 + DIMENSION_OFFSET_METERS
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI

  return ([-1, 1] as const).map((side) => {
    const startContinuation = getFaceContinuation(wall, 'start', side, walls)
    const endContinuation = getFaceContinuation(wall, 'end', side, walls)
    const faceStart = {
      x: wall.start.x - unitX * startContinuation,
      y: wall.start.y - unitY * startContinuation,
    }
    const faceEnd = {
      x: wall.end.x + unitX * endContinuation,
      y: wall.end.y + unitY * endContinuation,
    }
    const offsetX = normalX * offset * side
    const offsetY = normalY * offset * side
    const visibleLength = distance(faceStart, faceEnd)

    return {
      start: {
        x: faceStart.x + offsetX,
        y: faceStart.y + offsetY,
      },
      end: {
        x: faceEnd.x + offsetX,
        y: faceEnd.y + offsetY,
      },
      labelPoint: {
        x: (faceStart.x + faceEnd.x) / 2 + offsetX,
        y: (faceStart.y + faceEnd.y) / 2 + offsetY,
      },
      text: `${visibleLength.toFixed(2)} m`,
      rotation,
    }
  })
}

function getDimensionTick(point: Point, wall: Wall): [Point, Point] {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return [point, point]
  }

  const normalX = -dy / length
  const normalY = dx / length

  return [
    {
      x: point.x - normalX * DIMENSION_TICK_METERS,
      y: point.y - normalY * DIMENSION_TICK_METERS,
    },
    {
      x: point.x + normalX * DIMENSION_TICK_METERS,
      y: point.y + normalY * DIMENSION_TICK_METERS,
    },
  ]
}

function snapToAxis(start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: end.x, y: start.y }
  }

  return { x: start.x, y: end.y }
}

function getDraftAxis(start: Point, end: Point): Axis {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? 'horizontal'
    : 'vertical'
}

function normalizeAngle(angle: number) {
  return angle < 0 ? angle + Math.PI * 2 : angle
}

function getAngleWidget(start: Point, end: Point): AngleWidget | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const wallLength = Math.hypot(dx, dy)

  if (wallLength < MIN_WALL_LENGTH_METERS) {
    return null
  }

  const angle = normalizeAngle(Math.atan2(dy, dx))
  const steps = Math.max(8, Math.ceil((angle / (Math.PI * 2)) * 48))
  const arcPoints = Array.from({ length: steps + 1 }, (_, index) => {
    const stepAngle = (angle * index) / steps
    return [
      (start.x + Math.cos(stepAngle) * ANGLE_WIDGET_RADIUS_METERS) *
        METERS_TO_PIXELS,
      (start.y + Math.sin(stepAngle) * ANGLE_WIDGET_RADIUS_METERS) *
        METERS_TO_PIXELS,
    ]
  }).flat()
  const labelAngle = angle / 2

  return {
    arcPoints,
    baselineEnd: {
      x: start.x + ANGLE_WIDGET_RADIUS_METERS,
      y: start.y,
    },
    labelPoint: {
      x: start.x + Math.cos(labelAngle) * (ANGLE_WIDGET_RADIUS_METERS + 0.28),
      y: start.y + Math.sin(labelAngle) * (ANGLE_WIDGET_RADIUS_METERS + 0.28),
    },
    label: `${Math.round((angle * 180) / Math.PI)}°`,
  }
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

function getSnapTarget(point: Point, walls: Wall[]): SnapTarget | null {
  let closestTarget: SnapTarget | null = null
  let closestDistance = CONNECTION_SNAP_METERS

  for (const wall of walls) {
    const candidates: SnapTarget[] = [
      { point: wall.start, kind: 'endpoint' },
      { point: wall.end, kind: 'endpoint' },
      {
        point: getClosestPointOnSegment(point, wall.start, wall.end),
        kind: 'junction',
      },
    ]

    for (const candidate of candidates) {
      const candidateDistance = distance(point, candidate.point)

      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance
        closestTarget = candidate
      }
    }
  }

  return closestTarget
}

function snapToConnection(point: Point, walls: Wall[]): Point {
  return getSnapTarget(point, walls)?.point ?? point
}

function getClosestAlignmentGuide(
  point: Point,
  walls: Wall[],
  preferredAxis?: AlignmentAxis,
): AlignmentGuide | null {
  let closestGuide: AlignmentGuide | null = null
  let closestDistance = ALIGNMENT_GUIDE_TOLERANCE_METERS

  for (const endpoint of walls.flatMap((wall) => [wall.start, wall.end])) {
    const candidates: AlignmentGuide[] = [
      {
        axis: 'x',
        endpoint,
        projection: { x: endpoint.x, y: point.y },
        distance: Math.abs(endpoint.x - point.x),
        crossDistance: Math.abs(endpoint.y - point.y),
      },
      {
        axis: 'y',
        endpoint,
        projection: { x: point.x, y: endpoint.y },
        distance: Math.abs(endpoint.y - point.y),
        crossDistance: Math.abs(endpoint.x - point.x),
      },
    ]

    for (const candidate of candidates) {
      if (preferredAxis && candidate.axis !== preferredAxis) {
        continue
      }

      const closestScore = closestGuide
        ? closestGuide.distance * 2 + closestGuide.crossDistance
        : Number.POSITIVE_INFINITY
      const candidateScore = candidate.distance * 2 + candidate.crossDistance

      if (candidate.distance <= closestDistance && candidateScore < closestScore) {
        closestDistance = candidate.distance
        closestGuide = candidate
      }
    }
  }

  return closestGuide
}

function applyAlignmentGuide(point: Point, guide: AlignmentGuide | null): Point {
  return guide?.projection ?? point
}

function snapToAxisEndpoint(point: Point, axis: Axis, walls: Wall[]): Point {
  const guide = getClosestAlignmentGuide(
    point,
    walls,
    axis === 'horizontal' ? 'x' : 'y',
  )

  return applyAlignmentGuide(point, guide)
}

function getClosestEndpointGuides(
  point: Point,
  axis: Axis,
  walls: Wall[],
): EndpointGuide[] {
  return walls
    .flatMap((wall) => [wall.start, wall.end])
    .map((endpoint) => ({
      endpoint,
      projection:
        axis === 'horizontal'
          ? { x: endpoint.x, y: point.y }
          : { x: point.x, y: endpoint.y },
      distance:
        axis === 'horizontal'
          ? Math.abs(endpoint.x - point.x)
          : Math.abs(endpoint.y - point.y),
      crossDistance:
        axis === 'horizontal'
          ? Math.abs(endpoint.y - point.y)
          : Math.abs(endpoint.x - point.x),
    }))
    .filter((guide) => {
      return (
        guide.distance > 0.02 &&
        guide.distance <= ALIGNMENT_GUIDE_TOLERANCE_METERS
      )
    })
    .sort((a, b) => a.distance * 2 + a.crossDistance - (b.distance * 2 + b.crossDistance))
    .slice(0, 2)
}

export function FloorplanCanvas({
  activeFloor,
  floors,
  isAddingWall,
  selectedWallId,
  onAddWall,
  onDeleteWall,
  onExitAddWall,
  onSelectWall,
}: FloorplanCanvasProps) {
  const walls = activeFloor.walls
  const snapWalls = floors.flatMap((floor) => floor.walls)
  const referenceFloors = floors.filter((floor) => floor.id !== activeFloor.id)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<CanvasSize>({ width: 600, height: 600 })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [draftWall, setDraftWall] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [hoverSnapTarget, setHoverSnapTarget] = useState<SnapTarget | null>(null)
  const [hoverAlignmentGuide, setHoverAlignmentGuide] =
    useState<AlignmentGuide | null>(null)
  const [draftLengthInput, setDraftLengthInput] = useState<string | null>(null)
  const [draftAngleInput, setDraftAngleInput] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isSnapSuppressed, setIsSnapSuppressed] = useState(false)
  const [isMiddlePanning, setIsMiddlePanning] = useState(false)
  const [isAxisLocked, setIsAxisLocked] = useState(false)
  const lengthInputRef = useRef<HTMLInputElement>(null)
  const middlePanRef = useRef<PanState | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const input = lengthInputRef.current
    if (draftLengthInput !== null && input && document.activeElement !== input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }, [draftLengthInput])

  useEffect(() => {
    const typedLength = parseLengthInput(draftLengthInput ?? '')
    const typedAngle = parseAngleInput(draftAngleInput ?? '')
    if (!typedLength && typedAngle === null) {
      return
    }

    setDraftWall((currentDraftWall) =>
      currentDraftWall
        ? {
            ...currentDraftWall,
            end: applyLengthAndAngle(
              currentDraftWall.start,
              currentDraftWall.end,
              draftLengthInput,
              draftAngleInput,
            ),
          }
        : currentDraftWall,
    )
  }, [draftLengthInput, draftAngleInput])

  useEffect(() => {
    if (!isAddingWall) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      resetDraftWall()
      onExitAddWall()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isAddingWall, onExitAddWall])

  useEffect(() => {
    if (!draftWall || !isAddingWall) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) {
        return
      }

      const isLengthKey = /^\d$/.test(event.key) || event.key === '.'

      if (!isLengthKey && event.key !== 'Backspace' && event.key !== 'Enter' && event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      if (event.key === 'Escape') {
        resetDraftWall()
        onExitAddWall()
        return
      }

      if (event.key === 'Enter') {
        if (distance(draftWall.start, draftWall.end) >= MIN_WALL_LENGTH_METERS) {
          onAddWall(draftWall)
        }

        resetDraftWall()
        return
      }

      setDraftLengthInput((currentValue) => {
        if (event.key === 'Backspace') {
          return currentValue ? currentValue.slice(0, -1) : ''
        }

        if (event.key === '.' && currentValue?.includes('.')) {
          return currentValue ?? ''
        }

        return `${currentValue ?? ''}${event.key}`
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draftWall, isAddingWall, onAddWall, onExitAddWall])

  const getPointerPoint = (event: KonvaEventObject<PointerEvent>) => {
    const point = event.target.getStage()?.getPointerPosition()
    return point
      ? toPlanPoint({
          x: (point.x - viewport.x) / viewport.scale,
          y: (point.y - viewport.y) / viewport.scale,
        })
      : null
  }

  const resetDraftWall = () => {
    setDraftWall(null)
    setHoverSnapTarget(null)
    setHoverAlignmentGuide(null)
    setDraftLengthInput(null)
    setDraftAngleInput(null)
    setIsSnapSuppressed(false)
    setIsAxisLocked(false)
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const openWallContextMenu = (
    wallId: string,
    event: KonvaEventObject<PointerEvent>,
  ) => {
    event.evt.preventDefault()
    const containerBounds = containerRef.current?.getBoundingClientRect()

    if (!containerBounds) {
      return
    }

    onSelectWall(wallId)
    setContextMenu({
      wallId,
      x: event.evt.clientX - containerBounds.left,
      y: event.evt.clientY - containerBounds.top,
    })
  }

  const stopMiddlePan = () => {
    middlePanRef.current = null
    setIsMiddlePanning(false)
  }

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    closeContextMenu()

    if (event.evt.button === 1) {
      event.evt.preventDefault()
      middlePanRef.current = {
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
      }
      setIsMiddlePanning(true)
      return
    }

    if (event.evt.button === 2) {
      event.evt.preventDefault()
      return
    }

    if (!isAddingWall) {
      if (event.target === event.target.getStage()) {
        onSelectWall(null)
      }

      return
    }

    if (draftWall) {
      const point = getPointerPoint(event)
      const wallToAdd = point
        ? (() => {
            const axis = getDraftAxis(draftWall.start, point)
            const axisPoint = event.evt.ctrlKey ? snapToAxis(draftWall.start, point) : point
            const alignmentGuide = event.evt.shiftKey
              ? null
              : getClosestAlignmentGuide(
                  axisPoint,
                  snapWalls,
                  axis === 'horizontal' ? 'x' : 'y',
                )
            const alignedPoint = applyAlignmentGuide(axisPoint, alignmentGuide)
            const snappedPoint = event.evt.shiftKey
              ? alignedPoint
              : snapToConnection(alignedPoint, snapWalls)

            return {
              ...draftWall,
              end: (() => {
                const pointerEnd = event.evt.ctrlKey
                  ? event.evt.shiftKey
                    ? alignedPoint
                    : snapToAxisEndpoint(alignedPoint, axis, snapWalls)
                  : snappedPoint
                const typedLength = parseLengthInput(draftLengthInput ?? '')
                const typedAngle = parseAngleInput(draftAngleInput ?? '')

                return typedLength || typedAngle !== null
                  ? applyLengthAndAngle(
                      draftWall.start,
                      pointerEnd,
                      draftLengthInput,
                      draftAngleInput,
                    )
                  : pointerEnd
              })(),
            }
          })()
        : draftWall

      if (distance(wallToAdd.start, wallToAdd.end) >= MIN_WALL_LENGTH_METERS) {
        onAddWall(wallToAdd)
      }

      resetDraftWall()
      return
    }

    const point = getPointerPoint(event)
    if (point) {
      const alignmentGuide = hoverAlignmentGuide ?? getClosestAlignmentGuide(point, snapWalls)
      const alignedPoint = applyAlignmentGuide(point, alignmentGuide)
      const snappedPoint = snapToConnection(alignedPoint, snapWalls)
      setDraftWall({ start: snappedPoint, end: snappedPoint })
      setHoverAlignmentGuide(alignmentGuide)
    }
  }

  const handlePointerMove = (event: KonvaEventObject<PointerEvent>) => {
    if (middlePanRef.current) {
      event.evt.preventDefault()

      const deltaX = event.evt.clientX - middlePanRef.current.clientX
      const deltaY = event.evt.clientY - middlePanRef.current.clientY

      middlePanRef.current = {
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
      }
      setViewport((currentViewport) => ({
        ...currentViewport,
        x: currentViewport.x + deltaX,
        y: currentViewport.y + deltaY,
      }))
      return
    }

    if (!isAddingWall) {
      setHoverSnapTarget(null)
      setHoverAlignmentGuide(null)
      setIsSnapSuppressed(false)
      setIsAxisLocked(false)
      return
    }

    const point = getPointerPoint(event)
    if (!point) {
      return
    }

    if (!draftWall) {
      setHoverSnapTarget(getSnapTarget(point, snapWalls))
      setHoverAlignmentGuide(getClosestAlignmentGuide(point, snapWalls))
      return
    }

    const axis = getDraftAxis(draftWall.start, point)
    const axisPoint = event.evt.ctrlKey ? snapToAxis(draftWall.start, point) : point
    setIsAxisLocked(event.evt.ctrlKey)
    setIsSnapSuppressed(event.evt.shiftKey)
    const alignmentGuide = event.evt.shiftKey
      ? null
      : getClosestAlignmentGuide(
          axisPoint,
          snapWalls,
          axis === 'horizontal' ? 'x' : 'y',
        )
    const alignedPoint = applyAlignmentGuide(axisPoint, alignmentGuide)
    const snappedPoint = event.evt.shiftKey
      ? alignedPoint
      : snapToConnection(alignedPoint, snapWalls)
    setHoverSnapTarget(event.evt.shiftKey ? null : getSnapTarget(snappedPoint, snapWalls))
    setHoverAlignmentGuide(alignmentGuide)
    setDraftWall({
      ...draftWall,
      end: (() => {
        const pointerEnd = event.evt.ctrlKey
          ? event.evt.shiftKey
            ? alignedPoint
            : snapToAxisEndpoint(alignedPoint, axis, snapWalls)
          : snappedPoint
        const typedLength = parseLengthInput(draftLengthInput ?? '')
        const typedAngle = parseAngleInput(draftAngleInput ?? '')

        return typedLength || typedAngle !== null
          ? applyLengthAndAngle(
              draftWall.start,
              pointerEnd,
              draftLengthInput,
              draftAngleInput,
            )
          : pointerEnd
      })(),
    })
  }

  const zoomAroundPoint = (point: Point, nextScale: number) => {
    setViewport((currentViewport) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale))
      const logicalPoint = {
        x: (point.x - currentViewport.x) / currentViewport.scale,
        y: (point.y - currentViewport.y) / currentViewport.scale,
      }

      return {
        scale,
        x: point.x - logicalPoint.x * scale,
        y: point.y - logicalPoint.y * scale,
      }
    })
  }

  const zoomAtCenter = (factor: number) => {
    zoomAroundPoint(
      { x: size.width / 2, y: size.height / 2 },
      viewport.scale * factor,
    )
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const point = event.target.getStage()?.getPointerPosition()
    if (!point) {
      return
    }

    zoomAroundPoint(
      point,
      event.evt.deltaY > 0
        ? viewport.scale / ZOOM_STEP
        : viewport.scale * ZOOM_STEP,
    )
  }

  const visibleBounds = {
    left: -viewport.x / viewport.scale,
    top: -viewport.y / viewport.scale,
    right: (size.width - viewport.x) / viewport.scale,
    bottom: (size.height - viewport.y) / viewport.scale,
  }
  const firstGridX =
    Math.floor(visibleBounds.left / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const lastGridX =
    Math.ceil(visibleBounds.right / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const firstGridY =
    Math.floor(visibleBounds.top / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const lastGridY =
    Math.ceil(visibleBounds.bottom / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const verticalGridLines = Array.from(
    { length: Math.max(0, Math.round((lastGridX - firstGridX) / METERS_TO_PIXELS) + 1) },
    (_, index) => firstGridX + index * METERS_TO_PIXELS,
  )
  const horizontalGridLines = Array.from(
    { length: Math.max(0, Math.round((lastGridY - firstGridY) / METERS_TO_PIXELS) + 1) },
    (_, index) => firstGridY + index * METERS_TO_PIXELS,
  )
  const renderedWalls = getRenderedWalls(walls)
  const draftAxis = draftWall ? getDraftAxis(draftWall.start, draftWall.end) : null
  const endpointGuides =
    draftWall && draftAxis && !isSnapSuppressed
      ? getClosestEndpointGuides(draftWall.end, draftAxis, snapWalls)
      : []
  const draftWallLength = draftWall ? distance(draftWall.start, draftWall.end) : null
  const angleWidget =
    draftWall && !isAxisLocked ? getAngleWidget(draftWall.start, draftWall.end) : null
  const draftWallMidpoint = draftWall
    ? toCanvasPoint({
        x: (draftWall.start.x + draftWall.end.x) / 2,
        y: (draftWall.start.y + draftWall.end.y) / 2,
      })
    : null
  const draftLengthPanelPosition = draftWallMidpoint
    ? {
        left: draftWallMidpoint.x * viewport.scale + viewport.x,
        top: draftWallMidpoint.y * viewport.scale + viewport.y,
      }
    : null
  const draftAngleDisplay = draftWall
    ? draftAngleInput ?? Math.round(getAngleDegrees(draftWall.start, draftWall.end)).toString()
    : ''

  const updateDraftLength = (value: string) => {
    setDraftLengthInput(value)
  }

  const updateDraftAngle = (value: string) => {
    setDraftAngleInput(value)
  }

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>2D Floorplan</h2>
        <span>
          {isAddingWall
            ? draftWall
              ? 'Move pointer, click to finish'
              : 'Click to start wall'
            : 'Select Add Wall'}
        </span>
        <div className="zoom-controls" aria-label="2D zoom controls">
          <button type="button" onClick={() => zoomAtCenter(1 / ZOOM_STEP)}>
            -
          </button>
          <button
            type="button"
            onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button type="button" onClick={() => zoomAtCenter(ZOOM_STEP)}>
            +
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={isMiddlePanning ? 'canvas-host panning' : 'canvas-host'}
      >
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable={!isAddingWall && !draftWall && !isMiddlePanning}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => {
            if (event.evt.button === 1 || middlePanRef.current) {
              stopMiddlePan()
            }
          }}
          onDragMove={(event) => {
            setViewport((currentViewport) => ({
              ...currentViewport,
              x: event.target.x(),
              y: event.target.y(),
            }))
          }}
          onWheel={handleWheel}
          onPointerLeave={() => {
            if (middlePanRef.current) {
              stopMiddlePan()
            }

            if (!draftWall) {
              setHoverSnapTarget(null)
              setHoverAlignmentGuide(null)
            }
          }}
        >
          <Layer>
            <Rect
              x={visibleBounds.left}
              y={visibleBounds.top}
              width={visibleBounds.right - visibleBounds.left}
              height={visibleBounds.bottom - visibleBounds.top}
              fill="#f8fafc"
            />
            {verticalGridLines.map((position) => (
              <Line
                key={`vertical-${position}`}
                points={[position, visibleBounds.top, position, visibleBounds.bottom]}
                stroke="#e2e8f0"
                strokeWidth={1 / viewport.scale}
              />
            ))}
            {horizontalGridLines.map((position) => (
              <Line
                key={`horizontal-${position}`}
                points={[visibleBounds.left, position, visibleBounds.right, position]}
                stroke="#e2e8f0"
                strokeWidth={1 / viewport.scale}
              />
            ))}
          </Layer>

          <Layer>
            {referenceFloors.flatMap((floor) =>
              getRenderedWalls(floor.walls).map((renderedWall) => {
                const polygon = getWallPolygon(renderedWall).flatMap((point) => {
                  const canvasPoint = toCanvasPoint(point)
                  return [canvasPoint.x, canvasPoint.y]
                })

                return (
                  <Line
                    key={`${floor.id}-${renderedWall.wall.id}`}
                    points={polygon}
                    closed
                    fill="#64748b"
                    opacity={0.2}
                    listening={false}
                  />
                )
              }),
            )}

            {walls.flatMap((wall) =>
              getDimensionGuides(wall, walls).map((guide, index) => {
                const start = toCanvasPoint(guide.start)
                const end = toCanvasPoint(guide.end)
                const labelPoint = toCanvasPoint(guide.labelPoint)
                const [startTickA, startTickB] = getDimensionTick(guide.start, wall)
                const [endTickA, endTickB] = getDimensionTick(guide.end, wall)
                const textRotation =
                  guide.rotation > 90 || guide.rotation < -90
                    ? guide.rotation + 180
                    : guide.rotation

                return (
                  <Fragment key={`${wall.id}-dimension-${index}`}>
                    <Line
                      points={[start.x, start.y, end.x, end.y]}
                      stroke="#64748b"
                      strokeWidth={1}
                      dash={[4, 5]}
                    />
                    <Line
                      points={[
                        toCanvasPoint(startTickA).x,
                        toCanvasPoint(startTickA).y,
                        toCanvasPoint(startTickB).x,
                        toCanvasPoint(startTickB).y,
                      ]}
                      stroke="#64748b"
                      strokeWidth={1}
                    />
                    <Line
                      points={[
                        toCanvasPoint(endTickA).x,
                        toCanvasPoint(endTickA).y,
                        toCanvasPoint(endTickB).x,
                        toCanvasPoint(endTickB).y,
                      ]}
                      stroke="#64748b"
                      strokeWidth={1}
                    />
                    <Text
                      x={labelPoint.x}
                      y={labelPoint.y}
                      width={70}
                      offsetX={35}
                      offsetY={8}
                      align="center"
                      text={guide.text}
                      fill="#475569"
                      fontSize={12}
                      fontStyle="bold"
                      rotation={textRotation}
                    />
                  </Fragment>
                )
              }),
            )}

            {renderedWalls.map((renderedWall) => {
              const polygon = getWallPolygon(renderedWall).flatMap((point) => {
                const canvasPoint = toCanvasPoint(point)
                return [canvasPoint.x, canvasPoint.y]
              })

              return (
                <Line
                  key={renderedWall.wall.id}
                  points={polygon}
                  closed
                  fill="#1e293b"
                  stroke={
                    renderedWall.wall.id === selectedWallId ? '#2563eb' : '#0f172a'
                  }
                  strokeWidth={renderedWall.wall.id === selectedWallId ? 3 : 1}
                  lineJoin="miter"
                  onClick={() => onSelectWall(renderedWall.wall.id)}
                  onContextMenu={(event) =>
                    openWallContextMenu(renderedWall.wall.id, event)
                  }
                  onTap={() => onSelectWall(renderedWall.wall.id)}
                />
              )
            })}

            {draftWall ? (
              <Line
                points={[
                  toCanvasPoint(draftWall.start).x,
                  toCanvasPoint(draftWall.start).y,
                  toCanvasPoint(draftWall.end).x,
                  toCanvasPoint(draftWall.end).y,
                ]}
                stroke="#2563eb"
                strokeWidth={0.3 * METERS_TO_PIXELS}
                dash={[10, 8]}
                lineCap="butt"
              />
            ) : null}

            {angleWidget && draftWall ? (
              <>
                <Line
                  points={[
                    toCanvasPoint(draftWall.start).x,
                    toCanvasPoint(draftWall.start).y,
                    toCanvasPoint(angleWidget.baselineEnd).x,
                    toCanvasPoint(angleWidget.baselineEnd).y,
                  ]}
                  stroke="#f97316"
                  strokeWidth={1.25}
                  dash={[4, 4]}
                />
                <Line
                  points={angleWidget.arcPoints}
                  stroke="#f97316"
                  strokeWidth={2}
                />
                <Circle
                  x={toCanvasPoint(draftWall.start).x}
                  y={toCanvasPoint(draftWall.start).y}
                  radius={4}
                  fill="#ffffff"
                  stroke="#f97316"
                  strokeWidth={2}
                />
                <Rect
                  x={toCanvasPoint(angleWidget.labelPoint).x - 22}
                  y={toCanvasPoint(angleWidget.labelPoint).y - 12}
                  width={44}
                  height={24}
                  fill="#ffffff"
                  stroke="#fed7aa"
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor="#0f172a"
                  shadowOpacity={0.1}
                  shadowBlur={6}
                  shadowOffsetY={2}
                />
                <Text
                  x={toCanvasPoint(angleWidget.labelPoint).x - 20}
                  y={toCanvasPoint(angleWidget.labelPoint).y - 7}
                  width={40}
                  align="center"
                  text={angleWidget.label}
                  fill="#c2410c"
                  fontSize={12}
                  fontStyle="bold"
                />
              </>
            ) : null}

            {draftWallLength !== null && draftWallMidpoint ? (
              <>
                <Rect
                  x={draftWallMidpoint.x + 10}
                  y={draftWallMidpoint.y - 27}
                  width={76}
                  height={24}
                  fill="#ffffff"
                  stroke="#bfdbfe"
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor="#0f172a"
                  shadowOpacity={0.12}
                  shadowBlur={8}
                  shadowOffsetY={2}
                />
                <Text
                  x={draftWallMidpoint.x + 18}
                  y={draftWallMidpoint.y - 21}
                  width={60}
                  align="center"
                  text={`${draftWallLength.toFixed(2)} m`}
                  fill="#1d4ed8"
                  fontSize={13}
                  fontStyle="bold"
                />
              </>
            ) : null}

            {draftWall
              ? endpointGuides.map((guide) => {
                  const guideEnd = toCanvasPoint(guide.projection)

                  return (
                    <Line
                      key={`${guideEnd.x}-${guideEnd.y}`}
                      points={[
                        toCanvasPoint(guide.endpoint).x,
                        toCanvasPoint(guide.endpoint).y,
                        guideEnd.x,
                        guideEnd.y,
                      ]}
                      stroke="#16a34a"
                      strokeWidth={1.5}
                      dash={[5, 6]}
                    />
                  )
                })
              : null}

            {draftWall && hoverAlignmentGuide ? (
              <>
                <Line
                  points={[
                    toCanvasPoint(hoverAlignmentGuide.endpoint).x,
                    toCanvasPoint(hoverAlignmentGuide.endpoint).y,
                    toCanvasPoint(hoverAlignmentGuide.projection).x,
                    toCanvasPoint(hoverAlignmentGuide.projection).y,
                  ]}
                  stroke="#16a34a"
                  strokeWidth={1.5}
                  dash={[5, 6]}
                />
                <Circle
                  x={toCanvasPoint(hoverAlignmentGuide.projection).x}
                  y={toCanvasPoint(hoverAlignmentGuide.projection).y}
                  radius={5}
                  fill="#ffffff"
                  stroke="#16a34a"
                  strokeWidth={3}
                />
              </>
            ) : null}

            {hoverAlignmentGuide && !draftWall && isAddingWall ? (
              <>
                <Line
                  points={[
                    toCanvasPoint(hoverAlignmentGuide.endpoint).x,
                    toCanvasPoint(hoverAlignmentGuide.endpoint).y,
                    toCanvasPoint(hoverAlignmentGuide.projection).x,
                    toCanvasPoint(hoverAlignmentGuide.projection).y,
                  ]}
                  stroke="#16a34a"
                  strokeWidth={1.5}
                  dash={[5, 6]}
                />
                <Circle
                  x={toCanvasPoint(hoverAlignmentGuide.projection).x}
                  y={toCanvasPoint(hoverAlignmentGuide.projection).y}
                  radius={5}
                  fill="#ffffff"
                  stroke="#16a34a"
                  strokeWidth={3}
                />
              </>
            ) : null}

            {hoverSnapTarget ? (
              <Circle
                x={toCanvasPoint(hoverSnapTarget.point).x}
                y={toCanvasPoint(hoverSnapTarget.point).y}
                radius={hoverSnapTarget.kind === 'endpoint' ? 7 : 6}
                fill="#ffffff"
                stroke={hoverSnapTarget.kind === 'endpoint' ? '#16a34a' : '#f97316'}
                strokeWidth={3}
              />
            ) : null}

            {walls.length === 0 && !draftWall ? (
              <Text
                x={24}
                y={24}
                text="Click Add Wall, then drag on the grid."
                fill="#64748b"
                fontSize={15}
              />
            ) : null}
          </Layer>
        </Stage>

        {(draftLengthInput !== null || draftAngleInput !== null) &&
        draftLengthPanelPosition ? (
          <div
            className="draft-length-panel"
            style={{
              left: draftLengthPanelPosition.left,
              top: draftLengthPanelPosition.top,
            }}
          >
            <label>
              <span>Length</span>
              <input
                ref={lengthInputRef}
                value={draftLengthInput ?? ''}
                inputMode="decimal"
                onChange={(event) => updateDraftLength(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (
                      draftWall &&
                      distance(draftWall.start, draftWall.end) >=
                        MIN_WALL_LENGTH_METERS
                    ) {
                      onAddWall(draftWall)
                    }
                    resetDraftWall()
                  }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  resetDraftWall()
                  onExitAddWall()
                }
              }}
              />
              <span>m</span>
            </label>

            <label>
              <span>Angle</span>
              <input
                value={draftAngleDisplay}
                inputMode="decimal"
                onChange={(event) => updateDraftAngle(event.target.value)}
                onFocus={() => {
                  if (draftAngleInput === null && draftWall) {
                    setDraftAngleInput(
                      Math.round(
                        getAngleDegrees(draftWall.start, draftWall.end),
                      ).toString(),
                    )
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (
                      draftWall &&
                      distance(draftWall.start, draftWall.end) >=
                        MIN_WALL_LENGTH_METERS
                    ) {
                      onAddWall(draftWall)
                    }
                    resetDraftWall()
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    resetDraftWall()
                    onExitAddWall()
                  }
                }}
              />
              <span>deg</span>
            </label>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            className="canvas-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                onDeleteWall(contextMenu.wallId)
                closeContextMenu()
              }}
            >
              Delete wall
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
