import type { FloorLevel, PlacedModel, Wall, WallOpening } from './types.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'
import { createDormerStructuralAssembly, getAttachedDormerPlacement } from './dormerPlacement.ts'
import { getRoofWithExternalWallSupportExtents } from './roofBuildingGeometry.ts'

type Definitions = ReadonlyMap<string, ModelDefinition>
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function getDormerWindowHost(floor: Pick<FloorLevel, 'models' | 'roofs' | 'walls' | 'roomHeight'>,
  dormerId: string, definitions: Definitions) {
  const model = floor.models.find(candidate => candidate.id === dormerId)
  const definition = model && definitions.get(model.modelId)
  const rawRoof = floor.roofs?.find(roof => roof.id === model?.roofAttachment?.roofId)
  if (!model || definition?.roofMount !== 'dormer' || !rawRoof || !model.roofAttachment) return null
  const roof = getRoofWithExternalWallSupportExtents(rawRoof, floor.walls)
  const placement = getAttachedDormerPlacement(roof, model.roofAttachment)
  if (!placement) return null
  const windowDefinition = definitions.get(model.dormerWindowModelId ?? '') ??
    [...definitions.values()].find(candidate => candidate.wallMount === 'window')
  const assembly = createDormerStructuralAssembly({ definition, ownerId: model.id, hostRoof: roof,
    width: model.dormerWidth, height: model.dormerHeight, depthScale: model.depthScale,
    windowDefinition, windowOpenings: model.dormerWindowOpenings })
  const scale = model.scale ?? 1, widthScale = scale * (model.widthScale ?? 1)
  const depthScale = scale * (model.depthScale ?? 1)
  const cos = Math.cos(placement.rotation), sin = Math.sin(placement.rotation)
  const toWorld = (x: number) => ({ x: placement.position.x + x * widthScale * cos,
    y: placement.position.y + x * widthScale * sin })
  const wall: Wall = { ...assembly.walls[0], start: toWorld(assembly.walls[0].start.x),
    end: toWorld(assembly.walls[0].end.x), thickness: assembly.walls[0].thickness * depthScale,
    height: (assembly.wallHeight + assembly.roofRise) * scale }
  const mountBottom = floor.roomHeight + (roof.heightOffset ?? 0) + placement.surfaceHeight
  return { model, definition, assembly, placement, wall, scale, widthScale, depthScale, cos, sin, toWorld, mountBottom }
}

/** Keep attached windows on the front face; size is independent of the dormer.
 * Clamp only when a resize would cross a cheek or the pitched roof lining. */
export function fitDormerWindow(floor: FloorLevel, window: PlacedModel, definitions: Definitions): PlacedModel {
  const host = window.dormerAttachment && getDormerWindowHost(floor, window.dormerAttachment.dormerId, definitions)
  const definition = definitions.get(window.modelId)
  if (!host || !definition || !window.dormerAttachment) return window
  const { assembly } = host
  const halfWidth = Math.abs(assembly.walls[0].start.x)
  const widthScale = Math.max(0.02, window.widthScale ?? 1)
  let scale = Math.max(0.02, window.scale ?? 1)
  scale = Math.min(scale, (2 * halfWidth - 0.12) * host.widthScale / (definition.width * widthScale))
  const localHalfWidth = definition.width * scale * widthScale / host.widthScale / 2
  const offset = clamp(window.dormerAttachment.offset, -halfWidth + localHalfWidth + 0.06, halfWidth - localHalfWidth - 0.06)
  const slope = assembly.roofRise / assembly.roofHalfWidth
  const ridge = assembly.wallHeight + assembly.roofRise - (assembly.roof.thickness ?? 0.08) - 0.06
  const bottom = clamp(window.dormerAttachment.bottom, 0.05,
    Math.max(0.05, ridge - slope * (Math.abs(offset) + localHalfWidth) - 0.1))
  // Both top corners must fit. This also reduces width proportionally if
  // uniform scaling reaches the sloping head of the opening.
  scale = Math.min(scale, Math.max(0.02, (ridge - bottom - slope * Math.abs(offset)) /
    (definition.height / host.scale + slope * definition.width * widthScale / host.widthScale / 2)))
  const depthScale = Math.min(window.depthScale ?? 1, host.wall.thickness * 0.9 / (definition.depth * scale))
  return { ...window, scale, widthScale, depthScale, position: host.toWorld(offset), rotation: host.placement.rotation,
    dormerAttachment: { dormerId: host.model.id, offset, bottom },
    roofAttachment: undefined, wallOpeningBottom: host.mountBottom + bottom * host.scale,
    wallAttachment: { wallId: host.wall.id, offset: (offset + halfWidth) * host.widthScale, side: 1 } }
}

