import { createPlacedModel, getDoorWallOffset, getWallAngle, syncWallOpenings } from '../modelPlacement.ts'
import { getModelHorizontalBounds, getStairOpeningPolygon } from '../stairSlabOpenings.ts'
import type { FloorLevel, PlacedModel, Point, Room, Wall, WallOpening } from '../types.ts'
import { buildWallTopology, wallEditCollapsesGeometry } from '../wallTopology.ts'
import { validRequirements, type Requirements } from './intent.ts'
import { exitClearance, getRoomWindows, minimumRoomArea, nativeDoor, partitionCutsOpening, roomLabelPoint, sideOfDoor, wallsCrossOrOverlap } from './layoutValidation.ts'
import { area, bounds, covers, difference, distance, intersection, pointInPolygon, polygon, projection } from './planGeometry.ts'
import type { DesignOperation, DesignProposal, Doorway, FloorEdits, NewWindow, ProposedRoom, RoomLabel, RoomRedesign, WindowExclusion } from './proposal.ts'
import { ASSISTANT_DOOR_MODEL, ASSISTANT_EXTERIOR_DOOR_MODELS, ASSISTANT_WINDOW_MODEL, stairsEnteringFloor, type SceneFloor, type SceneSource } from './scene.ts'

export type RedesignOperation = Exclude<DesignOperation, RoomLabel>
export type RedesignSpace = Pick<ProposedRoom, 'id' | 'polygon' | 'area'> & { signature: string; name: string | null; function?: Room['function']; anchor: Point }
export type RedesignGeometry = { walls: Wall[]; additions: PlacedModel[]; changedWalls: Set<string>; removedWalls: Set<string>; removedModels: Set<string>;
  topology: ReturnType<typeof buildWallTopology>; original: FloorLevel }
type Result<T> = { value: T; error?: never } | { error: string; value?: never }
const fail = (error: string) => ({ error })
const finite = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y)

export function openingConnections(walls: Wall[], rooms: Array<{ id: string; polygon: Point[] }>) {
  return walls.flatMap(wall => {
    const angle = getWallAngle(wall), x = Math.cos(angle), y = Math.sin(angle), gap = wall.thickness / 2 + 0.04
    return (wall.openings ?? []).flatMap(opening => {
      if (opening.bottom > 0.05 || opening.width < 0.6 || opening.height < 1.75) return []
      const position = { x: wall.start.x + x * opening.center, y: wall.start.y + y * opening.center }
      const roomAt = (side: number) => rooms.find(room => pointInPolygon({ x: position.x - y * gap * side, y: position.y + x * gap * side }, room.polygon))?.id ?? null
      const from = roomAt(-1), to = roomAt(1)
      return from === to ? [] : [{ openingId: opening.id, wallId: wall.id, from, to, position, width: opening.width }]
    })
  })
}

export function positionOnWall(wall: Wall, offset: number) {
  const angle = getWallAngle(wall)
  return { x: wall.start.x + Math.cos(angle) * offset, y: wall.start.y + Math.sin(angle) * offset }
}

export function excludedFacadeWalls(floor: SceneFloor, side: WindowExclusion) {
  return floor.walls.filter(wall => {
    if (wall.kind !== 'external') return false
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y
    if (Math.abs(dy) < Math.abs(dx) || Math.abs(dy) < 0.001) return false
    const direction = (side === 'left' ? -1 : 1) * Math.sign(dy) * (wall.thickness / 2 + 0.025) / Math.hypot(dx, dy)
    const x = (wall.start.x + wall.end.x) / 2, y = (wall.start.y + wall.end.y) / 2
    const outer = { x: x + dy * direction, y: y - dx * direction }
    const inner = { x: x - dy * direction, y: y + dx * direction }
    return floor.footprint.some(outline => pointInPolygon(inner, outline)) &&
      !floor.footprint.some(outline => pointInPolygon(outer, outline))
  }).map(wall => wall.id)
}

