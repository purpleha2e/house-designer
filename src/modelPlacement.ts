import type { FloorLevel, PlacedModel, Point, RoofAttachment, RoofEndChamfer, ThreeDViewCameraState, Wall, WallAttachment, WallOpening } from './types'
import { normalizeRoofEndConnection } from './roofJunctions.ts'
import { normalizeRoofHeightAlignment } from './roofHeightAlignment.ts'
import { normalizeBayOutline } from './bayRoof.ts'
import { getRoofThickness } from './roofThickness.ts'
import { migrateDormerWindows, syncDormerWindows } from './dormerWindows.ts'
import { createDormerStructuralAssembly } from './dormerPlacement.ts'
import { isPlanDoor } from './doorPlan.ts'
import { getWallPolygon } from './wallGeometry.ts'
import type { ModelDefinition } from './models/modelLibrary'
import type { DetectedRoom } from './wallTopology.ts'
import { getStairSlabOpenings } from './stairSlabOpenings.ts'
import { pointInPolygon } from './assistant/planGeometry.ts'
import { migrateArtworkMaterial } from './modelMaterialOverrides.ts'
import { withKitchenUnitBackOrigin } from './kitchenUnitDesign.ts'
import { normalizeDoorAngles } from './doorDesign.ts'
import { constrainModelDrag, getFootprintOffsetOverlap, MODEL_CONTACT_EPSILON, planAabbsOverlap, type OrientedFootprint,
  type PlanAabb } from './modelDragCollision.ts'
import { getWallBodyFaceRange } from './wallEngine/wallBodyPerimeter.ts'
import { Quaternion, Vector3, type Ray } from 'three'

export type ModelPlacement = Pick<
  PlacedModel,
  'height' | 'position' | 'roofAttachment' | 'rotation' | 'wallAttachment' | 'wallOpeningBottom'
> & {
  floorId: string
}

const WINDOW_SILL_HEIGHT_METERS = 0.9
const PATIO_DOOR_WIDTH_METERS = 1.62
const PATIO_SIDE_LIGHT_BOTTOM_METERS = 1.02
const DOOR_JUNCTION_TOLERANCE_METERS = 0.03
const DEFAULT_LIGHT_HEIGHT = 1.8

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRoofEndChamfer(value: unknown): RoofEndChamfer | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<RoofEndChamfer>
  if (
    typeof candidate.angleDegrees !== 'number' ||
    !Number.isFinite(candidate.angleDegrees) ||
    typeof candidate.distance !== 'number' ||
    !Number.isFinite(candidate.distance) ||
    candidate.distance <= 0
  ) return undefined

  return {
    angleDegrees: clamp(candidate.angleDegrees, 1, 75),
    distance: candidate.distance,
    ...(candidate.matchEave === true ? { matchEave: true } : {}),
  }
}

function normalizeRoofAttachment(value: unknown): RoofAttachment | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<RoofAttachment>
  const validSurfaces: RoofAttachment['surface'][] = [
    'negative-x',
    'positive-x',
    'negative-y',
    'positive-y',
  ]

  return typeof candidate.roofId === 'string' &&
    candidate.roofId.length > 0 &&
    candidate.localPosition &&
    Number.isFinite(candidate.localPosition.x) &&
    Number.isFinite(candidate.localPosition.y) &&
    validSurfaces.includes(candidate.surface as RoofAttachment['surface'])
    ? {
        localPosition: {
          x: candidate.localPosition.x,
          y: candidate.localPosition.y,
        },
        roofId: candidate.roofId,
        surface: candidate.surface as RoofAttachment['surface'],
      }
    : undefined
}

function normalizeRoofRotation(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const quarterTurn = Math.PI / 2
  const cardinal = Math.round(value / quarterTurn) * quarterTurn
  return Math.abs(value - cardinal) <= 0.000001 ? cardinal : value
}

type ModelsById = ReadonlyMap<string, ModelDefinition>
type DistributedModelOpening = WallOpening & { targetWallId: string }

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

export function getPlanCenter(walls: Wall[]): Point {
  const points = walls.flatMap((wall) => [wall.start, wall.end])

  if (points.length === 0) {
    return { x: 3, y: 3 }
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

export function getModelPositionInView(camera: ThreeDViewCameraState, floorElevation: number,
  definition: Pick<ModelDefinition, 'height' | 'width' | 'depth' | 'isLight'>): Point {
  const { x, y, z, w } = camera.quaternion
  const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(x, y, z, w).normalize())
  const centreHeight = floorElevation + (definition.isLight ? DEFAULT_LIGHT_HEIGHT : definition.height / 2)
  const heightDelta = centreHeight - camera.position.y
  const intersection = heightDelta / forward.y
  if (intersection > 0 && intersection <= Math.max(5, Math.abs(heightDelta) * 6)) {
    return { x: camera.position.x + forward.x * intersection, y: camera.position.z + forward.z * intersection }
  }

  // An eye-level or upward view can miss the plane or meet it very far away.
  const horizontalLength = Math.hypot(forward.x, forward.z)
  const distance = horizontalLength > 1e-6 ? Math.max(3, definition.width, definition.depth) / horizontalLength : 0
  return { x: camera.position.x + forward.x * distance, y: camera.position.z + forward.z * distance }
}

function getProjectionOnWall(point: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return { point: wall.start, t: 0 }
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSquared),
  )

  return {
    point: {
      x: wall.start.x + dx * t,
      y: wall.start.y + dy * t,
    },
    t,
  }
}

export function getWallAngle(wall: Wall) {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
}

export function getWallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

