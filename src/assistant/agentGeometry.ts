import { getWallAngle } from '../modelPlacement.ts'
import type { Point } from '../types.ts'
import { area, bounds, covers, difference, distance, edges, pointInPolygon, polygon, projection, rectangle, transformedFrame } from './planGeometry.ts'
import { checkAgentLanding, exitClearance, getRoomWindows, minimumRoomArea, nativeDoor, roomLabelPoint, ROUTE_WIDTH,
  validateAndMaterialize, validatePartitions, type LayoutGeometry } from './layoutValidation.ts'
import type { LayoutPriority, Requirements, RoomFunction } from './intent.ts'
import type { DesignProposal, Doorway, Partition, ProposedRoom } from './proposal.ts'
import type { SceneFloor, SceneRoom, SceneSource, SceneStair } from './scene.ts'

export type Site = { floor: SceneFloor; workspace: SceneRoom; stair: SceneStair }
export type DraftRoom = { id: string; signature: string; polygon: Point[]; area: number; anchor: Point; name: string | null; function?: RoomFunction }
export type DraftDoor = Pick<Doorway, 'id' | 'roomId' | 'wallId' | 'offset'>
export type Draft = {
  id: string; site: Site; requirements: Requirements; priority: LayoutPriority;
  walls: Partition[]; doors: DraftDoor[]; rooms: DraftRoom[]; changes: number; evaluations: number;
  cached?: { version: number; evaluation: Evaluation };
}
type Finding = { code: string; message: string; roomId?: string; doorId?: string }
export type Evaluation = { findings: Finding[]; rooms: ReturnType<typeof roomMeasurements>[]; proposal: DesignProposal | null }

export function availableSite(floor: SceneFloor, preferred?: string | null): Site | null {
  if (floor.stairsFromBelow.length !== 1 || floor.footprint.length !== 1) return null
  const stair = floor.stairsFromBelow[0]
  const containsStair = (room: SceneRoom) => stair.openings.every(opening => covers(polygon(room.polygon), polygon(opening), 0.018))
  const room = preferred ? floor.rooms.find(item => item.signature === preferred || item.id === preferred) : undefined
  const workspace = room && containsStair(room) ? room : floor.rooms.find(containsStair)
  return workspace ? { floor, workspace, stair } : null
}

export function availableArea(site: Site) {
  return area(difference(polygon(site.workspace.polygon), ...site.stair.openings.map(polygon)))
}

export function layoutAxis(outline: Point[]) {
  const [a, b] = edges(outline).reduce((longest, edge) => distance(...edge) > distance(...longest) ? edge : longest)
  return Math.atan2(b.y - a.y, b.x - a.x)
}

export function roomMeasurements(room: Pick<DraftRoom, 'id' | 'polygon' | 'area' | 'name' | 'function'>, floor: SceneFloor) {
  const frame = transformedFrame(layoutAxis(room.polygon))
  const box = bounds(room.polygon.map(frame.local))
  const measured = (value: number) => Math.round(value * 1000) / 1000
  return { id: room.id, name: room.name, function: room.function ?? null, area: measured(room.area),
    dimensions: { width: measured(box.maxX - box.minX), depth: measured(box.maxY - box.minY) },
    windowIds: getRoomWindows(room.polygon, floor) }
}

export function draftGeometry(source: SceneSource, draft: Draft) {
  const { floor, workspace, stair } = draft.site
  return validatePartitions(source, floor, workspace, stair, draft.walls, true)
}

export function reconcileDraftRooms(draft: Draft, geometry: LayoutGeometry | null, nextId: () => string) {
  if (!geometry) return []
  const original = new Set(draft.site.floor.rooms.filter(room => room.signature !== draft.site.workspace.signature).map(room => room.signature))
  const used = new Set<string>()
  return geometry.topology.rooms.filter(room => !original.has(room.signature) &&
    covers(polygon(draft.site.workspace.polygon), polygon(room.polygon), 0.04)).map(room => {
    const retained = draft.rooms.find(item => !used.has(item.id) && item.signature === room.signature) ??
      draft.rooms.find(item => !used.has(item.id) && pointInPolygon(item.anchor, room.polygon))
    const id = retained?.id ?? nextId()
    used.add(id)
    return { id, signature: room.signature, polygon: room.polygon, area: room.area,
      anchor: retained?.anchor ?? roomLabelPoint(room.polygon), name: retained?.name ?? null, function: retained?.function }
  })
}

function asProposed(room: DraftRoom, floor: SceneFloor, fallback: RoomFunction): ProposedRoom {
  return { id: room.id, name: room.name ?? '', polygon: room.polygon, area: room.area,
    labelPoint: roomLabelPoint(room.polygon), windowIds: getRoomWindows(room.polygon, floor), function: room.function ?? fallback }
}