function openingOverlaps(opening: WallOpening, offset: number, width: number, bottom: number, height: number) {
  return Math.abs(opening.center - offset) < (opening.width + width) / 2 + 0.04 &&
    Math.min(opening.bottom + opening.height, bottom + height) > Math.max(opening.bottom, bottom) - 0.02
}

/** Replay a bounded draft by using normal walls, mounted models and opening synchronisation. */
export function rebuildRedesign(source: SceneSource, floor: SceneFloor, operations: RedesignOperation[], operationLimit = 26): Result<RedesignGeometry> {
  const original = source.floors.find(level => level.id === floor.id)
  if (!original || !floor.footprint.length) return fail('Choose a floor with a closed footprint.')
  if (operations.length > operationLimit) return fail(`This draft has reached its limit of ${operationLimit} geometry operations.`)
  const definitions = new Map(source.models.map(model => [model.id, model]))
  const walls = new Map(original.walls.map(wall => [wall.id, wall]))
  const additions: PlacedModel[] = []
  const changedWalls = new Set<string>(), changedLines = new Set<string>(), removedWalls = new Set<string>(), removedModels = new Set<string>()
  const ids = new Set([...original.walls.map(wall => wall.id), ...original.models.map(model => model.id), ...original.rooms.map(room => room.id)])
  const openingOwner = (opening: WallOpening) => opening.id.split(':')[0]

  for (const operation of operations) {
    if (operation.type === 'create-partition') {
      const { id, start, end, thickness, height } = operation
      if (typeof id !== 'string' || ids.has(id) || !finite(start) || !finite(end) || distance(start, end) < 0.15 ||
          thickness !== source.partitionThickness || height !== original.roomHeight) return fail('A new partition has invalid dimensions or a duplicate identifier.')
      ids.add(id)
      walls.set(id, { id, start, end, thickness, height, kind: 'internal', allowRoofClipHeight: !!original.floorFootprints?.length || undefined })
      changedWalls.add(id); changedLines.add(id)
      continue
    }
    if (operation.type === 'remove-opening') {
      const wall = [...walls.values()].find(wall => wall.openings?.some(opening => opening.id === operation.openingId))
      const opening = wall?.openings?.find(item => item.id === operation.openingId)
      if (!wall || !opening || wall.kind === 'external' && opening.bottom <= 0.05) return fail('Use a current opening ID. Exterior entrance doors remain in place.')
      const owner = original.models.find(model => model.id === openingOwner(opening))?.id
      if (additions.some(model => model.id === owner)) return fail('Remove the proposed opening from the draft before rebuilding it.')
      if (owner && [...walls.values()].some(item => item.kind === 'external' && item.openings?.some(entry => openingOwner(entry) === owner && entry.bottom <= 0.05))) {
        return fail('Exterior entrance doors and their attached sidelights remain in place.')
      }
      if (owner) removedModels.add(owner)
      for (const [id, item] of walls) {
        const openings = item.openings?.filter(entry => entry.id !== operation.openingId && (!owner || openingOwner(entry) !== owner))
        if (openings && openings.length !== item.openings?.length) {
          walls.set(id, { ...item, openings: openings.length ? openings : undefined })
          changedWalls.add(id)
        }
      }
      continue
    }
    if (operation.type === 'add-stair') return fail('Use a staircase proposal for a new stair.')
    if (operation.type === 'add-extension' || operation.type === 'extend-above') return fail('Use an extension proposal to change the exterior footprint.')
    if (operation.type === 'replace-model-variant') return fail('Use a model variant proposal for a model swap.')
    const wall = walls.get(operation.wallId)
    if (!wall) return fail('Use a wall ID from the current draft.')
    if (operation.type === 'move-partition' || operation.type === 'remove-partition') {
      if (wall.kind !== 'internal') return fail('Only internal partitions can move or be removed. Exterior wall lines remain in place.')
      if (wall.openings?.length || [...original.models, ...additions].some(model => model.wallAttachment?.wallId === wall.id && !removedModels.has(model.id))) {
        return fail('This wall has an opening or mounted object. Remove or relocate it before moving the partition.')
      }
      if (operation.type === 'remove-partition') {
        walls.delete(wall.id); changedWalls.delete(wall.id); changedLines.delete(wall.id)
        if (original.walls.some(item => item.id === wall.id)) removedWalls.add(wall.id)
      } else {
        if (!finite(operation.start) || !finite(operation.end) || distance(operation.start, operation.end) < 0.15) return fail('The moved partition needs two finite endpoints at least 0.15 m apart.')
        walls.set(wall.id, { ...wall, start: operation.start, end: operation.end })
        changedWalls.add(wall.id); changedLines.add(wall.id)
      }
      continue
    }
    const isWindow = operation.type === 'create-window'
    if (!isWindow && operation.type !== 'create-doorway') return fail('This operation is unavailable in a floor redesign.')
    const exterior = operation.type === 'create-doorway' ? operation.exterior : undefined
    if (exterior !== undefined && exterior !== 'front' && exterior !== 'patio') return fail('Choose a front or patio door.')
    const definition = definitions.get(isWindow ? ASSISTANT_WINDOW_MODEL : exterior ? ASSISTANT_EXTERIOR_DOOR_MODELS[exterior] : ASSISTANT_DOOR_MODEL)
    const mount = isWindow ? 'window' : exterior === 'front' ? 'exterior-door' : exterior === 'patio' ? 'patio-door' : 'interior-door'
    const { id, width, height, offset, rotation, position } = operation
    const bottom = isWindow ? operation.bottom : 0
    const side = operation.type === 'create-doorway' ? operation.side : 1
    const length = distance(wall.start, wall.end)
    if (typeof id !== 'string' || ids.has(id) || !definition || definition.wallMount !== mount ||
        wall.kind !== (isWindow || exterior ? 'external' : 'internal') ||
        (!isWindow && (width !== (definition.openingWidth ?? definition.width) || height !== definition.height)) ||
        ![offset, width, height, bottom, rotation].every(Number.isFinite) || !finite(position) ||
        (side !== 1 && side !== -1) || Math.abs(rotation - (getWallAngle(wall) + (side < 0 ? Math.PI : 0))) > 0.001 ||
        offset < width / 2 + 0.05 || offset > length - width / 2 - 0.05 || width < 0.35 || width > 3.5 || height < 0.35 || bottom < 0 ||
        (isWindow && (bottom < 0.4 || bottom > 2.5)) || bottom + height > wall.height - 0.025 || distance(position, positionOnWall(wall, offset)) > 0.001 ||
        wall.openings?.some(opening => openingOverlaps(opening, offset, width, bottom, height))) {
      return fail('The opening overlaps an existing opening, exceeds the wall, or is outside its supported wall type. Check the wall, offset, width and height.')
    }
    const windowScale = height / definition.height
    const model: PlacedModel = { ...createPlacedModel({ id, modelId: definition.id, modelsById: definitions, walls: [] }),
      position, rotation, wallAttachment: { wallId: wall.id, offset, side },
      ...(isWindow ? { wallOpeningBottom: bottom, scale: windowScale, widthScale: width / ((definition.openingWidth ?? definition.width) * windowScale), depthScale: 1 / windowScale } : {}) }
    if (getDoorWallOffset(wall, [...walls.values()], { ...definition, openingCenterOffset: 0 }, offset, { model }) === null) return fail('The opening conflicts with an adjoining wall. Choose a clear span between junctions.')
    const updated = syncWallOpenings({ ...original, walls: [...walls.values()], models: [model] }, definitions).walls.find(item => item.id === wall.id)!
    const made = updated.openings?.find(opening => opening.id === id)
    if (!made || Math.abs(made.width - width) > 0.001 || Math.abs(made.height - height) > 0.001) return fail('The editor could not create the complete opening on that wall.')
    walls.set(wall.id, updated); additions.push(model); changedWalls.add(wall.id); ids.add(id)
  }

  const actualWalls = [...walls.values()]
  if (wallEditCollapsesGeometry(original.walls, actualWalls)) return fail('A partition collapses into an adjoining wall. Separate its endpoints.')
  const topology = buildWallTopology(actualWalls, { floorFootprints: original.floorFootprints })
  const stairFootprints = original.models.flatMap(model => {
    const definition = definitions.get(model.modelId)
    return definition?.objectType === 'stairs' ? [getStairOpeningPolygon(model.position, model.rotation, definition.width, definition.depth,
      model.scale, getModelHorizontalBounds(definition), model.widthScale, model.depthScale, model.mirrored)] : []
  })
  const clearAreas = [...stairFootprints, ...floor.stairsFromBelow.flatMap(stair => [...stair.openings, exitClearance(stair)])].map(polygon)
  const wallContext = { ...floor, walls: actualWalls, openings: floor.openings.filter(opening => walls.get(opening.wallId)?.openings?.some(item => item.id === opening.id)) }
  for (const id of changedLines) {
    const wall = walls.get(id)!, body = topology.wallPolygonsById.get(id)
    if (!body || !covers(floor.footprint.map(polygon), polygon(body), 0.012) ||
        actualWalls.some(other => other.id !== id && wallsCrossOrOverlap(wall, other)) || partitionCutsOpening(wallContext, wall) ||
        clearAreas.some(clear => area(intersection(clear, polygon(body))) > 0.002)) return fail('A changed wall crosses another wall, an opening, the stair route or the outside footprint.')
  }
  const updatedStairs = stairsEnteringFloor({ ...original, walls: actualWalls }, source)
  if (updatedStairs.length !== floor.stairsFromBelow.length || floor.stairsFromBelow.some(stair => {
    const updated = updatedStairs.find(item => item.id === stair.id)
    return !updated || area(difference(updated.openings.map(polygon), stair.openings.map(polygon))) > 0.015 ||
      area(difference(stair.openings.map(polygon), updated.openings.map(polygon))) > 0.015
  })) return fail('The redesign must preserve existing stair openings.')
  return { value: { walls: actualWalls, additions, changedWalls, removedWalls, removedModels, topology, original } }
}