export function getWallMountForPoint(point: Point, walls: Wall[], maxDistance = 0.55,
  faceRange?: (wall: Wall, side: -1 | 1) => ReturnType<typeof getWallBodyFaceRange> | null) {
  const candidates = walls
    .flatMap((wall) => {
      const wallLength = getWallLength(wall)
      const unit =
        wallLength > 0
          ? {
              x: (wall.end.x - wall.start.x) / wallLength,
              y: (wall.end.y - wall.start.y) / wallLength,
            }
          : { x: 1, y: 0 }
      const normal = {
        x: -unit.y,
        y: unit.x,
      }
      const signedDistance =
        (point.x - wall.start.x) * normal.x + (point.y - wall.start.y) * normal.y
      const side: -1 | 1 = signedDistance < 0 ? -1 : 1
      const range = faceRange ? faceRange(wall, side) : { start: 0, end: wallLength }
      if (!range) return []
      const offset = clamp((point.x - wall.start.x) * unit.x + (point.y - wall.start.y) * unit.y, range.start, range.end)
      const projected = { x: wall.start.x + offset * unit.x, y: wall.start.y + offset * unit.y }

      return [{
        distance: distance(point, projected),
        point: projected,
        side,
        offset,
        wall,
      }]
    })
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((firstCandidate, secondCandidate) => firstCandidate.distance - secondCandidate.distance)

  const closest = candidates[0]

  if (!closest) {
    return null
  }

  return {
    position: closest.point,
    rotation: getWallAngle(closest.wall) + (closest.side < 0 ? Math.PI : 0),
    wallAttachment: {
      wallId: closest.wall.id,
      offset: closest.offset,
      side: closest.side,
    },
  }
}

type WallObjectSize = Partial<Pick<PlacedModel, 'height' | 'scale' | 'widthScale' | 'wallAttachment'>>
type WallCabinetSize = WallObjectSize & Partial<Pick<PlacedModel, 'id' | 'depthScale'>>
type WallMountedObjectPlacement = NonNullable<ReturnType<typeof fitWallMountedObject>>

export function canMountObjectOnWall(definition: ModelDefinition) {
  return !definition.wallMount && !definition.roofMount &&
    (definition.placement === 'wall-mounted' ||
      (definition.objectType === 'decor' && definition.placement !== 'ceiling-mounted'))
}

export function isWallMountedDecoration(definition: ModelDefinition, model: Pick<PlacedModel, 'wallAttachment'>) {
  return canMountObjectOnWall(definition) &&
    (definition.placement === 'wall-mounted' || Boolean(model.wallAttachment))
}

export function fitWallMountedObject(definition: ModelDefinition, wall: Wall, requested: WallAttachment, model: WallObjectSize = {},
  walls?: Wall[]) {
  const length = getWallLength(wall)
  const scaledHeight = definition.height * (model.scale ?? 1)
  const halfWidth = definition.width * (model.scale ?? 1) * (model.widthScale ?? 1) / 2
  const side = requested.side ?? 1
  if (length < 0.001 || scaledHeight > wall.height) return null
  const wallUnit = definition.kitchenUnitDesign?.unitType === 'wall'
  const range = wallUnit && walls ? getWallBodyFaceRange(walls, wall, side) : { start: 0, end: length }
  if (halfWidth * 2 > range.end - range.start + MODEL_CONTACT_EPSILON) return null
  const offset = clamp(requested.offset, range.start + halfWidth, range.end - halfWidth)
  const angle = getWallAngle(wall)
  const defaultHeight = wallUnit ? 1.4 : 1.45 - scaledHeight / 2
  return {
    position: { x: wall.start.x + Math.cos(angle) * offset, y: wall.start.y + Math.sin(angle) * offset },
    rotation: angle + (side < 0 ? Math.PI : 0),
    height: clamp(model.height ?? defaultHeight, 0, wall.height - scaledHeight),
    wallAttachment: { wallId: wall.id, side, offset },
  }
}

export function getWallMountedObjectPlacement(definition: ModelDefinition, walls: Wall[], point: Point,
  model: WallObjectSize = {}, maxDistance?: number) {
  const scale = model.scale ?? 1
  const wallUnit = definition.kitchenUnitDesign?.unitType === 'wall'
  const width = definition.width * scale * (model.widthScale ?? 1)
  const mount = getWallMountForPoint(point, walls.filter(wall => wall.height >= definition.height * scale &&
    (wallUnit || getWallLength(wall) >= width)), maxDistance, wallUnit ? (wall, side) => {
      if (getWallLength(wall) < .001) return null
      const range = getWallBodyFaceRange(walls, wall, side)
      return range.end - range.start + MODEL_CONTACT_EPSILON >= width ? range : null
    } : undefined)
  if (!mount) return null
  const wall = walls.find(wall => wall.id === mount.wallAttachment.wallId)
  if (!wall) return null
  const side = model.wallAttachment?.wallId === wall.id && distance(point, mount.position) < 0.001
    ? model.wallAttachment.side : mount.wallAttachment.side
  return fitWallMountedObject(definition, wall, { ...mount.wallAttachment, side }, model, walls)
}

export function getWallMountedObjectDisplayPoint(wall: Wall, attachment: WallAttachment, localBack: number) {
  const angle = getWallAngle(wall)
  const depth = (wall.thickness / 2 - localBack + 0.001) * (attachment.side ?? 1)
  return {
    x: wall.start.x + Math.cos(angle) * attachment.offset - Math.sin(angle) * depth,
    y: wall.start.y + Math.sin(angle) * attachment.offset + Math.cos(angle) * depth,
  }
}

function wallCabinetFootprint(definition: ModelDefinition, model: WallCabinetSize,
  wall: Wall, attachment: WallAttachment): OrientedFootprint {
  const angle = getWallAngle(wall)
  const along = { x: Math.cos(angle), y: Math.sin(angle) }
  const side = attachment.side ?? 1
  const across = { x: -along.y * side, y: along.x * side }
  const scale = model.scale ?? 1
  const halfDepth = definition.depth * scale * (model.depthScale ?? 1) / 2
  const rear = getWallMountedObjectDisplayPoint(wall, attachment, 0)
  return { along, across, halfDepth, halfWidth: definition.width * scale * (model.widthScale ?? 1) / 2,
    center: { x: rear.x + across.x * halfDepth, y: rear.y + across.y * halfDepth } }
}

