import {
  getRoofLocalPoint,
  getRoofPanelLocalExtents,
  getRoofSupportBoundsInRoofSpace,
  getRoofWorldPointFromLocal,
} from './roofBuildingGeometry.ts'
import {
  getHipRoofProfileHeight,
  getPitchedRoofHeightAtX,
  getRoofSlope,
} from './roofProfile.ts'
import { getRoofThickness } from './roofThickness.ts'
import { DEFAULT_EXTERNAL_WALL_THICKNESS_METERS } from './wallGeometry.ts'
import type { PlacedModel, Point, RoofAttachment, RoofStructure, Wall } from './types.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'

export type DormerPlacement = {
  position: Point
  roofAttachment: RoofAttachment
  rotation: number
  surfaceHeight: number
}

export type DormerStructuralAssembly = {
  depth: number
  roof: RoofStructure
  roofHalfWidth: number
  roofRise: number
  wallBaseY: number
  wallHeight: number
  walls: [Wall, Wall, Wall]
  windowBottom: number
  windowHeight: number
  windowWidth: number
}

export function roofSupportsDormers(roof: RoofStructure) {
  return roof.type === 'up-and-over' || roof.type === 'hip'
}

function getDormerRotation(roofRotation: number, surface: RoofAttachment['surface']) {
  switch (surface) {
    case 'negative-x':
      return Math.PI / 2 - roofRotation
    case 'positive-x':
      return -Math.PI / 2 - roofRotation
    case 'negative-y':
      return Math.PI - roofRotation
    case 'positive-y':
      return -roofRotation
  }
}

function getHipSurface(
  point: Point,
  extents: ReturnType<typeof getRoofPanelLocalExtents>,
): RoofAttachment['surface'] {
  const candidates: Array<{ distance: number; surface: RoofAttachment['surface'] }> = [
    { distance: point.x - extents.minX, surface: 'negative-x' },
    { distance: extents.maxX - point.x, surface: 'positive-x' },
    { distance: point.y - extents.minY, surface: 'negative-y' },
    { distance: extents.maxY - point.y, surface: 'positive-y' },
  ]

  return candidates.sort((a, b) => a.distance - b.distance)[0].surface
}

function pointHasDormerClearance(
  point: Point,
  surface: RoofAttachment['surface'],
  extents: ReturnType<typeof getRoofPanelLocalExtents>,
  width: number,
  depth: number,
) {
  const edgeInset = 0.08
  const crossSlopeInset = Math.max(width / 2, 0.2) + edgeInset
  const uphillClearance = Math.max(depth * 0.55, 0.35)

  if (surface === 'negative-x' || surface === 'positive-x') {
    if (
      point.y < extents.minY + crossSlopeInset ||
      point.y > extents.maxY - crossSlopeInset
    ) return false

    const uphillRoom = surface === 'negative-x'
      ? extents.maxX - point.x
      : point.x - extents.minX
    const eaveRoom = surface === 'negative-x'
      ? point.x - extents.minX
      : extents.maxX - point.x
    return uphillRoom >= uphillClearance && eaveRoom >= edgeInset
  }

  if (
    point.x < extents.minX + crossSlopeInset ||
    point.x > extents.maxX - crossSlopeInset
  ) return false

  const uphillRoom = surface === 'negative-y'
    ? extents.maxY - point.y
    : point.y - extents.minY
  const eaveRoom = surface === 'negative-y'
    ? point.y - extents.minY
    : extents.maxY - point.y
  return uphillRoom >= uphillClearance && eaveRoom >= edgeInset
}