export function detectRedesignSpaces(floor: SceneFloor, geometry: RedesignGeometry, previous: RedesignSpace[], nextId: () => string): RedesignSpace[] {
  const used = new Set<string>()
  return geometry.topology.rooms.map(room => {
    const saved = floor.rooms.find(item => item.signature === room.signature)
    const retained = (saved ? previous.find(item => item.id === saved.id) : undefined) ?? previous.find(item => item.signature === room.signature && !used.has(item.id)) ??
      previous.find(item => !used.has(item.id) && !geometry.topology.rooms.some(other => other.signature === item.signature) && pointInPolygon(item.anchor, room.polygon))
    const id = saved?.id ?? retained?.id ?? nextId()
    used.add(id)
    return { id, signature: room.signature, polygon: room.polygon, area: room.area,
      name: retained?.name ?? saved?.name ?? null, function: retained?.function ?? saved?.function, anchor: roomLabelPoint(room.polygon) }
  })
}

export function roomScheduleLabels(schedule: RoomRedesign): RoomLabel[] {
  return [
    { type: 'label-room', roomId: schedule.landingId, name: schedule.home ? 'Hallway' : 'Landing', function: 'landing' },
    ...schedule.bedroomIds.map((roomId, index): RoomLabel => ({ type: 'label-room', roomId, name: `Bedroom ${index + 1}`, function: 'bedroom' })),
    ...(schedule.sharedBathroomId ? [{ type: 'label-room', roomId: schedule.sharedBathroomId, name: schedule.home ? 'Family bathroom' : 'Shared bathroom', function: 'bathroom' } as const] : []),
    ...schedule.ensuites.map(({ bedroomId, bathroomId }): RoomLabel => ({ type: 'label-room', roomId: bathroomId, name: `En suite · Bedroom ${schedule.bedroomIds.indexOf(bedroomId) + 1}`, function: 'bathroom' })),
    ...(schedule.home?.kitchenDinerId ? [{ type: 'label-room', roomId: schedule.home.kitchenDinerId, name: 'Open-plan kitchen/diner', function: 'kitchen-diner' } as const] : []),
    ...(schedule.home?.utilityId ? [{ type: 'label-room', roomId: schedule.home.utilityId, name: 'Utility room', function: 'utility' } as const] : []),
  ]
}