export function resolveWallCabinetPlacement(definition: ModelDefinition, floor: Pick<FloorLevel, 'walls' | 'models'>,
  definitions: ModelsById, candidate: WallMountedObjectPlacement | null, model: WallCabinetSize = {},
  { from, snap, snapDistance = .06, slide = true }: {
    from?: WallMountedObjectPlacement | null; snap?: 'horizontal' | 'both'; snapDistance?: number; slide?: boolean
  } = {}): WallMountedObjectPlacement | null {
  if (!candidate || definition.kitchenUnitDesign?.unitType !== 'wall') return candidate
  const attachment = candidate.wallAttachment
  const wall = floor.walls.find(item => item.id === attachment.wallId)
  if (!wall) return null

  // After projecting the cabinet footprints, the drag is two-dimensional:
  // the offset along the host wall and the elevation above the floor.
  const footprint = wallCabinetFootprint(definition, model, wall, attachment)
  const height = definition.height * (model.scale ?? 1)
  const obstacles: (PlanAabb & { kind: 'wall' | 'cabinet' })[] = []
  const addObstacle = (target: OrientedFootprint, minY: number, maxY: number, kind: 'wall' | 'cabinet') => {
    const overlap = getFootprintOffsetOverlap(footprint, target)
    if (overlap) obstacles.push({ minX: attachment.offset + overlap.min, maxX: attachment.offset + overlap.max, minY, maxY, kind })
  }
  for (const other of floor.walls) {
    if (other.id === wall.id) continue
    const length = getWallLength(other)
    if (length < .001 || other.thickness <= 0 || other.height <= 0) continue
    const along = { x: (other.end.x - other.start.x) / length, y: (other.end.y - other.start.y) / length }
    const center = { x: (other.start.x + other.end.x) / 2, y: (other.start.y + other.end.y) / 2 }
    addObstacle({ center, along, across: { x: -along.y, y: along.x }, halfWidth: length / 2, halfDepth: other.thickness / 2 },
      0, other.height, 'wall')
  }
  for (const other of floor.models) {
    if (other.id === model.id || !other.wallAttachment) continue
    const target = definitions.get(other.modelId)
    if (target?.kitchenUnitDesign?.unitType !== 'wall') continue
    const host = floor.walls.find(item => item.id === other.wallAttachment?.wallId)
    const mount = host && fitWallMountedObject(target, host, other.wallAttachment, other, floor.walls)
    if (!host || !mount) continue
    addObstacle(wallCabinetFootprint(target, other, host, mount.wallAttachment), mount.height,
      mount.height + target.height * (other.scale ?? 1), 'cabinet')
  }
  if (!obstacles.length) return candidate

  const bounds = (x: number, y: number) => ({ minX: x, maxX: x, minY: y, maxY: y + height })
  const blocked = (x: number, y: number) => obstacles.some(obstacle => planAabbsOverlap(bounds(x, y), obstacle))
  let x = attachment.offset, y = candidate.height
  if (from?.wallAttachment.wallId === attachment.wallId && from.wallAttachment.side === attachment.side) {
    const start = from.wallAttachment.offset
    const motion = constrainModelDrag(bounds(start, from.height), { x: x - start, y: y - from.height }, obstacles, slide)
    x = start + motion.x
    y = from.height + motion.y
  }

  let nearest: WallMountedObjectPlacement | null = null
  let nearestDistance = snapDistance
  const at = (offset: number, bottom: number) =>
    fitWallMountedObject(definition, wall, { ...attachment, offset }, { ...model, height: bottom }, floor.walls)
  const trySnap = (offset: number, bottom: number, distance: number) => {
    if (distance > nearestDistance) return false
    const placement = at(offset, bottom)
    if (!placement || Math.abs(placement.wallAttachment.offset - offset) > MODEL_CONTACT_EPSILON ||
      Math.abs(placement.height - bottom) > MODEL_CONTACT_EPSILON || blocked(offset, bottom)) return false
    nearest = placement
    nearestDistance = distance
    return true
  }
  if (snap) for (const obstacle of obstacles) {
    const matchCabinetHeight = snap === 'both' && obstacle.kind === 'cabinet'
    if (y < obstacle.maxY - MODEL_CONTACT_EPSILON && y + height > obstacle.minY + MODEL_CONTACT_EPSILON) {
      for (const edge of [obstacle.minX, obstacle.maxX]) {
        const distance = Math.abs(edge - x)
        const row = matchCabinetHeight && Math.abs(obstacle.minY - y) <= snapDistance
        if (row && trySnap(edge, obstacle.minY, distance)) continue
        trySnap(edge, y, distance)
      }
    }
    if (matchCabinetHeight && x > obstacle.minX + MODEL_CONTACT_EPSILON && x < obstacle.maxX - MODEL_CONTACT_EPSILON) {
      for (const edge of [obstacle.minY - height, obstacle.maxY]) trySnap(x, edge, Math.abs(edge - y))
    }
  }
  return nearest ?? (blocked(x, y) ? null : at(x, y))
}

export function getWallFaceHit(ray: Ray, wall: Wall, elevation: number, faceWalls?: Wall[]) {
  const length = getWallLength(wall)
  if (length < 0.001) return null

  const x = (wall.end.x - wall.start.x) / length
  const z = (wall.end.y - wall.start.y) / length
  const originX = ray.origin.x - wall.start.x
  const originZ = ray.origin.z - wall.start.y
  const signedDistance = -z * originX + x * originZ
  const side: -1 | 1 = signedDistance < 0 ? -1 : 1
  const approach = -z * ray.direction.x + x * ray.direction.z
  if (Math.abs(approach) < 1e-6) return null

  const distance = (side * wall.thickness / 2 - signedDistance) / approach
  if (distance <= 0) return null
  const offset = x * (originX + distance * ray.direction.x) + z * (originZ + distance * ray.direction.z)
  const height = ray.origin.y + distance * ray.direction.y - elevation
  const range = faceWalls ? getWallBodyFaceRange(faceWalls, wall, side) : { start: 0, end: length }
  if (offset < range.start || offset > range.end || height < 0 || height > wall.height) return null
  return { attachment: { wallId: wall.id, offset, side }, height, distance }
}

export function getWallMountedObjectPlacementAlongRay(ray: Ray, floor: Pick<FloorLevel, 'walls' | 'elevation'>,
  definition: ModelDefinition, model: WallObjectSize = {}, grab?: { alongWall: number; height: number }) {
  let closest: (NonNullable<ReturnType<typeof fitWallMountedObject>> & { distance: number }) | null = null
  for (const wall of floor.walls) {
    const hit = getWallFaceHit(ray, wall, floor.elevation, definition.kitchenUnitDesign?.unitType === 'wall' ? floor.walls : undefined)
    if (!hit || (closest && hit.distance >= closest.distance)) continue
    const { attachment } = hit
    const offset = attachment.offset - (grab?.alongWall ?? 0) * attachment.side
    const height = hit.height - (grab?.height ?? definition.height * (model.scale ?? 1) / 2)
    const placement = fitWallMountedObject(definition, wall, { ...attachment, offset }, { ...model, height }, floor.walls)
    if (placement) closest = { ...placement, distance: hit.distance }
  }
  return closest
}

