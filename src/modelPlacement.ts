import type { FloorLevel, PlacedModel, Point, Wall, WallOpening } from './types'
import type { ModelDefinition } from './models/modelLibrary'

const WINDOW_SILL_HEIGHT_METERS = 0.9
const PATIO_DOOR_WIDTH_METERS = 1.62
const PATIO_SIDE_LIGHT_BOTTOM_METERS = 1.02

type ModelsById = ReadonlyMap<string, ModelDefinition>

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

      return {
        distance: distance(point, projection.point),
        point: projection.point,
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
    rotation: getWallAngle(closest.wall),
    wallAttachment: {
      wallId: closest.wall.id,
      offset: closest.t * getWallLength(closest.wall),
    },
  }
}

function openingBelongsToModel(opening: WallOpening, modelIds: Set<string>) {
  const [ownerId] = opening.id.split(':')
  return modelIds.has(ownerId)
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
  const wallLength = getWallLength(wall)
  const width = Math.min(
    Math.max((definition.openingWidth ?? definition.width) * scale, 0.3),
    Math.max(wallLength - 0.2, 0.3),
  )
  const bottom =
    definition.wallMount === 'window'
      ? Math.min(WINDOW_SILL_HEIGHT_METERS, Math.max(wall.height - 0.2, 0))
      : 0
  const height = Math.min(Math.max(definition.height * scale, 0.3), Math.max(wall.height - bottom, 0.3))
  const openingCenter =
    model.wallAttachment.offset + (definition.openingCenterOffset ?? 0) * scale

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
    PATIO_DOOR_WIDTH_METERS * scale,
    Math.max(wallLength - 0.2, 0.3),
  )
  const sideLightWidth = Math.max((definition.width * scale - centreDoorWidth) / 2, 0)
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
      center: clampCenter(model.wallAttachment.offset - sideLightOffset, sideLightWidth),
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
    {
      ...opening,
      id: `${model.id}:doors`,
      center: clampCenter(model.wallAttachment.offset, centreDoorWidth),
      width: centreDoorWidth,
      bottom: 0,
      height: Math.min(definition.height * scale, wall.height),
    },
    {
      ...opening,
      id: `${model.id}:right-side-light`,
      center: clampCenter(model.wallAttachment.offset + sideLightOffset, sideLightWidth),
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
  const modelsByWallId = new Map<string, PlacedModel[]>()

  for (const model of floor.models ?? []) {
    if (!model.wallAttachment) {
      continue
    }

    modelsByWallId.set(model.wallAttachment.wallId, [
      ...(modelsByWallId.get(model.wallAttachment.wallId) ?? []),
      model,
    ])
  }

  return {
    ...floor,
    walls: floor.walls.map((wall) => {
      const modelOpenings = (modelsByWallId.get(wall.id) ?? [])
        .flatMap((model) => getModelOpenings(model, wall, modelsById))
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
            height:
              definition?.isLight &&
              (typeof model.height !== 'number' || !Number.isFinite(model.height))
                ? Math.min(floor.roomHeight - 0.2, 1.8)
                : model.height,
            lightColor:
              definition?.isLight && !model.lightColor
                ? definition.lightColor
                : model.lightColor,
            lightEnabled:
              definition?.isLight && typeof model.lightEnabled !== 'boolean'
                ? true
                : model.lightEnabled,
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
            scale:
              typeof model.scale === 'number' && Number.isFinite(model.scale)
                ? model.scale
                : 1,
          }
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
    height: definition?.isLight ? 1.8 : undefined,
    id,
    lightColor: definition?.isLight ? definition.lightColor : undefined,
    lightEnabled: definition?.isLight ? true : undefined,
    lightPower: definition?.isLight ? definition.lightPower : undefined,
    lightSpread: definition?.lightKind === 'spot' ? definition.lightSpread : undefined,
    modelId,
    position: wallMount?.position ?? planCenter,
    rotation: wallMount?.rotation ?? 0,
    scale: 1,
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
      rotation: wallAngle,
      wallAttachment: {
        ...model.wallAttachment,
        offset,
      },
    }
  })
}