export function scheduledRoomEntrance(schedule: RoomRedesign, roomId: string) {
  if (roomId === schedule.home?.utilityId && schedule.home.utilityAccess === 'kitchen' && schedule.home.kitchenDinerId) {
    return schedule.home.kitchenDinerId
  }
  return schedule.ensuites.find(suite => suite.bathroomId === roomId)?.bedroomId ?? schedule.landingId
}

/** Validate the actual access graph, including existing and proposed native openings. */
export function checkRoomSchedule(floor: SceneFloor, geometry: RedesignGeometry, rooms: RedesignSpace[], schedule: RoomRedesign, requirements: Requirements) {
  const labels = roomScheduleLabels(schedule)
  const assigned = new Set(labels.map(label => label.roomId))
  if (labels.length !== assigned.size || schedule.bedroomIds.length !== requirements.bedrooms ||
      schedule.home?.utilityAccess === 'kitchen' && (!schedule.home.kitchenDinerId || !schedule.home.utilityId) ||
      schedule.ensuites.length > 2 || new Set(schedule.ensuites.map(link => link.bedroomId)).size !== schedule.ensuites.length ||
      schedule.ensuites.some(link => !schedule.bedroomIds.includes(link.bedroomId)) || labels.some(label => !rooms.some(room => room.id === label.roomId))) {
    return ['Assign each scheduled use to a separate detected room.']
  }
  const problems: string[] = []
  const stair = floor.stairsFromBelow[0]
  const landing = rooms.find(room => room.id === schedule.landingId)!
  if (stair && ![...stair.openings, exitClearance(stair)].every(region => covers(polygon(landing.polygon), polygon(region), 0.018))) problems.push('Choose a landing that contains the stair opening and upper exit.')
  const connections = openingConnections(geometry.walls, rooms)
  const hallName = schedule.home ? 'hallway' : 'landing'
  const patioIds = new Set(geometry.walls.flatMap(wall => (wall.openings ?? []).filter(opening =>
    opening.modelId === ASSISTANT_EXTERIOR_DOOR_MODELS.patio).map(opening => opening.id)))
  const exteriorEntrances = schedule.home ? connections.filter(link => (!link.from || !link.to) && !patioIds.has(link.openingId)) : []
  if (exteriorEntrances.length && !exteriorEntrances.some(link => link.from === landing.id || link.to === landing.id)) {
    problems.push('Choose a hallway that connects to an existing exterior entrance.')
  }
  const neighbours = (id: string) => new Set(connections.flatMap(link => link.from === id ? [link.to] : link.to === id ? [link.from] : []))
  for (const label of labels) {
    const room = rooms.find(item => item.id === label.roomId)!
    const usable = room.id === landing.id && stair ? area(difference(polygon(room.polygon), ...stair.openings.map(polygon))) : room.area
    const minimum = minimumRoomArea(label.function, requirements)
    if (usable < minimum) problems.push(`${label.name} has ${usable.toFixed(1)} m². Allow at least ${minimum.toFixed(1)} m² for this layout.`)
    if ((label.function === 'bedroom' || label.function === 'utility' || label.function === 'kitchen-diner' || room.id === schedule.sharedBathroomId) &&
        !neighbours(room.id).has(scheduledRoomEntrance(schedule, room.id))) {
      const entry = scheduledRoomEntrance(schedule, room.id) === landing.id ? hallName : 'kitchen/diner'
      problems.push(`${label.name} needs independent doorway access from the ${entry}. Check the draft opening connections.`)
    }
  }
  for (const { bedroomId, bathroomId } of schedule.ensuites) {
    const links = neighbours(bathroomId)
    if (links.size !== 1 || !links.has(bedroomId)) problems.push(`The en suite for bedroom ${schedule.bedroomIds.indexOf(bedroomId) + 1} must open only into its bedroom. Check the door to the bedroom and any former landing doorway.`)
  }
  return problems
}