export type CeilingMountArea = { rooms: Point[][]; stairOpenings: Point[][] }

export function getCeilingMountArea(floor: FloorLevel, floors: FloorLevel[], rooms: DetectedRoom[], definitions: ModelsById): CeilingMountArea {
  const above = floors.filter(level => level.elevation > floor.elevation).sort((a, b) => a.elevation - b.elevation)[0]
  const ceilingModes = new Map(floor.rooms.map(room => [room.signature, room.ceilingMode]))
  return {
    rooms: rooms.filter(room => above || (ceilingModes.get(room.signature) ?? floor.ceilingMode) !== 'open').map(room => room.polygon),
    stairOpenings: getStairSlabOpenings(floor, above ?? null, floors, definitions),
  }
}

export function ceilingMountFits(point: Point, area: CeilingMountArea | undefined) {
  return !!area && area.rooms.some(room => pointInPolygon(point, room)) &&
    !area.stairOpenings.some(opening => pointInPolygon(point, opening))
}

function openingBelongsToModel(opening: WallOpening, modelIds: Set<string>) {
  const [ownerId] = opening.id.split(':')
  return modelIds.has(ownerId)
}

function getModelOffsetOnWall(model: PlacedModel, wall: Wall) {
  return getProjectionOnWall(model.position, wall).t * getWallLength(wall)
}

function getWallDirection(wall: Wall) {
  const wallLength = getWallLength(wall)

  return wallLength > 0.000001
    ? {
        x: (wall.end.x - wall.start.x) / wallLength,
        y: (wall.end.y - wall.start.y) / wallLength,
      }
    : { x: 1, y: 0 }
}

function dot(first: Point, second: Point) {
  return first.x * second.x + first.y * second.y
}

function getDistanceToWallLine(wall: Wall, point: Point) {
  const direction = getWallDirection(wall)

  return Math.abs(
    (point.x - wall.start.x) * -direction.y +
      (point.y - wall.start.y) * direction.x,
  )
}

function getPointAlongWall(wall: Wall, distanceAlongWall: number) {
  const direction = getWallDirection(wall)

  return {
    x: wall.start.x + direction.x * distanceAlongWall,
    y: wall.start.y + direction.y * distanceAlongWall,
  }
}

function getRawProjectionDistanceOnWall(point: Point, wall: Wall) {
  const direction = getWallDirection(wall)

  return (
    (point.x - wall.start.x) * direction.x +
    (point.y - wall.start.y) * direction.y
  )
}

function wallsAreCollinear(firstWall: Wall, secondWall: Wall) {
  const firstDirection = getWallDirection(firstWall)
  const secondDirection = getWallDirection(secondWall)

  return (
    Math.abs(dot(firstDirection, secondDirection)) >= 0.98 &&
    getDistanceToWallLine(secondWall, firstWall.start) <=
      Math.max(0.04, (firstWall.thickness + secondWall.thickness) / 2 + 0.01) &&
    getDistanceToWallLine(secondWall, firstWall.end) <=
      Math.max(0.04, (firstWall.thickness + secondWall.thickness) / 2 + 0.01)
  )
}

type OpeningDimensions = Pick<PlacedModel, 'id' | 'modelId' | 'scale' | 'widthScale' | 'wallOpeningBottom'>