/** Project standard model move controls back onto the attached front face. */
export function updateDormerWindow(floor: FloorLevel, window: PlacedModel, updates: Partial<PlacedModel>, definitions: Definitions) {
  const host = window.dormerAttachment && getDormerWindowHost(floor, window.dormerAttachment.dormerId, definitions)
  if (!host || !window.dormerAttachment) return { ...window, ...updates }
  const attachment = { ...window.dormerAttachment, ...updates.dormerAttachment }
  if (updates.position) attachment.offset = ((updates.position.x - host.placement.position.x) * host.cos +
    (updates.position.y - host.placement.position.y) * host.sin) / host.widthScale
  if (updates.wallOpeningBottom !== undefined) attachment.bottom = (updates.wallOpeningBottom - host.mountBottom) / host.scale
  return fitDormerWindow(floor, { ...window, ...updates, dormerAttachment: attachment }, definitions)
}

export function createDormerWindow(floor: FloorLevel, dormerId: string, modelId: string, id: string, definitions: Definitions) {
  const host = getDormerWindowHost(floor, dormerId, definitions), definition = definitions.get(modelId)
  if (!host || definition?.wallMount !== 'window') return null
  const width = Math.abs(host.assembly.walls[0].start.x) * 2 * host.widthScale
  const scale = Math.min(1, width * 0.66 / definition.width, host.assembly.wallHeight * host.scale * 0.64 / definition.height)
  return fitDormerWindow(floor, { id, modelId, scale, widthScale: 1,
    depthScale: Math.min(0.14, definition.depth) / (definition.depth * scale),
    position: host.placement.position, rotation: host.placement.rotation,
    dormerAttachment: { dormerId, offset: 0, bottom: host.assembly.windowBottom } }, definitions)
}

/** Openings are derived just like ordinary wall openings. Removing the window
 * removes its opening; removing the dormer removes its attached windows. */
export function syncDormerWindows(floor: FloorLevel, definitions: Definitions): FloorLevel {
  if (!floor.models.some(model => model.dormerAttachment || model.dormerWindowOpenings !== undefined)) return floor
  const parents = new Set(floor.models.filter(model => definitions.get(model.modelId)?.roofMount === 'dormer').map(model => model.id))
  const models = floor.models.filter(model => !model.dormerAttachment || parents.has(model.dormerAttachment.dormerId))
    .map(model => model.dormerAttachment ? fitDormerWindow(floor, model, definitions) : model)
  const openings = new Map<string, WallOpening[]>()
  for (const window of models) {
    const attachment = window.dormerAttachment
    const definition = definitions.get(window.modelId)
    const host = attachment && getDormerWindowHost(floor, attachment.dormerId, definitions)
    if (!attachment || !definition || !host) continue
    const list = openings.get(attachment.dormerId) ?? []
    list.push({ id: window.id, modelId: window.modelId,
      center: attachment.offset + Math.abs(host.assembly.walls[0].start.x), bottom: attachment.bottom,
      width: definition.width * window.scale * (window.widthScale ?? 1) / host.widthScale,
      height: definition.height * window.scale / host.scale })
    openings.set(attachment.dormerId, list)
  }
  const nextModels = models.map(model => model.dormerWindowOpenings !== undefined || openings.has(model.id)
    ? { ...model, dormerWindowOpenings: openings.get(model.id) ?? [] } : model)
  return JSON.stringify(nextModels) === JSON.stringify(floor.models) ? floor : { ...floor, models: nextModels }
}

/** Convert legacy embedded windows once, preserving their fitted dimensions. */
export function migrateDormerWindows(floor: FloorLevel, definitions: Definitions): FloorLevel {
  const models = [...floor.models]
  for (const [index, parent] of floor.models.entries()) {
    if (definitions.get(parent.modelId)?.roofMount !== 'dormer' || parent.dormerWindowOpenings !== undefined) continue
    const host = getDormerWindowHost(floor, parent.id, definitions)
    if (!host) continue
    const definition = definitions.get(parent.dormerWindowModelId ?? '') ?? [...definitions.values()].find(d => d.wallMount === 'window')
    models[index] = { ...parent, dormerHeight: host.assembly.wallHeight, dormerWindowOpenings: [] }
    if (!definition || models.some(model => model.dormerAttachment?.dormerId === parent.id)) continue
    let id = `${parent.id}:window`
    while (models.some(model => model.id === id)) id += ':window'
    const scale = host.assembly.windowHeight * host.scale / definition.height
    models.push({ id, modelId: definition.id, scale,
      widthScale: host.assembly.windowWidth * host.widthScale / (definition.width * scale),
      depthScale: Math.max(0.06, Math.min(definition.depth, 0.14)) * host.depthScale / (definition.depth * scale),
      position: parent.position, rotation: parent.rotation,
      dormerAttachment: { dormerId: parent.id, offset: 0, bottom: host.assembly.windowBottom } })
  }
  return syncDormerWindows({ ...floor, models }, definitions)
}