export function checkRedesignAccess(source: SceneSource, floor: SceneFloor, geometry: RedesignGeometry, rooms: RedesignSpace[],
  operations: RedesignOperation[]) {
  const problems: string[] = []
  const originallyAccessible = new Set(openingConnections(geometry.original.walls, floor.rooms).flatMap(link => [link.from, link.to]))
  const hasAccess = new Set(openingConnections(geometry.walls, rooms).flatMap(link => [link.from, link.to]))
  for (const room of rooms) {
    if (originallyAccessible.has(room.id) && !hasAccess.has(room.id)) problems.push(`The redesign leaves ${room.name ?? room.id} without an existing or proposed entrance.`)
  }
  const definition = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
  for (const door of operations.filter(op => op.type === 'create-doorway')) {
    const wall = geometry.walls.find(item => item.id === door.wallId)!
    if (door.exterior) {
      if (!openingConnections([wall], rooms).some(link => link.openingId === door.id && (link.from === null || link.to === null))) {
        problems.push(`New ${door.exterior} door needs a clear connection from an interior room to the outside.`)
      }
      continue
    }
    const into = rooms.find(room => room.id === door.roomId)
    const across = rooms.find(room => room.id !== door.roomId && pointInPolygon(sideOfDoor(door, wall).landingPoint, room.polygon))
    if (!definition || !into || !across || !nativeDoor(door, into, across, {
      walls: geometry.walls, additions: [wall], obstacles: floor.stairsFromBelow.flatMap(stair => stair.openings), definition,
    })) problems.push(`New door ${door.id} needs a clear swing between two detected rooms.`)
  }
  return problems
}