function getHipPlaneUphillRoom(
  point: Point,
  surface: RoofAttachment['surface'],
  extents: ReturnType<typeof getRoofPanelLocalExtents>,
) {
  const negativeX = point.x - extents.minX
  const positiveX = extents.maxX - point.x
  const negativeY = point.y - extents.minY
  const positiveY = extents.maxY - point.y

  switch (surface) {
    case 'negative-x':
      return Math.min((positiveX - negativeX) / 2, negativeY - negativeX, positiveY - negativeX)
    case 'positive-x':
      return Math.min((negativeX - positiveX) / 2, negativeY - positiveX, positiveY - positiveX)
    case 'negative-y':
      return Math.min((positiveY - negativeY) / 2, negativeX - negativeY, positiveX - negativeY)
    case 'positive-y':
      return Math.min((negativeY - positiveY) / 2, negativeX - positiveY, positiveX - positiveY)
  }
}

export function getDormerPlacementOnRoof(
  roof: RoofStructure,
  worldPoint: Point,
  width: number,
  depth: number,
): DormerPlacement | null {
  if (!roofSupportsDormers(roof)) return null

  const localPosition = getRoofLocalPoint(roof, worldPoint)
  const extents = getRoofPanelLocalExtents(roof)
  const support = getRoofSupportBoundsInRoofSpace(roof)
  const ridgeX = (support.minX + support.maxX) / 2
  const surface: RoofAttachment['surface'] = roof.type === 'up-and-over'
    ? localPosition.x <= ridgeX ? 'negative-x' : 'positive-x'
    : getHipSurface(localPosition, extents)

  if (!pointHasDormerClearance(localPosition, surface, extents, width, depth)) {
    return null
  }

  if (
    roof.type === 'hip' &&
    getHipPlaneUphillRoom(localPosition, surface, extents) <
      Math.max(depth * 0.55, 0.35)
  ) return null

  if (roof.type === 'up-and-over') {
    const distanceToRidge = surface === 'negative-x'
      ? ridgeX - localPosition.x
      : localPosition.x - ridgeX
    if (distanceToRidge < Math.max(depth * 0.55, 0.35)) return null
  }

  const surfaceHeight = roof.type === 'hip'
    ? getHipRoofProfileHeight(roof, extents, support, localPosition)
    : getPitchedRoofHeightAtX(roof, support, localPosition.x)

  return {
    position: getRoofWorldPointFromLocal(roof, localPosition),
    roofAttachment: {
      localPosition,
      roofId: roof.id,
      surface,
    },
    rotation: getDormerRotation(roof.rotation, surface),
    surfaceHeight,
  }
}

export function getAttachedDormerPlacement(
  roof: RoofStructure,
  attachment: RoofAttachment,
): DormerPlacement | null {
  if (!roofSupportsDormers(roof) || roof.id !== attachment.roofId) return null

  const extents = getRoofPanelLocalExtents(roof)
  const support = getRoofSupportBoundsInRoofSpace(roof)
  const surfaceHeight = roof.type === 'hip'
    ? getHipRoofProfileHeight(roof, extents, support, attachment.localPosition)
    : getPitchedRoofHeightAtX(roof, support, attachment.localPosition.x)

  return {
    position: getRoofWorldPointFromLocal(roof, attachment.localPosition),
    roofAttachment: attachment,
    rotation: getDormerRotation(roof.rotation, attachment.surface),
    surfaceHeight,
  }
}

export function findDormerPlacement(
  roofs: RoofStructure[],
  worldPoint: Point,
  width: number,
  depth: number,
) {
  return roofs
    .filter(roofSupportsDormers)
    .map((roof) => ({
      placement: getDormerPlacementOnRoof(roof, worldPoint, width, depth),
      roof,
    }))
    .filter((candidate): candidate is { placement: DormerPlacement; roof: RoofStructure } =>
      Boolean(candidate.placement))
    .sort((a, b) => b.placement.surfaceHeight - a.placement.surfaceHeight)[0] ?? null
}