export function resolveDraftDoor(door: DraftDoor, draft: Draft, geometry: LayoutGeometry) {
  const wall = geometry.additions.find(candidate => candidate.id === door.wallId)
  const room = draft.rooms.find(candidate => candidate.id === door.roomId)
  if (!wall || !room) return null
  const angle = getWallAngle(wall), x = Math.cos(angle), y = Math.sin(angle)
  const position = { x: wall.start.x + x * door.offset, y: wall.start.y + y * door.offset }
  const setback = wall.thickness / 2 + 0.025
  const sample = (side: number) => ({ x: position.x - side * y * setback, y: position.y + side * x * setback })
  const side = pointInPolygon(sample(-1), room.polygon) ? 1 : pointInPolygon(sample(1), room.polygon) ? -1 : undefined
  if (side === undefined) return null
  const across = draft.rooms.find(candidate => candidate !== room && pointInPolygon(sample(side), candidate.polygon))
  if (!across) return null
  const definition = geometry.definition
  const resolved: Doorway = { ...door, type: 'create-doorway', position, side, rotation: angle + (side < 0 ? Math.PI : 0),
    width: definition.openingWidth ?? definition.width, height: definition.height }
  const swingInto = asProposed(room, draft.site.floor, 'bedroom')
  const otherSide = asProposed(across, draft.site.floor, 'landing')
  return nativeDoor(resolved, swingInto, otherSide, geometry) ? { door: resolved, acrossId: across.id } : null
}

export function movedPartitions(draft: Draft, wall: Partition, start: Point, end: Point) {
  const follow = (point: Point) => {
    const hit = projection(point, wall.start, wall.end)
    if (hit.gap > 0.003 || hit.length < 0.001) return point
    const fraction = Math.max(0, Math.min(1, hit.offset / hit.length))
    return { x: start.x + fraction * (end.x - start.x), y: start.y + fraction * (end.y - start.y) }
  }
  return draft.walls.map(item => item === wall ? { ...item, start, end } : { ...item, start: follow(item.start), end: follow(item.end) })
}