export function createRedesignDoor(wall: Wall, rooms: RedesignSpace[], roomId: string, offset: number, id: string, source: SceneSource): Doorway | null {
  const definition = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
  const room = rooms.find(item => item.id === roomId)
  if (!definition || !room) return null
  const position = positionOnWall(wall, offset), angle = getWallAngle(wall), gap = wall.thickness / 2 + 0.04
  const normal = { x: -Math.sin(angle) * gap, y: Math.cos(angle) * gap }
  const sample = (side: number) => ({ x: position.x + normal.x * side, y: position.y + normal.y * side })
  const side = pointInPolygon(sample(-1), room.polygon) ? 1 : pointInPolygon(sample(1), room.polygon) ? -1 : null
  if (side === null || !rooms.some(item => item.id !== roomId && pointInPolygon(sample(side), item.polygon))) return null
  return { type: 'create-doorway', id, wallId: wall.id, roomId, offset, position, side, rotation: angle + (side < 0 ? Math.PI : 0),
    width: definition.openingWidth ?? definition.width, height: definition.height }
}

export function createRedesignWindow(wall: Wall, id: string, offset: number, width: number, height: number, bottom: number): NewWindow {
  return { type: 'create-window', id, wallId: wall.id, offset, width, height, bottom, rotation: getWallAngle(wall), position: positionOnWall(wall, offset) }
}

