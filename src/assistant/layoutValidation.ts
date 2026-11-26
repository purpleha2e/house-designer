import type { ModelDefinition } from '../models/modelLibrary.ts'
import { createPlacedModel, doorPlacementFits, getWallAngle, syncWallOpenings } from '../modelPlacement.ts'
import { buildWallTopology, wallEditCollapsesGeometry } from '../wallTopology.ts'
import { STAIR_OPENING_WALL_FIT_DISTANCE } from '../stairOpeningFit.ts'
import type { FloorLevel, Point, Wall } from '../types.ts'
import { validRequirements, type Requirements } from './intent.ts'
import { ASSISTANT_DOOR_MODEL, stairsEnteringFloor, type SceneFloor, type SceneRoom, type SceneSource, type SceneStair } from './scene.ts'
import type { DesignProposal, Doorway, FloorEdits, Partition, ProposedRoom, RoomLabel } from './proposal.ts'
import { area, bounds, covers, difference, distance, edges, EPSILON, intersection, pointInPolygon, polygon, projection, rectangle, transformedFrame, union } from './planGeometry.ts'
import { connectedClearance } from './landingClearance.ts'

export const ROUTE_WIDTH = 0.9
const BEDROOM_MIN_AREA = 6.5
const BATHROOM_MIN_AREA = 3.3
const CONTAINMENT_TOLERANCE = 0.012

export function minimumRoomArea(kind: ProposedRoom['function'], requirements: Requirements) {
  if (kind === 'kitchen-diner') return 16
  if (kind === 'utility') return 2.5
  if (kind === 'office') return 4
  if (kind === 'living-room') return 9
  if (kind === 'cloakroom') return 1.35
  return kind === 'bedroom' ? BEDROOM_MIN_AREA : kind === 'bathroom'
    ? BATHROOM_MIN_AREA + (requirements.bathroom === 'larger' ? 1 : 0) : 2.2
}

export function getRoomWindows(room: Point[], floor: SceneFloor) {
  return floor.openings.flatMap(opening => {
    if (opening.kind !== 'window') return []
    const wall = floor.walls.find(candidate => candidate.id === opening.wallId && candidate.kind === 'external')
    if (!wall) return []
    const angle = getWallAngle(wall)
    const setback = wall.thickness / 2 + 0.035
    const sample = (along: number, side: number) => pointInPolygon({
      x: opening.position.x + Math.cos(angle) * along - Math.sin(angle) * setback * side,
      y: opening.position.y + Math.sin(angle) * along + Math.cos(angle) * setback * side,
    }, room)
    return [-1, 1].some(side => [-0.35, 0, 0.35].every(fraction => sample(opening.width * fraction, side))) ? [opening.id] : []
  })
}

export function exitClearance(stair: SceneStair) {
  const half = Math.max(0.8, stair.clearWidth) / 2
  const { x, y } = stair.upperDirection
  // Wall fitting can extend the native aperture a little past the model's upper tread.
  const fitRange = rectangle(0, -half, STAIR_OPENING_WALL_FIT_DISTANCE, half)
  const fittedEdge = Math.max(0, ...stair.openings.flatMap(opening => {
    const local = opening.map(point => {
      const dx = point.x - stair.upperEdge.x, dy = point.y - stair.upperEdge.y
      return { x: dx * x + dy * y, y: dy * x - dx * y }
    })
    return intersection(fitRange, polygon(local)).flat(2).map(([along]) => along)
  }))
  const point = (along: number, across: number) => ({
    x: stair.upperEdge.x + x * (along + fittedEdge) - y * across,
    y: stair.upperEdge.y + y * (along + fittedEdge) + x * across,
  })
  return [point(0.02, -half), point(0.95, -half), point(0.95, half), point(0.02, half)]
}

export type LayoutGeometry = {
  walls: Wall[]; additions: Wall[]; topology: ReturnType<typeof buildWallTopology>; obstacles: Point[][];
  stair: SceneStair; definition: ModelDefinition; floor: FloorLevel; scene: SceneFloor; workspace: SceneRoom;
}