/** Move on the attached roof face, keeping the complete valley on that face. */
export function getMovedDormerPlacement(
  roof: RoofStructure,
  model: PlacedModel,
  definition: ModelDefinition,
  worldPoint: Point,
  windowDefinition?: ModelDefinition,
): DormerPlacement | null {
  if (!model.roofAttachment || model.roofAttachment.roofId !== roof.id) return null
  const scale = model.scale ?? 1, widthScale = model.widthScale ?? 1, depthScale = model.depthScale ?? 1
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id,
    width: model.dormerWidth, height: model.dormerHeight, depthScale, windowDefinition })
  const placement = getDormerPlacementOnRoof(roof, worldPoint,
    assembly.roofHalfWidth * 2 * scale * widthScale, assembly.depth * scale * depthScale)
  if (!placement || placement.roofAttachment.surface !== model.roofAttachment.surface) return null
  const extents = getRoofPanelLocalExtents(roof)
  const support = getRoofSupportBoundsInRoofSpace(roof)
  const ridgeX = (support.minX + support.maxX) / 2
  const footprint = getDormerOpeningPolygon({ ...model, ...placement }, definition, roof, windowDefinition)
  const fits = footprint.every(point => {
    const local = getRoofLocalPoint(roof, point)
    if (local.x < extents.minX || local.x > extents.maxX || local.y < extents.minY || local.y > extents.maxY) return false
    if (roof.type === 'up-and-over') return placement.roofAttachment.surface === 'negative-x'
      ? local.x <= ridgeX + 1e-6 : local.x >= ridgeX - 1e-6
    return getHipPlaneUphillRoom(local, placement.roofAttachment.surface, extents) >= -1e-6
  })
  return fits ? placement : null
}

/** The roof aperture beneath a dormer, expressed in world-plan coordinates. */
export function getDormerOpeningPolygon(
  model: PlacedModel,
  definition: ModelDefinition,
  roof?: RoofStructure,
  windowDefinition?: ModelDefinition,
): Point[] {
  const scale = model.scale ?? 1
  const widthScale = model.widthScale ?? 1
  const depthScale = model.depthScale ?? 1
  const assembly = createDormerStructuralAssembly({
    definition, hostRoof: roof, ownerId: model.id, windowDefinition, depthScale,
    width: model.dormerWidth, height: model.dormerHeight,
  })
  const halfWidth = Math.abs(assembly.walls[0].start.x)
  const placement = roof && model.roofAttachment
    ? getAttachedDormerPlacement(roof, model.roofAttachment) : null
  const rotation = placement?.rotation ?? model.rotation
  const position = placement?.position ?? model.position
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const toWorld = (x: number, z: number): Point => ({
    x: position.x + scale * (cos * x * widthScale - sin * z * depthScale),
    y: position.y + scale * (sin * x * widthScale + cos * z * depthScale),
  })
  // The valley follows the intersection of the two pitched roofs. Cutting to
  // wall centre lines hides the aperture edges inside the closed dormer walls.
  const slope = getRoofSlope(assembly.roof.pitchDegrees)
  const hostSlope = slope * depthScale
  const ridgeHeight = assembly.wallHeight + assembly.roofRise
  const sideDepth = (ridgeHeight - halfWidth * slope) / hostSlope
  return [
    toWorld(-halfWidth, 0),
    toWorld(halfWidth, 0),
    toWorld(halfWidth, -sideDepth),
    toWorld(0, -ridgeHeight / hostSlope),
    toWorld(-halfWidth, -sideDepth),
  ]
}

function getDormerWallMetrics(
  definition: ModelDefinition,
  windowDefinition?: ModelDefinition,
  requestedHeight?: number,
  gable?: { rise: number; slope: number; thickness: number },
) {
  const width = definition.width
  const maximumWindowWidth = width * 0.66
  const windowBottom = Math.max(0.12, definition.height * 0.1)
  const head = Math.max(0.16, definition.height * 0.12)
  const maximumWindowHeight = definition.height * 0.64
  const sourceWindowWidth = Math.max(windowDefinition?.width ?? maximumWindowWidth, 0.1)
  const sourceWindowHeight = Math.max(windowDefinition?.height ?? maximumWindowHeight, 0.1)
  // A wide, low dormer can use the gable above the eaves. Fit both top
  // corners below the pitched lining instead of shrinking it below the eave.
  const heightScale = requestedHeight !== undefined && gable
    ? Math.max(0.1, requestedHeight + gable.rise - gable.thickness - windowBottom - head) /
      (sourceWindowHeight + gable.slope * sourceWindowWidth / 2)
    : maximumWindowHeight / sourceWindowHeight
  const windowScale = Math.min(
    maximumWindowWidth / sourceWindowWidth,
    heightScale,
  )
  const windowWidth = sourceWindowWidth * windowScale
  const windowHeight = sourceWindowHeight * windowScale
  const wallHeight = requestedHeight ?? windowBottom + windowHeight + head

  return { wallHeight, windowBottom, windowHeight, windowWidth }
}

