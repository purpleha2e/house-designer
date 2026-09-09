import type { FloorLevel, PlacedModel, Point, Wall, WallOpening } from './types'
import type { ModelDefinition } from './models/modelLibrary'

const WINDOW_SILL_HEIGHT_METERS = 0.9
const PATIO_DOOR_WIDTH_METERS = 1.62
const PATIO_SIDE_LIGHT_BOTTOM_METERS = 1.02

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

export function getWallMountForPoint(point: Point, walls: Wall[]) {
  const candidates = walls
    .map((wall) => {
      const projection = getProjectionOnWall(point, wall)
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
        (point.x - projection.point.x) * normal.x +
        (point.y - projection.point.y) * normal.y
      const side: -1 | 1 = signedDistance < 0 ? -1 : 1

      return {
        distance: distance(point, projection.point),
        point: projection.point,
        side,
        t: projection.t,
        wall,
      }
    })
    .filter((candidate) => candidate.distance <= 0.55)
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
      offset: closest.t * getWallLength(closest.wall),
      side: closest.side,
    },
  }
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

function getRawModelOpenings(
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
  const modelOffset = getModelOffsetOnWall(model, wall)
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
  return getRawModelOpenings(model, wall, modelsById).flatMap((opening) =>
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
  return syncWallOpenings({
    ...floor,
    models: Array.isArray(floor.models)
      ? floor.models.map((model) => {
          const definition = modelsById.get(model.modelId)

          return {
            ...model,
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
            roof.type === 'up-and-over'
            ? [{
                ...roof,
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
                  typeof roof.rotation === 'number' &&
                  Number.isFinite(roof.rotation)
                    ? roof.rotation
                    : 0,
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
  }, modelsById)
}

export function createPlacedModel({
  id,
  modelId,
  modelsById,
  walls,
}: {
  id: string
  modelId: string
  modelsById: ModelsById
  walls: Wall[]
}): PlacedModel {
  const definition = modelsById.get(modelId)
  const planCenter = getPlanCenter(walls)
  const wallMount = definition?.wallMount
    ? getWallMountForPoint(planCenter, walls)
    : null

  return {
    flipped: false,
    height: definition?.isLight ? 1.8 : undefined,
    id,
    lightColor: definition?.isLight ? definition.lightColor : undefined,
    lightDistance: definition?.isLight ? definition.lightDistance : undefined,
    lightEnabled: definition?.isLight ? true : undefined,
    lightFalloff: definition?.isLight ? definition.lightFalloff : undefined,
    lightPower: definition?.isLight ? definition.lightPower : undefined,
    lightSpread: definition?.lightKind === 'spot' ? definition.lightSpread : undefined,
    mirrored: false,
    modelId,
    position: wallMount?.position ?? planCenter,
    rotation: wallMount?.rotation ?? 0,
    scale: 1,
    widthScale: 1,
    depthScale: 1,
    wallAttachment: wallMount?.wallAttachment,
  }
}

export function updateWallAttachedModels(
  models: PlacedModel[],
  wall: Wall,
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