function validPoint(point: Point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

export function partitionCutsOpening(scene: SceneFloor, wall: Pick<Wall, 'start' | 'end' | 'thickness'>) {
  return [wall.start, wall.end].some(end => scene.openings.some(opening => {
    const host = scene.walls.find(existing => existing.id === opening.wallId)
    if (!host) return false
    const match = projection(end, host.start, host.end)
    return match.gap <= host.thickness / 2 + wall.thickness / 2 + 0.01 &&
      Math.abs(match.offset - opening.center) < opening.width / 2 + wall.thickness / 2 + 0.05
  }))
}

export function validatePartitions(source: SceneSource, scene: SceneFloor, workspace: SceneRoom, stair: SceneStair, partitions: Partition[], stayInWorkspace = false): LayoutGeometry | null {
  const floor = source.floors.find(level => level.id === scene.id)
  const definition = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
  if (!floor || definition?.wallMount !== 'interior-door' || partitions.length < 1 || partitions.length > 20) return null
  const ids = new Set(floor.walls.map(wall => wall.id))
  for (const wall of partitions) {
    if (wall.type !== 'create-partition' || typeof wall.id !== 'string' || ids.has(wall.id) || !validPoint(wall.start) || !validPoint(wall.end) ||
      distance(wall.start, wall.end) < 0.15 || wall.thickness !== source.partitionThickness || wall.height !== floor.roomHeight) return null
    ids.add(wall.id)
  }
  const additions: Wall[] = partitions.map(({ id, start, end, thickness, height }) => ({
    id, start, end, thickness, height, kind: 'internal', allowRoofClipHeight: floor.floorFootprints?.length ? true : undefined,
  }))
  const walls = [...floor.walls, ...additions]
  if (wallEditCollapsesGeometry(floor.walls, walls)) return null
  // Junctions can touch wall bodies. Collinear overlaps and crossings through the middle of both walls cannot.
  for (const [index, wall] of additions.entries()) {
    if ([...floor.walls, ...additions.slice(0, index)].some(other => wallsCrossOrOverlap(wall, other)) || partitionCutsOpening(scene, wall)) return null
  }

  const topology = buildWallTopology(walls, { floorFootprints: floor.floorFootprints })
  const boundary = polygon(workspace.polygon)
  const workArea = stayInWorkspace ? union(boundary, ...floor.walls.flatMap(wall => {
    const shape = topology.wallPolygonsById.get(wall.id)
    return shape ? [polygon(shape)] : []
  })) : undefined
  const obstacles: Point[][] = []
  for (const wall of floor.walls) {
    const outline = topology.wallPolygonsById.get(wall.id)
    if (outline && area(intersection(boundary, polygon(outline))) > CONTAINMENT_TOLERANCE) obstacles.push(outline)
  }
  const exit = polygon(exitClearance(stair))
  for (const wall of additions) {
    const outline = topology.wallPolygonsById.get(wall.id)
    if (!outline || !covers(scene.footprint.map(outline => polygon(outline)), polygon(outline), CONTAINMENT_TOLERANCE) ||
      (workArea && !covers(workArea, polygon(outline), CONTAINMENT_TOLERANCE)) ||
      obstacles.some(obstacle => area(intersection(boundary, polygon(outline), polygon(obstacle))) > 0.008) ||
      [exit, ...stair.openings.map(polygon)].some(clear => area(intersection(polygon(outline), clear)) > 0.002)) return null
  }
  return { walls, additions, topology, obstacles, stair, definition, floor, scene, workspace }
}

export function wallsCrossOrOverlap(a: Wall, b: Wall) {
  const length = distance(a.start, a.end)
  const frame = transformedFrame(Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x))
  const first = frame.local(a.start), start = frame.local(b.start), end = frame.local(b.end)
  const low = Math.min(start.x, end.x), high = Math.max(start.x, end.x)
  if (Math.abs(start.y - first.y) < 0.002 && Math.abs(end.y - first.y) < 0.002) {
    return Math.min(high, first.x + length) - Math.max(low, first.x) > 0.02
  }
  if ((start.y - first.y) * (end.y - first.y) >= 0 || Math.min(Math.abs(start.y - first.y), Math.abs(end.y - first.y)) < 0.002) return false
  const x = start.x + (end.x - start.x) * (first.y - start.y) / (end.y - start.y)
  return x > first.x + 0.002 && x < first.x + length - 0.002
}

