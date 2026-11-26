import { ASSISTANT_PROMPT_LIMIT, asRecord, validRequirements, type ConversationTurn } from '../src/assistant/intent.ts'
import { validToolArguments, type AgentRequest } from '../src/assistant/architecturalTools.ts'
import type { SceneSource } from '../src/assistant/scene.ts'
import type { DesignProposal } from '../src/assistant/proposal.ts'
import type { FloorLevel, PlacedModel, Point, Room, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import { validateStairDesign } from '../src/stairDesign.ts'

const finite = (v: unknown, min = -10_000, max = 10_000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const text = (v: unknown, max = 140): v is string => typeof v === 'string' && v.length <= max && !!v.trim()
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max
const point = (v: unknown): v is Point => { const p = asRecord(v); return !!p && finite(p.x) && finite(p.y) }
const outline = (v: unknown): v is Point[] => list(v, 120) && v.length >= 3 && v.every(point)
const isRoomFunction = (v: unknown): v is Room['function'] => v === undefined || v === 'bedroom' || v === 'bathroom' || v === 'landing' ||
  v === 'kitchen-diner' || v === 'utility' || v === 'office' || v === 'living-room' || v === 'cloakroom'
const strings = (value: unknown, count: number, length: number): string[] => list(value, count) ? value.filter(item => text(item, length)) : []

function wall(v: unknown): v is Wall {
  const w = asRecord(v)
  return !!w && text(w.id) && (w.kind === 'external' || w.kind === 'internal') && point(w.start) && point(w.end) &&
    finite(w.thickness, 0.01, 5) && finite(w.height, 0.01, 15) && (w.openings === undefined || list(w.openings, 30) && w.openings.every(entry => {
      const o = asRecord(entry)
      return !!o && text(o.id, 300) && text(o.modelId) && finite(o.center, 0, 500) && finite(o.width, 0.001, 50) && finite(o.bottom, 0, 15) && finite(o.height, 0.001, 15)
    }))
}

function model(v: unknown): v is PlacedModel {
  const m = asRecord(v)
  if (!m || !text(m.id) || !text(m.modelId) || !point(m.position) || !finite(m.rotation, -100, 100) || !finite(m.scale, 0.05, 20)) return false
  return [m.widthScale, m.depthScale].every(scale => scale === undefined || finite(scale, 0.05, 20)) &&
    (m.wallAttachment === undefined || (() => { const a = asRecord(m.wallAttachment); return !!a && text(a.wallId) && finite(a.offset, -500, 500) })())
}

function floor(v: unknown): v is FloorLevel {
  const f = asRecord(v)
  return !!f && text(f.id) && text(f.name, 100) && finite(f.elevation, -100, 150) && finite(f.roomHeight, 0.05, 10) && finite(f.slabThickness, 0, 3) &&
    (f.floorFootprints === undefined || list(f.floorFootprints, 15) && f.floorFootprints.every(outline)) &&
    list(f.walls, 180) && f.walls.every(wall) && new Set(f.walls.map(wall => (wall as Wall).id)).size === f.walls.length &&
    list(f.models, 160) && f.models.every(model) && list(f.rooms, 110) && f.rooms.every(entry => {
      const r = asRecord(entry)
      return !!r && text(r.id) && text(r.signature, 4000) && text(r.name, 100) && isRoomFunction(r.function) &&
        (r.ceilingMode === undefined || r.ceilingMode === 'horizontal' || r.ceilingMode === 'open')
    })
}

function definition(v: unknown): v is ModelDefinition {
  const m = asRecord(v)
  return !!m && text(m.id) && text(m.name, 100) && text(m.category, 100) && text(m.color, 40) &&
    ['box', 'light', 'round'].includes(String(m.shape)) && [m.width, m.height, m.depth].every(d => finite(d, 0, 25)) &&
    (m.stairDesign === undefined || !validateStairDesign(m.stairDesign)) &&
    (m.stairFootprint === undefined || list(m.stairFootprint, 10) && m.stairFootprint.every(outline)) &&
    [m.stairLandings, m.stairLandingDirections].every(pair => {
      const entry = asRecord(pair)
      return pair === undefined || !!entry && point(entry.lower) && point(entry.upper)
    }) &&
    (m.localBounds === undefined || (() => { const b = asRecord(m.localBounds); return !!b && [b.minX, b.maxX, b.minZ, b.maxZ].every(n => finite(n, -50, 50)) })()) &&
    (m.openingWidth === undefined || finite(m.openingWidth, 0.001, 30)) && (m.openingCenterOffset === undefined || finite(m.openingCenterOffset, -25, 25))
}

function compactSource(input: unknown): SceneSource | null {
  const source = asRecord(input)
  const selection = asRecord(source?.selection)
  if (!source || !text(source.projectId, 160) || !text(source.revision, 100) || !finite(source.partitionThickness, 0.05, 0.3) ||
      !list(source.floors, 8) || !source.floors.length || !source.floors.every(floor) || !list(source.models, 140) || !source.models.every(definition) ||
      !selection || !text(selection.floorId) || !(selection.roomSignature === null || text(selection.roomSignature, 4000)) ||
      !list(selection.wallIds, 60) || !selection.wallIds.every(id => text(id)) || !list(selection.modelIds, 60) || !selection.modelIds.every(id => text(id)) ||
      !(selection.roofId === null || text(selection.roofId))) return null
  const floors = source.floors as FloorLevel[]
  const models = source.models as ModelDefinition[]
  if (!floors.some(floor => floor.id === selection.floorId) || new Set(floors.map(floor => floor.id)).size !== floors.length ||
      new Set(models.map(model => model.id)).size !== models.length) return null
  const wire = source as unknown as SceneSource
  const wallMaterials = (list(source.wallMaterials, 250) ? source.wallMaterials : []).flatMap(value => {
    const item = asRecord(value)
    return item && text(item.wallId) && text(item.materialId) ? [{ wallId: item.wallId, materialId: item.materialId }] : []
  })
  const roofIdsByFloor = (list(source.roofIdsByFloor, 8) ? source.roofIdsByFloor : []).flatMap(value => {
    const item = asRecord(value)
    return item && text(item.floorId) && list(item.ids, 80) && item.ids.every(id => text(id)) ? [{ floorId: item.floorId, ids: item.ids as string[] }] : []
  })
  // Rebuild the wire shape so image payloads and arbitrary attached properties cannot reach tools.
  return { projectId: wire.projectId, revision: wire.revision, partitionThickness: wire.partitionThickness, selection: {
    floorId: wire.selection.floorId, roomSignature: wire.selection.roomSignature, wallIds: wire.selection.wallIds,
    modelIds: wire.selection.modelIds, roofId: wire.selection.roofId,
  }, wallMaterials, roofIdsByFloor, floors: floors.map(f => ({ id: f.id, name: f.name, elevation: f.elevation, roomHeight: f.roomHeight, slabThickness: f.slabThickness,
    floorFootprints: f.floorFootprints?.map(ring => ring.map(({ x, y }) => ({ x, y }))),
    assistantWindowExclusion: f.assistantWindowExclusion === 'left' || f.assistantWindowExclusion === 'right' ? f.assistantWindowExclusion : undefined,
    walls: f.walls.map(({ id, kind, start, end, thickness, height, openings }) => ({ id, kind, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, thickness, height,
      openings: openings?.map(({ id, modelId, center, width, bottom, height }) => ({ id, modelId, center, width, bottom, height })) })),
    rooms: f.rooms.map(({ id, name, signature, function: role, ceilingMode }) => ({ id, name, signature, function: role, ceilingMode })),
    models: f.models.map(({ id, modelId, position, rotation, scale, flipped, mirrored, widthScale, depthScale, wallAttachment }) => ({
      id, modelId, position: { x: position.x, y: position.y }, rotation, scale, flipped: flipped === true, mirrored: mirrored === true, widthScale, depthScale,
      wallAttachment: wallAttachment ? { wallId: wallAttachment.wallId, offset: wallAttachment.offset } : undefined,
    })),
  })), models: models.map(({ id, name, category, color, shape, width, height, depth, wallMount, objectType, stairDesign, stairFootprint,
    stairLandings, stairLandingDirections, localBounds, normalizeToDimensions, openingWidth, openingCenterOffset }) => ({
    id, name, category, color, shape, width, height, depth, wallMount, objectType, stairDesign, stairFootprint, stairLandings, stairLandingDirections,
    localBounds, normalizeToDimensions: normalizeToDimensions === true, openingWidth, openingCenterOffset,
  })) }
}

function validExtensionOperation(value: unknown, floorId: unknown, source: SceneSource) {
  const operation = asRecord(value)
  return !!operation && text(operation.id, 120) && (operation.type === 'extend-above'
    ? text(operation.lowerFloorId) && text(operation.baseWallId) && source.floors.some(floor => floor.id === operation.lowerFloorId && floor.walls.some(wall => wall.id === operation.baseWallId))
    : operation.type === 'add-extension' && validToolArguments('propose_extension', { floorId, upperFloorId: operation.upperFloorId, spans: operation.spans }))
}

function priorProposal(input: unknown, source: SceneSource): input is DesignProposal {
  const p = asRecord(input)
  const basis = asRecord(p?.extensionBasis)
  return !!p && p.version === 1 && p.projectId === source.projectId && p.sourceRevision === source.revision && text(p.id) &&
    source.floors.some(floor => floor.id === p.floorId) && text(p.workspaceSignature, 4000) &&
    (text(p.stairId) || (p.method === 'room-redesign' || p.method === 'stair-placement' || p.method === 'extension' || p.method === 'coordinated' || p.method === 'model-variants') && p.stairId === '') && validRequirements(p.requirements) &&
    (p.method === 'coordinated' ? validToolArguments('compose_two_storey_layout', p.coordinated) : p.coordinated === undefined) &&
    (p.extensionBasis === undefined || p.method === 'coordinated' && basis !== null && source.floors.some(floor => floor.id === basis.floorId) &&
      validExtensionOperation(basis.operation, basis.floorId, source)) &&
    (p.windowExclusion === undefined || p.method === 'room-redesign' && (p.windowExclusion === 'left' || p.windowExclusion === 'right')) &&
    (p.priority === 'bedrooms' || p.priority === 'landing') && (p.method === 'room-redesign' ? p.redesign === undefined || validRedesign(p.redesign) :
      (p.method === undefined || p.method === 'agent' || p.method === 'stair-placement' || p.method === 'extension' || p.method === 'coordinated' || p.method === 'model-variants') && p.redesign === undefined) && finite(p.layoutAxis, -100, 100) && validMetrics(p.metrics) &&
    list(p.rooms, 10) && p.rooms.every(room => { const r = asRecord(room); return !!r && text(r.id) && text(r.name, 60) &&
      isRoomFunction(r.function) && !!r.function && point(r.labelPoint) && outline(r.polygon) && finite(r.area, 0, 2500) }) &&
      list(p.operations, p.method === 'coordinated' ? 69 : 36) && (p.method !== 'extension' || p.operations.length === 1) && p.operations.every(operation => {
      const op = asRecord(operation)
      if (!op) return false
      if (p.method === 'model-variants') return op.type === 'replace-model-variant' && text(op.floorId) &&
        text(op.instanceId) && text(op.fromModelId) && text(op.modelId)
      if (p.method === 'extension') return op.id === p.id && validExtensionOperation(op, p.floorId, source)
      if (p.method === 'stair-placement' || p.method === 'coordinated' && op.type === 'add-stair') return op.type === 'add-stair' && text(op.id, 120) && text(op.upperFloorId) && point(op.position) &&
        finite(op.rotation, -100, 100) && finite(op.width, 0.8, 1.5) && (op.layout === 'straight' || op.layout === 'l' || op.layout === 'u') &&
        (op.turn === 'left' || op.turn === 'right')
      if (op.type === 'create-partition') return text(op.id) && point(op.start) && point(op.end) && finite(op.thickness, 0.05, 0.3) && finite(op.height, 0, 10)
      if (op.type === 'label-room') return text(op.roomId) && text(op.name, 60) && isRoomFunction(op.function) && !!op.function
      if (p.method === 'room-redesign' || p.method === 'coordinated') {
        if (op.type === 'move-partition') return text(op.wallId) && point(op.start) && point(op.end)
        if (op.type === 'remove-partition') return text(op.wallId)
        if (op.type === 'remove-opening') return text(op.openingId, 300)
        if (op.type === 'create-window') return text(op.id) && text(op.wallId) && point(op.position) && finite(op.offset, 0, 500) &&
          finite(op.rotation, -100, 100) && finite(op.width, 0.35, 3.5) && finite(op.height, 0.35, 3) && finite(op.bottom, 0.4, 2.5)
      }
      return op.type === 'create-doorway' && text(op.id) && text(op.roomId) && text(op.wallId) && point(op.position) && finite(op.offset, 0, 500) &&
        (op.exterior === undefined || p.method === 'room-redesign' && (op.exterior === 'front' || op.exterior === 'patio')) &&
        finite(op.rotation, -100, 100) && (op.side === -1 || op.side === 1) && finite(op.width, 0.3, 5) && finite(op.height, 0.3, 10)
    })
}

function validRedesign(value: unknown) {
  const data = asRecord(value)
  const home = asRecord(data?.home)
  return !!data && text(data.landingId) && (text(data.sharedBathroomId) || data.sharedBathroomId === null) && list(data.bedroomIds, 4) && data.bedroomIds.length > 0 &&
    (data.home === undefined || !!home && (home.kitchenDinerId === null || text(home.kitchenDinerId)) &&
      (home.utilityId === null || text(home.utilityId)) &&
      (home.utilityAccess === undefined || home.utilityAccess === 'hallway' || home.utilityAccess === 'kitchen')) &&
    data.bedroomIds.every(id => text(id)) && list(data.ensuites, 2) && data.ensuites.every(entry => {
      const pair = asRecord(entry)
      return !!pair && text(pair.bedroomId) && text(pair.bathroomId)
    })
}

function validMetrics(value: unknown) {
  const data = asRecord(value)
  return !!data && ['smallestBedroom', 'bedroomArea', 'bathroomArea', 'landingArea', 'circulationWidth', 'daylitBedrooms', 'usableArea']
    .every(key => finite(data[key], 0, 2500)) && typeof data.landingDaylight === 'boolean'
}

function compactPrior(proposal: DesignProposal, source: SceneSource): DesignProposal {
  const { id, version, method, priority, projectId, sourceRevision, floorId, workspaceSignature, stairId, layoutAxis } = proposal
  const { bedrooms, bathrooms, landing, bathroom, primaryBedroom, oppositeBedroom } = proposal.requirements
  const { smallestBedroom, bedroomArea, bathroomArea, landingArea, circulationWidth, daylitBedrooms, landingDaylight, usableArea } = proposal.metrics
  const through = ({ x, y }: Point) => ({ x, y })
  const narrative = asRecord(proposal.narrative)
  const redesign = proposal.redesign
  const basis = proposal.extensionBasis
  const extension = basis?.operation
  return { id, version, method, priority, projectId, sourceRevision, floorId, workspaceSignature, stairId, layoutAxis,
    coordinated: proposal.coordinated,
    extensionBasis: basis && extension ? { floorId: basis.floorId, operation: extension.type === 'add-extension'
      ? { type: extension.type, id: extension.id, upperFloorId: extension.upperFloorId, spans: extension.spans.map(({ wallId, depth }) => ({ wallId, depth })) }
      : { type: extension.type, id: extension.id, lowerFloorId: extension.lowerFloorId, baseWallId: extension.baseWallId } } : undefined,
    windowExclusion: proposal.windowExclusion,
    redesign: redesign ? { landingId: redesign.landingId, bedroomIds: redesign.bedroomIds, sharedBathroomId: redesign.sharedBathroomId,
      ensuites: redesign.ensuites.map(({ bedroomId, bathroomId }) => ({ bedroomId, bathroomId })),
      home: redesign.home && { kitchenDinerId: redesign.home.kitchenDinerId, utilityId: redesign.home.utilityId,
        ...(redesign.home.utilityAccess && { utilityAccess: redesign.home.utilityAccess }) } } : undefined,
    floorName: source.floors.find(floor => floor.id === floorId)!.name,
    requirements: { bedrooms, bathrooms, landing, bathroom, primaryBedroom, oppositeBedroom },
    metrics: { smallestBedroom, bedroomArea, bathroomArea, landingArea, circulationWidth, daylitBedrooms, landingDaylight, usableArea },
    narrative: narrative && text(narrative.title, 55) && text(narrative.explanation, 440) ? {
      title: narrative.title, explanation: narrative.explanation, advantages: strings(narrative.advantages, 3, 125), compromises: strings(narrative.compromises, 3, 125),
    } : undefined,
    assumptions: strings(proposal.assumptions, 7, 200), warnings: strings(proposal.warnings, 10, 200),
    tradeoff: text(proposal.tradeoff, 440) ? proposal.tradeoff : '',
    validation: { passed: true, checks: strings(asRecord(proposal.validation)?.checks, 10, 160) },
    preserved: { stairId, stairOpenings: [], wallIds: [], openingIds: [] }, landingRoute: [],
    rooms: proposal.rooms.map(({ id, name, function: role, polygon, labelPoint, area, windowIds }) => ({
      id, name, function: role, polygon: polygon.map(through), labelPoint: through(labelPoint), area, windowIds: strings(windowIds, 30, 180),
    })),
    operations: proposal.operations.map(operation => {
      if (operation.type === 'replace-model-variant') {
        const { type, floorId, instanceId, fromModelId, modelId } = operation
        return { type, floorId, instanceId, fromModelId, modelId }
      }
      if (operation.type === 'create-partition') {
        const { id, type, start, end, thickness, height } = operation
        return { type, id, start: through(start), end: through(end), thickness, height }
      }
      if (operation.type === 'label-room') return { type: operation.type, roomId: operation.roomId, name: operation.name, function: operation.function }
      if (operation.type === 'move-partition') return { type: operation.type, wallId: operation.wallId, start: through(operation.start), end: through(operation.end) }
      if (operation.type === 'remove-partition') return { type: operation.type, wallId: operation.wallId }
      if (operation.type === 'remove-opening') return { type: operation.type, openingId: operation.openingId }
      if (operation.type === 'add-stair') {
        const { type, id, upperFloorId, position, rotation, width, layout, turn } = operation
        return { type, id, upperFloorId, position: through(position), rotation, width, layout, turn }
      }
      if (operation.type === 'add-extension') {
        const { type, id, upperFloorId, spans } = operation
        return { type, id, upperFloorId, spans: spans.map(({ wallId, depth }) => ({ wallId, depth })) }
      }
      if (operation.type === 'extend-above') {
        const { type, id, lowerFloorId, baseWallId } = operation
        return { type, id, lowerFloorId, baseWallId }
      }
      if (operation.type === 'create-window') {
        const { type, id, wallId, position, offset, rotation, width, height, bottom } = operation
        return { type, id, wallId, position: through(position), offset, rotation, width, height, bottom }
      }
      const { type, id, roomId, wallId, position, offset, rotation, side, width, height, exterior } = operation
      return { type, id, roomId, wallId, position: through(position), offset, rotation, side, width, height, ...(exterior && { exterior }) }
    }),
  }
}

export function parseAgentRequest(value: unknown): AgentRequest | null {
  const input = asRecord(value)
  if (!input || (input.mode !== 'demo' && input.mode !== 'live') || !text(input.prompt, ASSISTANT_PROMPT_LIMIT) ||
    !list(input.history, 6) || !input.history.every(turn => { const entry = asRecord(turn); return !!entry && (entry.role === 'user' || entry.role === 'assistant') && text(entry.text, 1200) })) return null
  const source = compactSource(input.source)
  if (!source || input.previous !== null && !priorProposal(input.previous, source)) return null
  return { mode: input.mode, prompt: input.prompt, history: (input.history as ConversationTurn[]).map(({ role, text }) => ({ role, text })),
    source, previous: input.previous === null ? null : compactPrior(input.previous as DesignProposal, source) }
}