export function createRedesignExteriorDoor(wall: Wall, rooms: RedesignSpace[], offset: number, exterior: NonNullable<Doorway['exterior']>,
  id: string, source: SceneSource): Doorway | null {
  const definition = source.models.find(model => model.id === ASSISTANT_EXTERIOR_DOOR_MODELS[exterior])
  if (!definition || wall.kind !== 'external') return null
  const width = definition.openingWidth ?? definition.width, height = definition.height
  const connections = openingConnections([{ ...wall, openings: [{ id, modelId: definition.id, center: offset, width, height, bottom: 0 }] }], rooms)
  const link = connections[0]
  if (!link || link.from && link.to) return null
  const side = link.from ? 1 : -1
  return { type: 'create-doorway', exterior, id, wallId: wall.id, roomId: (link.from ?? link.to)!,
    offset, width, height, side, position: link.position, rotation: getWallAngle(wall) + (side < 0 ? Math.PI : 0) }
}
export function findRedesignDoor(source: SceneSource, floor: SceneFloor, walls: Wall[], rooms: RedesignSpace[],
  from: RedesignSpace, into: RedesignSpace, nextId: () => string) {
  const definition = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
  if (!definition) return null
  const width = definition.openingWidth ?? definition.width
  const obstacles = floor.stairsFromBelow.flatMap(stair => stair.openings)
  for (const wall of walls) {
    if (wall.kind !== 'internal') continue
    const range = (room: RedesignSpace) => room.polygon.map(point => projection(point, wall.start, wall.end).offset)
    const first = range(from), second = range(into)
    const start = Math.max(0, Math.min(...first), Math.min(...second)) + width / 2 + 0.05
    const end = Math.min(distance(wall.start, wall.end), Math.max(...first), Math.max(...second)) - width / 2 - 0.05
    if (end < start) continue
    const count = Math.min(32, Math.ceil((end - start) / 0.18) + 1)
    const offsets = Array.from({ length: count }, (_, index) => start + (end - start) * index / Math.max(1, count - 1))
    offsets.sort((left, right) => Math.abs(left - (start + end) / 2) - Math.abs(right - (start + end) / 2))
    for (const offset of offsets) {
      if (wall.openings?.some(opening => Math.abs(opening.center - offset) < (opening.width + width) / 2 + 0.05)) continue
      const door = createRedesignDoor(wall, rooms, into.id, offset, nextId(), source)
      if (door && pointInPolygon(sideOfDoor(door, wall).landingPoint, from.polygon) &&
          nativeDoor(door, into, from, { walls, additions: [wall], obstacles, definition })) return door
    }
  }
  return null
}