export function matchNativeRooms(geometry: LayoutGeometry, rooms: Array<Pick<ProposedRoom, 'id' | 'polygon'>>, requirements: Requirements) {
  const assigned = new Set<string>()
  const matched = rooms.flatMap(room => {
    const expected = polygon(room.polygon)
    const detected = geometry.topology.rooms.filter(candidate => !assigned.has(candidate.signature) &&
      candidate.area > 0.2 && covers(expected, polygon(candidate.polygon), 0.035) &&
      area(intersection(expected, polygon(candidate.polygon))) > area([expected]) * 0.78)
    if (detected.length !== 1) return []
    assigned.add(detected[0].signature)
    return [{ ...detected[0], idInProposal: room.id }]
  })
  if (matched.length !== requirements.bedrooms + requirements.bathrooms + 1) return null
  const unaffected = geometry.scene.rooms.filter(room => room.signature !== geometry.workspace.signature)
  if (unaffected.some(room => !geometry.topology.rooms.some(detected => detected.signature === room.signature)) ||
      geometry.topology.rooms.length !== unaffected.length + matched.length) return null
  return matched
}

export function roomLabelPoint(outline: Point[]): Point {
  const box = bounds(outline)
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  if (pointInPolygon(center, outline)) return center
  for (const y of [0.25, 0.75, 0.125, 0.875, 0.5]) {
    for (const x of [0.25, 0.75, 0.125, 0.875, 0.5]) {
      const sample = { x: box.minX + x * (box.maxX - box.minX), y: box.minY + y * (box.maxY - box.minY) }
      if (pointInPolygon(sample, outline)) return sample
    }
  }
  return outline[0]
}

export function sideOfDoor(door: Doorway, wall: Wall) {
  const angle = getWallAngle(wall)
  const half = door.width / 2
  const hinge = door.side === 1 ? -half : half
  const point = (along: number, across: number) => ({
    x: door.position.x + Math.cos(angle) * along - Math.sin(angle) * across,
    y: door.position.y + Math.sin(angle) * along + Math.cos(angle) * across,
  })
  const face = -door.side * (wall.thickness / 2 + 0.005)
  const swing = [point(hinge, face), ...Array.from({ length: 9 }, (_, index) => {
    const radians = index * Math.PI / 16
    return point(hinge + door.side * door.width * Math.cos(radians), face - door.side * door.width * Math.sin(radians))
  })]
  return { swing, landingPoint: point(0, door.side * (wall.thickness / 2 + 0.015)) }
}

/** Validate a turning landing route for tool-authored plans, independently of the corridor search. */
export function checkAgentLanding(geometry: LayoutGeometry, landing: ProposedRoom, doors: Doorway[]) {
  const walkable = difference(polygon(landing.polygon), ...geometry.stair.openings.map(polygon), ...geometry.obstacles.map(polygon))
  const exit = exitClearance(geometry.stair)
  if (!covers(walkable, polygon(exit), 0.005)) return null
  const origin = { x: (exit[0].x + exit[2].x) / 2, y: (exit[0].y + exit[2].y) / 2 }
  const approaches = doors.flatMap(door => {
    const wall = geometry.additions.find(item => item.id === door.wallId)
    if (!wall || door.width < ROUTE_WIDTH) return []
    const { landingPoint } = sideOfDoor(door, wall)
    const a = getWallAngle(wall), x = Math.cos(a), y = Math.sin(a)
    const point = (along: number, across: number) => ({
      x: landingPoint.x + x * along - y * across * door.side,
      y: landingPoint.y + y * along + x * across * door.side,
    })
    const half = ROUTE_WIDTH / 2
    const approach = [point(-half, 0), point(half, 0), point(half, 0.51), point(-half, 0.51)]
    return covers(walkable, polygon(approach), 0.004) ? [{ point: point(0, 0.51), approach }] : []
  })
  if (approaches.length !== doors.length) return null
  const route = connectedClearance(walkable, origin, approaches.map(item => item.point), ROUTE_WIDTH / 2)
  return route ? [exit, ...approaches.map(item => item.approach), ...route] : null
}