export function evaluateDraft(source: SceneSource, draft: Draft): Evaluation {
  const { floor, stair, workspace } = draft.site
  const findings: Finding[] = []
  const report = (code: string, message: string, extra?: Pick<Finding, 'roomId' | 'doorId'>) => findings.push({ code, message, ...extra })
  const geometry = draftGeometry(source, draft)
  const actualRooms = draft.rooms.map(room => room.function === 'landing' ? { ...room,
    area: area(difference(polygon(room.polygon), ...stair.openings.map(polygon))) } : room)
  const stats = actualRooms.map(room => roomMeasurements(room, floor))
  const response = (proposal: DesignProposal | null = null) => ({ findings, rooms: stats, proposal })
  if (!geometry) {
    report('partitions', 'The draft needs supported partitions inside the enclosure, clear of fixed walls, openings and the stair.')
    return response()
  }
  if (draft.rooms.length !== draft.requirements.bedrooms + 2) report('room_count', `Detected ${draft.rooms.length} rooms. Close the requested bedrooms, bathroom and landing with adjoining walls.`)
  if (draft.rooms.some(room => !room.function)) report('room_function', 'Assign a function to each detected room.')
  const bedrooms = actualRooms.filter(room => room.function === 'bedroom')
  const bathrooms = actualRooms.filter(room => room.function === 'bathroom')
  const landings = actualRooms.filter(room => room.function === 'landing')
  if (bedrooms.length !== draft.requirements.bedrooms || bathrooms.length !== 1 || landings.length !== 1) {
    report('schedule', `Assign ${draft.requirements.bedrooms} bedrooms, one bathroom and one landing.`)
  }
  const landing = landings[0]
  if (landing && !stair.openings.every(opening => covers(polygon(landing.polygon), polygon(opening), 0.018))) {
    report('landing_stair', 'The landing must enclose the stair opening and reach the fitted upper exit.', { roomId: landing.id })
  }
  for (const room of actualRooms) {
    if (!room.function) continue
    const minimum = minimumRoomArea(room.function, draft.requirements)
    if (room.area < minimum) report('room_area', `${room.name ?? room.function} has ${room.area.toFixed(2)} m². Allow at least ${minimum.toFixed(2)} m² for this concept.`, { roomId: room.id })
  }
  const doors = draft.doors.flatMap(door => {
    const result = resolveDraftDoor(door, draft, geometry)
    if (!result || result.acrossId !== landing?.id) {
      report('door_connection', 'Place this door where it opens from the landing into the intended room with room for its swing.', { roomId: door.roomId, doorId: door.id })
      return []
    }
    return [result.door]
  })
  for (const room of [...bedrooms, ...bathrooms]) {
    if (doors.filter(door => door.roomId === room.id).length !== 1) report('room_entrance', `Give ${room.name ?? room.function} one door from the landing.`, { roomId: room.id })
  }
  if (!landing || findings.length) return response()

  let bedroom = 0
  const rooms = actualRooms.map(room => {
    const name = room.function === 'bedroom' ? `Bedroom ${++bedroom}` : room.function === 'bathroom' ? 'Bathroom' : 'Landing'
    return asProposed({ ...room, name: room.name ?? name }, floor, 'bedroom')
  })
  const landingRoom = rooms.find(room => room.id === landing.id)!
  const route = checkAgentLanding(geometry, landingRoom, doors)
  if (!route) {
    report('circulation', 'No continuous 0.9 m clear route reaches every doorway from the stair. Move a partition or doorway to improve access.', { roomId: landing.id })
    return response()
  }
  if (stair.openings.some(opening => pointInPolygon(landingRoom.labelPoint, opening))) landingRoom.labelPoint = roomLabelPoint(exitClearance(stair))

  const totalBedroomArea = bedrooms.reduce((sum, room) => sum + room.area, 0)
  const daylitBedrooms = rooms.filter(room => room.function === 'bedroom' && room.windowIds.length).length
  const warnings = ['Concept layout. Have headroom, structure, fire safety and building regulations checked before building.']
  if (stair.riseMismatch > 0.12) warnings.push('The stair model’s height differs from the level change. Verify where it meets the upper floor.')
  if (daylitBedrooms < bedrooms.length) warnings.push('Check daylight, ventilation and escape requirements for bedrooms without an existing exterior window.')
  if (!rooms.find(room => room.function === 'bathroom')!.windowIds.length) warnings.push('Check bathroom ventilation and drainage routes.')
  const frame = transformedFrame(layoutAxis(workspace.polygon))
  for (const room of rooms.filter(item => item.function === 'bedroom')) {
    const region = room.polygon.map(frame.local), box = bounds(region)
    const roomShape = polygon(region)
    const fits = [0.32, 0.5, 0.68].some(a => [0.32, 0.5, 0.68].some(b => {
      const x = box.minX + a * (box.maxX - box.minX), y = box.minY + b * (box.maxY - box.minY)
      return covers(roomShape, rectangle(x - 1.05, y - 1.2, x + 1.05, y + 1.2), 0.005) ||
        covers(roomShape, rectangle(x - 1.2, y - 1.05, x + 1.2, y + 1.05), 0.005)
    }))
    if (!fits) warnings.push(`Check bed and furniture clearances in ${room.name}.`)
  }

  const proposal: DesignProposal = {
    version: 1, method: 'agent', id: draft.id, projectId: source.projectId, sourceRevision: source.revision, floorId: floor.id, floorName: floor.name,
    workspaceSignature: workspace.signature, stairId: stair.id, requirements: draft.requirements, priority: draft.priority,
    assumptions: ['The landing area excludes the stair opening. Room areas use inside wall faces.'], rooms,
    operations: [...draft.walls, ...doors, ...rooms.map(room => ({ type: 'label-room' as const, roomId: room.id, name: room.name, function: room.function }))],
    validation: { passed: true, checks: ['Enclosed native rooms and matching room schedule', 'Existing walls, openings and stair protected', 'Doors connect to the landing with clear swings', 'Continuous clearance measured from stair to doors'] },
    warnings, tradeoff: '', preserved: { wallIds: floor.walls.map(wall => wall.id), openingIds: floor.openings.map(opening => opening.id), stairId: stair.id, stairOpenings: stair.openings },
    metrics: { smallestBedroom: Math.min(...bedrooms.map(room => room.area)), bedroomArea: totalBedroomArea, bathroomArea: bathrooms[0].area,
      landingArea: landing.area, circulationWidth: ROUTE_WIDTH, daylitBedrooms, landingDaylight: landingRoom.windowIds.length > 0,
      usableArea: totalBedroomArea + bathrooms[0].area + landing.area }, landingRoute: route, layoutAxis: layoutAxis(workspace.polygon),
  }
  if (!validateAndMaterialize(source, floor, proposal)) {
    report('native_validation', 'The editor could not verify these room widths, wall junctions, door openings or unchanged stairs. Inspect the geometry and try adjusting the partitions.')
    return response()
  }
  return response(proposal)
}