export function validateRoomRedesign(source: SceneSource, floor: SceneFloor, proposal: DesignProposal): FloorEdits | null {
  if (proposal.version !== 1 || proposal.projectId !== source.projectId || proposal.sourceRevision !== source.revision || proposal.floorId !== floor.id ||
      !validRequirements(proposal.requirements) || !Array.isArray(proposal.operations) || !Array.isArray(proposal.rooms) ||
      proposal.stairId !== (floor.stairsFromBelow[0]?.id ?? '') || proposal.redesign &&
      (!Array.isArray(proposal.redesign.ensuites) || !Array.isArray(proposal.redesign.bedroomIds))) return null
  const operations = proposal.operations.filter(op => op.type !== 'label-room')
  if (!proposal.redesign && !operations.length) return null
  const { value } = rebuildRedesign(source, floor, operations)
  if (!value) return null
  if (proposal.windowExclusion) {
    if (proposal.windowExclusion !== 'left' && proposal.windowExclusion !== 'right') return null
    const excludedWalls = excludedFacadeWalls(floor, proposal.windowExclusion)
    if (!excludedWalls.length || redesignScene(floor, value).openings.some(opening => opening.kind === 'window' && excludedWalls.includes(opening.wallId))) return null
  }
  const labels = proposal.operations.filter(op => op.type === 'label-room')
  const expected = proposal.redesign ? roomScheduleLabels(proposal.redesign) : []
  if (labels.length !== expected.length || proposal.rooms.length !== expected.length ||
      expected.some(expected => labels.filter(item => item.roomId === expected.roomId && item.function === expected.function &&
        typeof item.name === 'string' && item.name.trim().length && item.name.length <= 60).length !== 1)) return null
  if (new Set(proposal.rooms.map(room => room.id)).size !== proposal.rooms.length || proposal.rooms.some(room => !Array.isArray(room.polygon) ||
      room.polygon.length < 3 || room.polygon.length > 120 || !room.polygon.every(finite) || !finite(room.labelPoint))) return null

  const claimed = new Set<string>()
  const native: RedesignSpace[] = []
  for (const room of value.topology.rooms) {
    const original = floor.rooms.find(item => item.signature === room.signature)
    const submitted = proposal.rooms.find(candidate => !claimed.has(candidate.id) && covers(polygon(room.polygon), polygon(candidate.polygon), 0.009) &&
      covers(polygon(candidate.polygon), polygon(room.polygon), 0.009))
    if (submitted && original && submitted.id !== original.id) return null
    const wallOrModelId = submitted && (value.walls.some(wall => wall.id === submitted.id) || [...value.original.models, ...value.additions].some(model => model.id === submitted.id))
    if (wallOrModelId) return null
    if (submitted) claimed.add(submitted.id)
    const retained = floor.rooms.find(item => !native.some(space => space.id === item.id) &&
      !value.topology.rooms.some(space => space.signature === item.signature) && pointInPolygon(roomLabelPoint(item.polygon), room.polygon))
    const id = submitted?.id ?? original?.id ?? retained?.id ?? `redesign-space-${proposal.id}-${native.length}`
    native.push({ ...room, id, name: submitted?.name ?? original?.name ?? null, function: submitted?.function ?? original?.function, anchor: roomLabelPoint(room.polygon) })
  }
  if (claimed.size !== labels.length || new Set(native.map(room => room.id)).size !== native.length ||
      labels.some(label => !proposal.rooms.some(room => room.id === label.roomId && room.function === label.function && room.name === label.name)) ||
      checkRedesignAccess(source, floor, value, native, operations).length ||
      proposal.redesign && checkRoomSchedule(floor, value, native, proposal.redesign, proposal.requirements).length) return null
  return { walls: value.walls.filter(wall => value.changedWalls.has(wall.id)), models: value.additions,
    windowExclusion: proposal.windowExclusion,
    removedWallIds: [...value.removedWalls], removedModelIds: [...value.removedModels], rooms: native.map((room, index) => {
      const previous = value.original.rooms.find(item => item.id === room.id || item.signature === room.signature)
      return { ...previous, id: room.id, signature: room.signature, name: room.name ?? `Room ${index + 1}`, function: room.function }
    }) }
}

export function redesignScene(floor: SceneFloor, geometry: RedesignGeometry): SceneFloor {
  return { ...floor, walls: geometry.walls, openings: geometry.walls.flatMap(wall => (wall.openings ?? []).map(opening => ({
    ...opening, wallId: wall.id, position: positionOnWall(wall, opening.center),
    kind: floor.openings.find(item => item.id === opening.id)?.kind ?? (opening.bottom > 0.05 ? 'window' : 'door'),
  }))) }
}

export function redesignMeasurements(room: RedesignSpace, floor: SceneFloor) {
  const b = bounds(room.polygon)
  return { id: room.id, name: room.name, function: room.function ?? null, area: room.area, outline: room.polygon,
    dimensions: { width: b.maxX - b.minX, depth: b.maxY - b.minY }, windowIds: getRoomWindows(room.polygon, floor) }
}