/** Build the dormer from the same wall/opening and roof primitives as the house. */
export function createDormerStructuralAssembly({
  definition,
  hostRoof,
  ownerId,
  wallBaseY: requestedWallBaseY,
  depthScale = 1,
  windowDefinition,
  width: requestedWidth,
  height: requestedHeight,
}: {
  definition: ModelDefinition
  width?: number
  height?: number
  depthScale?: number
  hostRoof?: RoofStructure
  ownerId: string
  wallBaseY?: number
  windowDefinition?: ModelDefinition
}): DormerStructuralAssembly {
  const width = Number.isFinite(requestedWidth) ? Math.max(0.5, requestedWidth!) : definition.width
  const height = Number.isFinite(requestedHeight) ? Math.max(0.5, requestedHeight!) : undefined
  const hostRoofThickness = hostRoof ? getRoofThickness(hostRoof) : 0.08
  const wallThickness = DEFAULT_EXTERNAL_WALL_THICKNESS_METERS
  const roofHalfWidth = Math.max(width * 0.58, width / 2 + wallThickness / 2 + 0.08)
  const pitchDegrees = Math.min(75, Math.max(1, hostRoof?.pitchDegrees ?? 35))
  // Embed the full external wall through the host skin at its outer face.
  const roofEmbeddedBase = -hostRoofThickness - wallThickness / 2 * getRoofSlope(pitchDegrees) * depthScale
  const wallBaseY = Math.min(requestedWallBaseY ?? roofEmbeddedBase, roofEmbeddedBase)
  const roofRise = roofHalfWidth * getRoofSlope(pitchDegrees)
  const { wallHeight, windowBottom, windowHeight, windowWidth } =
    getDormerWallMetrics({ ...definition, width }, windowDefinition, height,
      { rise: roofRise, slope: getRoofSlope(pitchDegrees), thickness: hostRoofThickness })
  const depth = (wallHeight + roofRise) / (getRoofSlope(pitchDegrees) * depthScale)
  const wall = (
    id: string,
    start: Point,
    end: Point,
    openings?: Wall['openings'],
  ): Wall => ({
    end,
    height: wallHeight - wallBaseY,
    id: `${ownerId}:${id}`,
    kind: 'external',
    openings,
    start,
    thickness: wallThickness,
  })
  const frontOpening = {
    bottom: windowBottom - wallBaseY,
    center: width / 2,
    height: windowHeight,
    id: `${ownerId}:window-opening`,
    modelId: windowDefinition?.id ?? 'window',
    width: windowWidth,
  }

  return {
    depth,
    roof: {
      depth,
      id: `${ownerId}:roof`,
      pitchDegrees,
      position: { x: 0, y: -depth / 2 },
      rotation: 0,
      soffitColor: hostRoof?.soffitColor,
      thickness: hostRoofThickness,
      type: 'up-and-over',
      width: roofHalfWidth * 2,
    },
    roofHalfWidth,
    roofRise,
    wallBaseY,
    wallHeight,
    walls: [
      wall('front-wall', { x: -width / 2, y: 0 }, { x: width / 2, y: 0 }, [frontOpening]),
      wall('left-cheek', { x: -width / 2, y: 0 }, { x: -width / 2, y: -depth }),
      wall('right-cheek', { x: width / 2, y: -depth }, { x: width / 2, y: 0 }),
    ],
    windowBottom,
    windowHeight,
    windowWidth,
  }
}