function getRawModelOpenings(
  model: OpeningDimensions,
  wall: Wall,
  definition: ModelDefinition,
  modelOffset: number,
): WallOpening[] {
  const scale = model.scale ?? 1
  const widthScale = model.widthScale ?? 1
  const wallLength = getWallLength(wall)
  const width = Math.max(
    (definition.openingWidth ?? definition.width) * scale * widthScale,
    0.3,
  )
  const requestedBottom =
    definition.wallMount === 'window'
      ? model.wallOpeningBottom ?? WINDOW_SILL_HEIGHT_METERS
      : 0
  const maxBottom = Math.max(wall.height - 0.3, 0)
  const bottom =
    definition.wallMount === 'window'
      ? clamp(requestedBottom, 0, maxBottom)
      : 0
  const height = Math.min(
    Math.max(definition.height * scale, 0.3),
    Math.max(wall.height - bottom, 0.3),
  )
  const openingCenter =
    modelOffset + (definition.openingCenterOffset ?? 0) * scale * widthScale
  const opening: WallOpening = {
    id: model.id,
    modelId: model.modelId,
    center: openingCenter,
    width,
    bottom,
    height,
  }

  if (!model.modelId.includes('side-lights')) {
    return [opening]
  }

  const centreDoorWidth = Math.min(
    PATIO_DOOR_WIDTH_METERS * scale * widthScale,
    Math.max(wallLength - 0.2, 0.3),
  )
  const sideLightWidth = Math.max(
    (definition.width * scale * widthScale - centreDoorWidth) / 2,
    0,
  )
  const sideLightBottom = Math.min(
    PATIO_SIDE_LIGHT_BOTTOM_METERS * scale,
    Math.max(wall.height - 0.2, 0),
  )
  const sideLightHeight = Math.min(
    Math.max(definition.height * scale - sideLightBottom, 0.3),
    Math.max(wall.height - sideLightBottom, 0.3),
  )
  const sideLightOffset = centreDoorWidth / 2 + sideLightWidth / 2

  if (sideLightWidth <= 0.1) {
    return [{ ...opening, width: centreDoorWidth }]
  }

  return [
    {
      ...opening,
      id: `${model.id}:left-side-light`,
      center: modelOffset - sideLightOffset,
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
    {
      ...opening,
      id: `${model.id}:doors`,
      center: modelOffset,
      width: centreDoorWidth,
      bottom: 0,
      height: Math.min(definition.height * scale, wall.height),
    },
    {
      ...opening,
      id: `${model.id}:right-side-light`,
      center: modelOffset + sideLightOffset,
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
  ]
}

/** Along-wall interval where the other wall's body meets either face of the host. */
function getDoorJunctionInterval(wall: Wall, other: Wall, direction: Point, length: number) {
  const otherDirection = getWallDirection(other)
  if (Math.abs(direction.x * otherDirection.y - direction.y * otherDirection.x) < 1e-5) return null

  const normal = { x: -direction.y, y: direction.x }
  const reach = wall.thickness / 2 + DOOR_JUNCTION_TOLERANCE_METERS
  const corners = getWallPolygon({ wall: other, startExtension: 0, endExtension: 0 }).map(point => {
    const delta = { x: point.x - wall.start.x, y: point.y - wall.start.y }
    return { along: dot(delta, direction), across: dot(delta, normal) }
  })
  const offsets = corners.flatMap((corner, index) => {
    const next = corners[(index + 1) % corners.length]
    const clip = [-reach, reach].flatMap(face => {
      if ((corner.across < face) === (next.across < face)) return []
      const t = (face - corner.across) / (next.across - corner.across)
      return [corner.along + (next.along - corner.along) * t]
    })
    return Math.abs(corner.across) <= reach ? [corner.along, ...clip] : clip
  })
  const start = Math.max(0, Math.min(...offsets))
  const end = Math.min(length, Math.max(...offsets))
  return end - start > 1e-6 ? { start, end } : null
}

export function getDoorWallOffset(
  wall: Wall, walls: readonly Wall[], definition: ModelDefinition, offset: number,
  { model, fromOffset }: { model?: OpeningDimensions; fromOffset?: number } = {},
) {
  const length = getWallLength(wall)
  if (length < 1e-6 || !Number.isFinite(offset)) return null
  if (definition.doorDesign && definition.height * (model?.scale ?? 1) > wall.height + MODEL_CONTACT_EPSILON) return null
  const openings = getRawModelOpenings(model ?? { id: definition.id, modelId: definition.id, scale: 1 }, wall, definition, 0)
  const openingStart = Math.min(...openings.map(opening => opening.center - opening.width / 2))
  const openingEnd = Math.max(...openings.map(opening => opening.center + opening.width / 2))
  const direction = getWallDirection(wall)
  const junctions = walls.flatMap(other => {
    if (other.id === wall.id || getWallLength(other) < 1e-6) return []
    const interval = getDoorJunctionInterval(wall, other, direction, length)
    return interval ? [interval] : []
  }).sort((a, b) => a.start - b.start)

  const ranges: { min: number; max: number }[] = []
  const sourceCenter = fromOffset === undefined ? undefined : fromOffset + (openingStart + openingEnd) / 2
  let start = 0
  for (const junction of [...junctions, { start: length, end: length }]) {
    const min = Math.max(0, start - openingStart)
    const max = Math.min(length, junction.start - openingEnd)
    if (sourceCenter !== undefined && sourceCenter >= start && sourceCenter <= junction.start) {
      return min <= max ? clamp(offset, min, max) : null
    }
    if (min <= max && junction.start >= start) ranges.push({ min, max })
    start = Math.max(start, junction.end)
  }
  if (fromOffset === undefined) {
    const fit = ranges.find(({ min, max }) => offset >= min - 1e-6 && offset <= max + 1e-6)
    return fit ? clamp(offset, fit.min, fit.max) : null
  }

  // A saved door centred on a junction can move into the closest span that fits.
  let nearest: { min: number; max: number } | undefined
  let nearestDistance = Infinity
  for (const range of ranges) {
    const gap = Math.abs(fromOffset - clamp(fromOffset, range.min, range.max))
    if (gap < nearestDistance) {
      nearest = range
      nearestDistance = gap
    }
  }
  return nearest ? clamp(offset, nearest.min, nearest.max) : null
}

export function getDoorDragMount(model: PlacedModel, definition: ModelDefinition, wall: Wall, walls: Wall[], point: Point) {
  const wallAttachment = model.wallAttachment!
  const offset = getDoorWallOffset(wall, walls, definition, getRawProjectionDistanceOnWall(point, wall), {
    model, fromOffset: wallAttachment.offset,
  })
  if (offset === null) return { position: model.position, rotation: model.rotation, wallAttachment }
  return {
    position: getPointAlongWall(wall, offset),
    rotation: model.rotation,
    wallAttachment: { ...wallAttachment, offset },
  }
}

export function doorPlacementFits(definition: ModelDefinition, walls: Wall[], attachment: PlacedModel['wallAttachment'], model?: OpeningDimensions) {
  if (!isPlanDoor(definition)) return true
  const wall = attachment && walls.find(candidate => candidate.id === attachment.wallId)
  return !!wall && !!attachment && getDoorWallOffset(wall, walls, definition, attachment.offset, { model }) !== null
}

export function constrainDoorUpdate(model: PlacedModel, definition: ModelDefinition, walls: Wall[], updates: Partial<PlacedModel>) {
  const next = { ...model, ...updates }
  const original = model.wallAttachment
  const host = original && walls.find(wall => wall.id === original.wallId)
  if (host && original && (updates.position || updates.wallAttachment)) {
    const requested = updates.wallAttachment?.wallId === host.id
      ? updates.wallAttachment.offset
      : getRawProjectionDistanceOnWall(updates.position ?? model.position, host)
    const offset = getDoorWallOffset(host, walls, definition, requested, { model: next, fromOffset: original.offset })
    return offset === null ? null : {
      ...updates,
      position: getPointAlongWall(host, offset),
      wallAttachment: { ...original, offset },
    }
  }

  if (doorPlacementFits(definition, walls, next.wallAttachment, next)) return updates
  return null
}

function clipOpeningToWall(
  opening: WallOpening,
  sourceWall: Wall,
  targetWall: Wall,
): DistributedModelOpening | null {
  if (!wallsAreCollinear(sourceWall, targetWall)) {
    return null
  }

  const sourceLeft = opening.center - opening.width / 2
  const sourceRight = opening.center + opening.width / 2
  const sourceLeftPoint = getPointAlongWall(sourceWall, sourceLeft)
  const sourceRightPoint = getPointAlongWall(sourceWall, sourceRight)
  const projectedLeft = getRawProjectionDistanceOnWall(sourceLeftPoint, targetWall)
  const projectedRight = getRawProjectionDistanceOnWall(sourceRightPoint, targetWall)
  const targetLeft = Math.max(0, Math.min(projectedLeft, projectedRight))
  const targetRight = Math.min(
    getWallLength(targetWall),
    Math.max(projectedLeft, projectedRight),
  )
  const width = targetRight - targetLeft

  if (width <= 0.03) {
    return null
  }

  return {
    ...opening,
    id:
      targetWall.id === sourceWall.id
        ? opening.id
        : `${opening.id}:wall:${targetWall.id}`,
    center: targetLeft + width / 2,
    targetWallId: targetWall.id,
    width,
  }
}

function getDistributedModelOpenings(
  model: PlacedModel,
  wall: Wall,
  walls: Wall[],
  modelsById: ModelsById,
) {
  const definition = modelsById.get(model.modelId)
  if (!definition?.wallMount || !model.wallAttachment) return []
  return getRawModelOpenings(model, wall, definition, getModelOffsetOnWall(model, wall)).flatMap((opening) =>
    walls
      .map((candidateWall) => clipOpeningToWall(opening, wall, candidateWall))
      .filter((candidateOpening): candidateOpening is DistributedModelOpening =>
        Boolean(candidateOpening),
      ),
  )
}

export function getModelOpenings(
  model: PlacedModel,
  wall: Wall,
  modelsById: ModelsById,
): WallOpening[] {
  const definition = modelsById.get(model.modelId)

  if (!definition?.wallMount || !model.wallAttachment) {
    return []
  }

  const scale = model.scale ?? 1
  const widthScale = model.widthScale ?? 1
  const wallLength = getWallLength(wall)
  const width = Math.min(
    Math.max(
      (definition.openingWidth ?? definition.width) * scale * widthScale,
      0.3,
    ),
    Math.max(wallLength - 0.2, 0.3),
  )
  const requestedBottom =
    definition.wallMount === 'window'
      ? model.wallOpeningBottom ?? WINDOW_SILL_HEIGHT_METERS
      : 0
  const maxBottom = Math.max(wall.height - 0.3, 0)
  const bottom =
    definition.wallMount === 'window'
      ? clamp(requestedBottom, 0, maxBottom)
      : 0
  const height = Math.min(
    Math.max(definition.height * scale, 0.3),
    Math.max(wall.height - bottom, 0.3),
  )
  const modelOffset = getModelOffsetOnWall(model, wall)
  const openingCenter =
    modelOffset + (definition.openingCenterOffset ?? 0) * scale * widthScale

  const opening: WallOpening = {
    id: model.id,
    modelId: model.modelId,
    center: Math.max(width / 2, Math.min(wallLength - width / 2, openingCenter)),
    width,
    bottom,
    height,
  }

  if (!model.modelId.includes('side-lights')) {
    return [opening]
  }

  const centreDoorWidth = Math.min(
    PATIO_DOOR_WIDTH_METERS * scale * widthScale,
    Math.max(wallLength - 0.2, 0.3),
  )
  const sideLightWidth = Math.max(
    (definition.width * scale * widthScale - centreDoorWidth) / 2,
    0,
  )
  const sideLightBottom = Math.min(
    PATIO_SIDE_LIGHT_BOTTOM_METERS * scale,
    Math.max(wall.height - 0.2, 0),
  )
  const sideLightHeight = Math.min(
    Math.max(definition.height * scale - sideLightBottom, 0.3),
    Math.max(wall.height - sideLightBottom, 0.3),
  )
  const sideLightOffset = centreDoorWidth / 2 + sideLightWidth / 2

  if (sideLightWidth <= 0.1) {
    return [
      {
        ...opening,
        width: centreDoorWidth,
      },
    ]
  }

  const clampCenter = (center: number, openingWidth: number) =>
    Math.max(
      openingWidth / 2,
      Math.min(wallLength - openingWidth / 2, center),
    )

  return [
    {
      ...opening,
      id: `${model.id}:left-side-light`,
      center: clampCenter(modelOffset - sideLightOffset, sideLightWidth),
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
    {
      ...opening,
      id: `${model.id}:doors`,
      center: clampCenter(modelOffset, centreDoorWidth),
      width: centreDoorWidth,
      bottom: 0,
      height: Math.min(definition.height * scale, wall.height),
    },
    {
      ...opening,
      id: `${model.id}:right-side-light`,
      center: clampCenter(modelOffset + sideLightOffset, sideLightWidth),
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
  ]
}

export function syncWallOpenings(
  floor: FloorLevel,
  modelsById: ModelsById,
): FloorLevel {
  floor = syncDormerWindows(floor, modelsById)
  const modelIds = new Set((floor.models ?? []).map((model) => model.id))
  const modelOpeningsByWallId = new Map<string, WallOpening[]>()

  for (const model of floor.models ?? []) {
    if (!model.wallAttachment) {
      continue
    }

    const wall = floor.walls.find(
      (candidateWall) => candidateWall.id === model.wallAttachment?.wallId,
    )

    if (!wall) {
      continue
    }

    getDistributedModelOpenings(model, wall, floor.walls, modelsById).forEach(
      ({ targetWallId, ...opening }) => {
        modelOpeningsByWallId.set(targetWallId, [
          ...(modelOpeningsByWallId.get(targetWallId) ?? []),
          opening,
        ])
      },
    )
  }

  return {
    ...floor,
    walls: floor.walls.map((wall) => {
      const modelOpenings = modelOpeningsByWallId.get(wall.id) ?? []
      const manualOpenings = (wall.openings ?? []).filter((opening) =>
        !openingBelongsToModel(opening, modelIds),
      )
      const openings = [...manualOpenings, ...modelOpenings].sort(
        (firstOpening, secondOpening) => firstOpening.center - secondOpening.center,
      )

      return openings.length > 0
        ? { ...wall, openings }
        : { ...wall, openings: undefined }
    }),
  }
}

export function normalizeFloor(
  floor: FloorLevel,
  modelsById: ModelsById,
): FloorLevel {
  return migrateDormerWindows(syncWallOpenings({
    ...floor,
    models: Array.isArray(floor.models)
      ? floor.models.map((model) => {
          const definition = modelsById.get(model.modelId)
          const regions = definition?.materialRegions
          const migrateArtwork = (definition?.pictureFrameDesign || definition?.objectType === 'decor') &&
            regions?.some(region => region.id === 'hd_image') &&
            !regions.some(region => region.id === 'hd_canvas')

          const normalized = {
            ...model,
            ...(definition?.doorDesign && model.doorLeafAngles !== undefined ? { doorLeafAngles: normalizeDoorAngles(model.doorLeafAngles) } : {}),
            ...(migrateArtwork ? {
              materialOverrides: migrateArtworkMaterial(model.materialOverrides),
              materialTextureTransforms: migrateArtworkMaterial(model.materialTextureTransforms),
            } : {}),
            flipped: model.flipped === true,
            height:
              definition?.isLight &&
              (typeof model.height !== 'number' || !Number.isFinite(model.height))
                ? Math.min(floor.roomHeight - 0.2, 1.8)
                : model.height,
            lightColor:
              definition?.isLight && !model.lightColor
                ? definition.lightColor
                : model.lightColor,
            lightDistance:
              definition?.isLight &&
              (typeof model.lightDistance !== 'number' ||
                !Number.isFinite(model.lightDistance))
                ? definition.lightDistance
                : model.lightDistance,
            lightEnabled:
              definition?.isLight && typeof model.lightEnabled !== 'boolean'
                ? true
                : model.lightEnabled,
            lightFalloff:
              definition?.isLight &&
              (typeof model.lightFalloff !== 'number' ||
                !Number.isFinite(model.lightFalloff))
                ? definition.lightFalloff
                : model.lightFalloff,
            lightPower:
              definition?.isLight &&
              (typeof model.lightPower !== 'number' ||
                !Number.isFinite(model.lightPower))
                ? definition.lightPower
                : model.lightPower,
            lightSpread:
              definition?.lightKind === 'spot' &&
              (typeof model.lightSpread !== 'number' ||
                !Number.isFinite(model.lightSpread))
                ? definition.lightSpread
                : model.lightSpread,
            mirrored: model.mirrored === true,
            dormerWidth: definition?.roofMount === 'dormer' && typeof model.dormerWidth === 'number' && Number.isFinite(model.dormerWidth)
              ? Math.max(0.5, Math.min(10, model.dormerWidth)) : undefined,
            dormerHeight: definition?.roofMount === 'dormer' && typeof model.dormerHeight === 'number' && Number.isFinite(model.dormerHeight)
              ? Math.max(0.5, Math.min(10, model.dormerHeight)) : undefined,
            dormerWindowModelId:
              definition?.roofMount === 'dormer'
                ? typeof model.dormerWindowModelId === 'string' &&
                    modelsById.get(model.dormerWindowModelId)?.wallMount === 'window'
                  ? model.dormerWindowModelId
                  : Array.from(modelsById.values()).find(
                      (candidate) => candidate.wallMount === 'window',
                    )?.id
                : undefined,
            roofAttachment:
              definition?.roofMount === 'dormer'
                ? normalizeRoofAttachment(model.roofAttachment)
                : undefined,
            scale:
              typeof model.scale === 'number' && Number.isFinite(model.scale)
                ? model.scale
                : 1,
            wallOpeningBottom:
              definition?.wallMount === 'window' &&
              typeof model.wallOpeningBottom === 'number' &&
              Number.isFinite(model.wallOpeningBottom)
                ? model.wallOpeningBottom
                : undefined,
            widthScale:
              typeof model.widthScale === 'number' &&
              Number.isFinite(model.widthScale)
                ? model.widthScale
                : 1,
            depthScale:
              typeof model.depthScale === 'number' &&
              Number.isFinite(model.depthScale)
                ? model.depthScale
                : 1,
          }
          return definition?.kitchenUnitDesign ? withKitchenUnitBackOrigin(normalized, definition.kitchenUnitDesign) : normalized
        })
      : [],
    roofs: Array.isArray(floor.roofs)
      ? floor.roofs.flatMap((roof) => {
          const width =
            typeof roof.width === 'number' && Number.isFinite(roof.width)
              ? Math.max(0.3, roof.width)
              : 4
          const depth =
            typeof roof.depth === 'number' && Number.isFinite(roof.depth)
              ? Math.max(0.3, roof.depth)
              : width
          const pitchDegrees =
            typeof roof.pitchDegrees === 'number' &&
            Number.isFinite(roof.pitchDegrees)
              ? Math.min(75, Math.max(1, roof.pitchDegrees))
              : 35

          return roof.type === 'flat' ||
            roof.type === 'hip' ||
            roof.type === 'lean-to' ||
            roof.type === 'up-and-over' || roof.type === 'bay'
            ? [{
                ...roof,
                bayOutline: roof.type === 'bay' ? normalizeBayOutline(roof.bayOutline) : undefined,
                bayRoofStyle: roof.type === 'bay' && (roof.bayRoofStyle === 'classic-lean-to' || roof.bayRoofStyle === 'fan')
                  ? roof.bayRoofStyle : undefined,
                bayRidgeLength: roof.type === 'bay' && Number.isFinite(roof.bayRidgeLength)
                  ? Math.max(0, roof.bayRidgeLength!) : undefined,
                baySupportOffsets: undefined,
                thickness: getRoofThickness(roof),
                clipsGeometry: roof.clipsGeometry !== false,
                fitSupportingWalls: roof.fitSupportingWalls === true,
                allowInteriorSkin: roof.allowInteriorSkin === true,
                interiorSkinDepth: Number.isFinite(roof.interiorSkinDepth)
                  ? Math.min(0.1, Math.max(0, roof.interiorSkinDepth!)) : undefined,
                asymmetricSides: roof.type === 'up-and-over' && roof.asymmetricSides === true,
                mountSide: roof.type === 'up-and-over' && ['auto', 'side1', 'side2', 'free'].includes(roof.mountSide ?? '')
                  ? roof.mountSide : undefined,
                ridgeOffset: roof.type === 'up-and-over' && Number.isFinite(roof.ridgeOffset) ? roof.ridgeOffset : undefined,
                ridgeHeight: roof.type === 'up-and-over' && Number.isFinite(roof.ridgeHeight) ? roof.ridgeHeight : undefined,
                ridgeHeightTargetRoofId: roof.type === 'up-and-over' && typeof roof.ridgeHeightTargetRoofId === 'string'
                  && roof.ridgeHeightTargetRoofId.length ? roof.ridgeHeightTargetRoofId : undefined,
                ridgeStart: normalizeRoofEndConnection(roof.ridgeStart),
                heightAlignment: normalizeRoofHeightAlignment(roof.heightAlignment),
                ridgeEnd: normalizeRoofEndConnection(roof.ridgeEnd),
                ridgeStartChamfer: normalizeRoofEndChamfer(roof.ridgeStartChamfer),
                ridgeEndChamfer: normalizeRoofEndChamfer(roof.ridgeEndChamfer),
                depth,
                heightOffset:
                  typeof roof.heightOffset === 'number' &&
                  Number.isFinite(roof.heightOffset)
                    ? roof.heightOffset
                    : 0,
                overhangEnd:
                  typeof roof.overhangEnd === 'number' &&
                  Number.isFinite(roof.overhangEnd)
                    ? Math.max(0, roof.overhangEnd)
                    : undefined,
                overhangSide:
                  typeof roof.overhangSide === 'number' &&
                  Number.isFinite(roof.overhangSide)
                    ? Math.max(0, roof.overhangSide)
                    : undefined,
                overhangSideNegative:
                  typeof roof.overhangSideNegative === 'number' &&
                  Number.isFinite(roof.overhangSideNegative)
                    ? Math.max(0, roof.overhangSideNegative)
                    : typeof roof.overhangSide === 'number' &&
                        Number.isFinite(roof.overhangSide)
                      ? Math.max(0, roof.overhangSide)
                      : undefined,
                overhangSidePositive:
                  typeof roof.overhangSidePositive === 'number' &&
                  Number.isFinite(roof.overhangSidePositive)
                    ? Math.max(0, roof.overhangSidePositive)
                    : typeof roof.overhangSide === 'number' &&
                        Number.isFinite(roof.overhangSide)
                      ? Math.max(0, roof.overhangSide)
                      : undefined,
                pitchDegrees,
                overhangPitchDegrees:
                  typeof roof.overhangPitchDegrees === 'number' &&
                  Number.isFinite(roof.overhangPitchDegrees)
                    ? Math.min(75, Math.max(0, roof.overhangPitchDegrees))
                    : undefined,
                soffitColor:
                  typeof roof.soffitColor === 'string' && /^#[0-9a-f]{6}$/i.test(roof.soffitColor)
                    ? roof.soffitColor
                    : undefined,
                position:
                  roof.position &&
                  typeof roof.position.x === 'number' &&
                  Number.isFinite(roof.position.x) &&
                  typeof roof.position.y === 'number' &&
                  Number.isFinite(roof.position.y)
                    ? roof.position
                    : { x: 0, y: 0 },
                rotation:
                  normalizeRoofRotation(roof.rotation),
                supportDepth:
                  typeof roof.supportDepth === 'number' &&
                  Number.isFinite(roof.supportDepth)
                    ? Math.max(0.3, roof.supportDepth)
                    : undefined,
                supportPosition:
                  roof.supportPosition &&
                  typeof roof.supportPosition.x === 'number' &&
                  Number.isFinite(roof.supportPosition.x) &&
                  typeof roof.supportPosition.y === 'number' &&
                  Number.isFinite(roof.supportPosition.y)
                    ? roof.supportPosition
                    : undefined,
                supportWidth:
                  typeof roof.supportWidth === 'number' &&
                  Number.isFinite(roof.supportWidth)
                    ? Math.max(0.3, roof.supportWidth)
                    : undefined,
                width,
              }]
            : []
        })
      : [],
  }, modelsById), modelsById)
}

export function createPlacedModel({
  id,
  modelId,
  modelsById,
  position,
  walls,
}: {
  id: string
  modelId: string
  modelsById: ModelsById
  position?: Point
  walls: Wall[]
}): PlacedModel {
  const definition = modelsById.get(modelId)
  const spawnPoint = position ?? getPlanCenter(walls)
  const wallMount = definition?.wallMount
    ? getWallMountForPoint(spawnPoint, walls)
    : null

  const model: PlacedModel = {
    dormerWindowOpenings: definition?.roofMount === 'dormer' ? [] : undefined,
    dormerHeight: definition?.roofMount === 'dormer'
      ? createDormerStructuralAssembly({ definition, ownerId: id }).wallHeight : undefined,
    flipped: false,
    height: definition?.isLight ? DEFAULT_LIGHT_HEIGHT : undefined,
    id,
    lightColor: definition?.isLight ? definition.lightColor : undefined,
    lightDistance: definition?.isLight ? definition.lightDistance : undefined,
    lightEnabled: definition?.isLight ? true : undefined,
    lightFalloff: definition?.isLight ? definition.lightFalloff : undefined,
    lightPower: definition?.isLight ? definition.lightPower : undefined,
    lightSpread: definition?.lightKind === 'spot' ? definition.lightSpread : undefined,
    mirrored: false,
    modelId,
    position: wallMount?.position ?? spawnPoint,
    rotation: wallMount?.rotation ?? 0,
    scale: 1,
    widthScale: 1,
    depthScale: 1,
    wallAttachment: wallMount?.wallAttachment,
  }
  return definition?.kitchenUnitDesign ? withKitchenUnitBackOrigin(model, definition.kitchenUnitDesign) : model
}

export function updateWallAttachedModels(
  models: PlacedModel[],
  wall: Wall,
  context?: { walls: Wall[]; definitions: ModelsById },
): PlacedModel[] {
  const wallLength = getWallLength(wall)
  const wallAngle = getWallAngle(wall)
  const wallDirection =
    wallLength > 0
      ? {
          x: (wall.end.x - wall.start.x) / wallLength,
          y: (wall.end.y - wall.start.y) / wallLength,
        }
      : { x: 0, y: 0 }

  return models.map((model) => {
    if (model.wallAttachment?.wallId !== wall.id) {
      return model
    }

    const definition = context?.definitions.get(model.modelId)
    if (definition?.kitchenUnitDesign?.unitType === 'wall') {
      const mount = fitWallMountedObject(definition, wall, model.wallAttachment, model, context?.walls)
      if (mount) return { ...model, ...mount }
    }

    const offset = Math.max(
      0,
      Math.min(wallLength, model.wallAttachment.offset),
    )

    return {
      ...model,
      position: {
        x: wall.start.x + wallDirection.x * offset,
        y: wall.start.y + wallDirection.y * offset,
      },
      rotation: wallAngle + ((model.wallAttachment.side ?? 1) < 0 ? Math.PI : 0),
      wallAttachment: {
        ...model.wallAttachment,
        offset,
      },
    }
  })
}