export function nativeDoor(door: Doorway, room: Pick<ProposedRoom, 'id' | 'polygon'>, landing: Pick<ProposedRoom, 'polygon'>,
  geometry: Pick<LayoutGeometry, 'additions' | 'walls' | 'definition' | 'obstacles'>) {
  const { additions, walls, definition, obstacles } = geometry
  const wall = additions.find(candidate => candidate.id === door.wallId)
  if (!wall || door.roomId !== room.id || door.type !== 'create-doorway' || !validPoint(door.position) ||
    door.width !== (definition.openingWidth ?? definition.width) || door.height !== definition.height ||
    door.height > wall.height || ![-1, 1].includes(door.side) || !Number.isFinite(door.rotation)) return null
  const angle = getWallAngle(wall)
  const measured = projection(door.position, wall.start, wall.end)
  if (Math.abs(door.rotation - (angle + (door.side < 0 ? Math.PI : 0))) > EPSILON || measured.gap > EPSILON ||
    Math.abs(measured.offset - door.offset) > EPSILON || door.offset < door.width / 2 + 0.05 ||
    door.offset > measured.length - door.width / 2 - 0.05) return null
  const { swing, landingPoint } = sideOfDoor(door, wall)
  if (!pointInPolygon(landingPoint, landing.polygon) || !covers(polygon(room.polygon), polygon(swing), 0.005) ||
    obstacles.some(obstacle => area(intersection(polygon(obstacle), polygon(swing))) > 0.002)) return null
  const model = { ...createPlacedModel({ id: door.id, modelId: definition.id, modelsById: new Map([[definition.id, definition]]), walls: [] }),
    position: door.position, rotation: door.rotation, wallAttachment: { wallId: wall.id, offset: door.offset, side: door.side } }
  return doorPlacementFits(definition, walls, model.wallAttachment, model) ? model : null
}

export function findLandingRoute(geometry: LayoutGeometry, landing: ProposedRoom, axis: number, doorsForLane: (allows: (door: Doorway) => boolean) => Doorway[] | null) {
  const frame = transformedFrame(axis)
  const outline = landing.polygon.map(frame.local)
  const box = bounds(outline)
  const holes = geometry.stair.openings.map(opening => polygon(opening.map(frame.local)))
  const obstructions = geometry.obstacles.map(obstacle => polygon(obstacle.map(frame.local)))
  const walkable = difference(polygon(outline), ...holes, ...obstructions)
  const exit = exitClearance(geometry.stair).map(frame.local)
  if (!covers(walkable, polygon(exit), 0.005) || walkable.length !== 1) return null
  const join = { x: (exit[0].x + exit[2].x) / 2, y: (exit[0].y + exit[2].y) / 2 }
  const half = ROUTE_WIDTH / 2
  const candidates = new Set([join.y, box.minY + half + 0.02, box.maxY - half - 0.02, (box.minY + box.maxY) / 2])
  for (const hole of geometry.stair.openings) {
    const gap = bounds(hole.map(frame.local))
    candidates.add(gap.minY - half - 0.02)
    candidates.add(gap.maxY + half + 0.02)
  }
  for (const y of [...candidates].sort((a, b) => Math.abs(a - join.y) - Math.abs(b - join.y))) {
    const connector = rectangle(join.x - half, Math.min(join.y - 0.025, y - half), join.x + half, Math.max(join.y + 0.025, y + half))
    if (!covers(walkable, connector, 0.004)) continue
    const routeTo = (door: Doorway) => {
      const wall = geometry.additions.find(candidate => candidate.id === door.wallId)!
      const position = frame.local(sideOfDoor(door, wall).landingPoint)
      return [rectangle(position.x - half, Math.min(position.y, y - half), position.x + half, Math.max(position.y, y + half)),
        rectangle(Math.min(join.x, position.x) - half, y - half, Math.max(join.x, position.x) + half, y + half)]
    }
    const doors = doorsForLane(door => routeTo(door).every(section => covers(walkable, section, 0.004)))
    if (!doors) continue
    const route = union(polygon(exit), connector, ...doors.flatMap(routeTo))
    if (route.length === 1) return { doors, route: route[0].map(ring => ring.slice(0, -1).map(([x, y]) => frame.world({ x, y }))) }
  }
  return null
}

export function validateAndMaterialize(source: SceneSource, scene: SceneFloor, proposal: DesignProposal): FloorEdits | null {
  if (proposal.version !== 1 || proposal.projectId !== source.projectId || proposal.sourceRevision !== source.revision ||
      proposal.floorId !== scene.id || !validRequirements(proposal.requirements) || !Number.isFinite(proposal.layoutAxis) ||
      (proposal.method !== undefined && proposal.method !== 'agent') ||
      !Array.isArray(proposal.operations) || !Array.isArray(proposal.rooms) || proposal.rooms.length !== proposal.requirements.bedrooms + 2) return null
  const workspace = scene.rooms.find(room => room.signature === proposal.workspaceSignature)
  const stair = scene.stairsFromBelow.find(item => item.id === proposal.stairId)
  if (!workspace || !stair) return null
  const partitions = proposal.operations.filter((item): item is Partition => item.type === 'create-partition')
  const doors = proposal.operations.filter((item): item is Doorway => item.type === 'create-doorway')
  const labels = proposal.operations.filter((item): item is RoomLabel => item.type === 'label-room')
  if (doors.length !== proposal.rooms.length - 1 || labels.length !== proposal.rooms.length ||
      partitions.length + doors.length + labels.length !== proposal.operations.length ||
      !['bedrooms', 'landing'].includes(proposal.priority)) return null
  const ids = new Set<string>()
  for (const room of proposal.rooms) {
    if (typeof room.id !== 'string' || ids.has(room.id) || !['bedroom', 'bathroom', 'landing'].includes(room.function) ||
        typeof room.name !== 'string' || room.name.length > 60 || !Array.isArray(room.polygon) || room.polygon.length < 3 ||
        room.polygon.length > 100 || !room.polygon.every(validPoint) || !validPoint(room.labelPoint) || !Number.isFinite(room.area)) return null
    ids.add(room.id)
  }
  if (proposal.rooms.filter(room => room.function === 'bedroom').length !== proposal.requirements.bedrooms ||
      proposal.rooms.filter(room => room.function === 'bathroom').length !== 1) return null
  const geometry = validatePartitions(source, scene, workspace, stair, partitions, proposal.method === 'agent')
  if (!geometry) return null
  const matched = matchNativeRooms(geometry, proposal.rooms, proposal.requirements)
  if (!matched) return null
  const rooms = proposal.rooms.map(room => {
    const detected = matched.find(candidate => candidate.idInProposal === room.id)!
    return { ...room, polygon: detected.polygon, area: detected.area, signature: detected.signature }
  })
  const landing = rooms.find(room => room.function === 'landing')!
  const frame = transformedFrame(proposal.layoutAxis)
  const openings = stair.openings.map(polygon)
  if (!openings.every(opening => covers(polygon(landing.polygon), opening, 0.018))) return null
  const netLandingArea = area(difference(polygon(landing.polygon), ...openings))
  for (const room of rooms) {
    const label = labels.filter(item => item.roomId === room.id)
    if (label.length !== 1 || label[0].name !== room.name || label[0].function !== room.function ||
      (room === landing ? netLandingArea : room.area) < minimumRoomArea(room.function, proposal.requirements)) return null
    if (room !== landing) {
      const size = bounds(room.polygon.map(frame.local))
      if (Math.min(size.maxX - size.minX, size.maxY - size.minY) < (room.function === 'bedroom' ? 1.95 : 1.45) ||
        openings.some(opening => area(intersection(polygon(room.polygon), opening)) > 0.012)) return null
    }
  }
  const existingIds = new Set([...geometry.floor.models.map(model => model.id), ...geometry.floor.rooms.map(room => room.id), ...geometry.walls.map(wall => wall.id)])
  const models = rooms.flatMap(room => {
    if (room === landing) return []
    const doorway = doors.filter(door => door.roomId === room.id)
    if (doorway.length !== 1 || typeof doorway[0].id !== 'string' || existingIds.has(doorway[0].id)) return []
    existingIds.add(doorway[0].id)
    const door = nativeDoor(doorway[0], room, landing, geometry)
    return door ? [door] : []
  })
  if (models.length !== doors.length || rooms.some(room => existingIds.has(room.id))) return null
  if (!(proposal.method === 'agent' ? checkAgentLanding(geometry, landing, doors) :
    findLandingRoute(geometry, landing, proposal.layoutAxis, allows => doors.every(allows) ? doors : null))) return null
  for (const first of doors) {
    if (doors.some(second => first !== second && first.wallId === second.wallId && Math.abs(first.offset - second.offset) < first.width / 2 + second.width / 2 + 0.05)) return null
  }
  const materialized = syncWallOpenings({ ...geometry.floor, walls: geometry.walls, models }, new Map([[geometry.definition.id, geometry.definition]]))
  const additions = materialized.walls.filter(wall => partitions.some(partition => partition.id === wall.id))
  if (doors.some(door => !additions.find(wall => wall.id === door.wallId)?.openings?.some(opening => opening.id === door.id && Math.abs(opening.width - door.width) < EPSILON))) return null
  // The stair aperture fitter uses adjoining walls. Check that adding partitions won't reshape the opening.
  const refreshed = stairsEnteringFloor({ ...geometry.floor, walls: geometry.walls }, source).find(item => item.id === stair.id)
  if (!refreshed || area(difference(refreshed.openings.map(polygon), stair.openings.map(polygon))) > 0.015 ||
      area(difference(stair.openings.map(polygon), refreshed.openings.map(polygon))) > 0.015) return null
  const ceilingMode = geometry.floor.rooms.find(room => room.signature === workspace.signature)?.ceilingMode
  return { walls: additions, models, rooms: geometry.topology.rooms.flatMap(detected => {
    const room = rooms.find(candidate => candidate.signature === detected.signature)
    if (room) return [{ id: room.id, signature: room.signature, name: room.name, function: room.function, ...(ceilingMode ? { ceilingMode } : {}) }]
    const previous = geometry.floor.rooms.find(candidate => candidate.signature === detected.signature)
    return previous ? [previous] : []
  }) }
}

export function spanAt(outline: Point[], axis: 'x' | 'y', value: number, min: number, max: number): [number, number][] {
  const other = axis === 'x' ? 'y' : 'x'
  const crossings = [min, max]
  for (const [start, end] of edges(outline)) {
    if (Math.abs(end[axis] - start[axis]) < EPSILON) continue
    const fraction = (value - start[axis]) / (end[axis] - start[axis])
    if (fraction < -EPSILON || fraction > 1 + EPSILON) continue
    const cross = start[other] + fraction * (end[other] - start[other])
    if (cross > min + EPSILON && cross < max - EPSILON) crossings.push(cross)
  }
  crossings.sort((a, b) => a - b)
  return crossings.slice(1).flatMap((end, index) => {
    const start = crossings[index], midpoint = (start + end) / 2
    const probe = (offset: number) => axis === 'x' ? { x: value + offset, y: midpoint } : { x: midpoint, y: value + offset }
    return end - start > 0.12 && pointInPolygon(probe(-EPSILON), outline) && pointInPolygon(probe(EPSILON), outline) ? [[start, end]] : []
  })
}
