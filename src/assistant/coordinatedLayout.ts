import type { Point, WallOpening } from '../types.ts'
import { validToolArguments, type ToolArguments } from './architecturalTools.ts'
import { partitionSegments, windowForRoom } from './composeFloorLayout.ts'
import { stageExtension } from './extensionPlacement.ts'
import type { Requirements } from './intent.ts'
import { getRoomWindows, minimumRoomArea, roomLabelPoint } from './layoutValidation.ts'
import { area, checkCandidate, difference, distance, pointInPolygon, points, polygon } from './planGeometry.ts'
import { materializeFloorEdits, materializeProposalFloors, type DesignProposal, type FloorChanges, type FloorEdits, type ProposedRoom } from './proposal.ts'
import type { FloorLevel } from '../types.ts'
import { checkRedesignAccess, detectRedesignSpaces, excludedFacadeWalls, findRedesignDoor, openingConnections, rebuildRedesign, redesignScene,
  type RedesignOperation } from './roomRedesign.ts'
import { ASSISTANT_EXTERIOR_DOOR_MODELS, ASSISTANT_WINDOW_MODEL, captureArchitecturalScene, type SceneFloor, type SceneSource } from './scene.ts'
import { checkStairFit, planStaircase, validateStairProposal } from './stairPlacement.ts'

type Brief = ToolArguments<'compose_two_storey_layout'>
type FloorBrief = Brief['lower']
const fail = (error: string) => ({ value: undefined, error })
const standard = { bathrooms: 1, landing: 'standard', bathroom: 'standard', primaryBedroom: 'standard', oppositeBedroom: null } as const
const operationsLimit = 68

function bedroomCount(rooms: FloorBrief['rooms']) {
  return rooms.filter(room => room.role === 'bedroom').length
}

function prepareFloor(source: SceneSource, floor: SceneFloor, brief: FloorBrief, id: string, fromExterior: boolean) {
  const original = source.floors.find(level => level.id === floor.id)!
  const failFloor = (message: string) => fail(`${floor.name}. ${message}`)
  const hallIndex = brief.rooms.findIndex(room => room.role === 'hall') + 1
  if (!hallIndex || brief.rooms.filter(room => room.role === 'hall').length !== 1 || brief.rooms.some(room => {
    const from = room.accessFrom === null ? undefined : brief.rooms[room.accessFrom - 1]
    return room.role === 'hall' ? room.accessFrom !== null : room.role === 'ensuite' ? from?.role !== 'bedroom' :
      room.accessFrom !== hallIndex && !(room.role === 'utility' && from?.role === 'kitchen-diner')
  })) return failFloor('Use one hall and give each room its correct access. En suites must open only from their own bedroom.')
  const suites = brief.rooms.filter(room => room.role === 'ensuite')
  if (new Set(suites.map(room => room.accessFrom)).size !== suites.length) return failFloor('Give each en suite a separate bedroom.')
  const removedWalls = new Set(brief.removeWallIds)
  if (brief.removeWallIds.some(wallId => !original.walls.some(wall => wall.id === wallId && wall.kind === 'internal'))) {
    return failFloor('Only existing internal walls can be removed.')
  }
  const closed = new Set([...brief.closeOpeningIds, ...original.walls.filter(wall => removedWalls.has(wall.id))
    .flatMap(wall => wall.openings?.map(opening => opening.id) ?? [])])
  const owners = new Set(original.models.map(model => model.id))
  const seenOwners = new Set<string>()
  let sequence = 0
  const nextId = () => `${id}-${++sequence}`
  const operations: RedesignOperation[] = []
  for (const openingId of closed) {
    const owner = openingId.split(':')[0]
    if (seenOwners.has(owner)) continue
    if (owners.has(owner)) seenOwners.add(owner)
    operations.push({ type: 'remove-opening', openingId })
  }
  for (const wallId of removedWalls) operations.push({ type: 'remove-partition', wallId })
  for (const segment of partitionSegments(brief.walls)) operations.push({
    ...segment, type: 'create-partition', id: nextId(), height: floor.roomHeight, thickness: source.partitionThickness,
  })
  const initial = rebuildRedesign(source, floor, operations, operationsLimit)
  if (!initial.value) return failFloor(initial.error)
  const spaces = detectRedesignSpaces(floor, initial.value, [], nextId)
  if (spaces.length !== brief.rooms.length) return failFloor(`The partitions formed ${spaces.length} rooms for ${brief.rooms.length} markers. Check the wall junctions and mark every room once.`)
  const targets = brief.rooms.map(room => spaces.find(space => pointInPolygon({ x: room.at[0], y: room.at[1] }, space.polygon)))
  if (targets.some(room => !room) || new Set(targets).size !== spaces.length) return failFloor('Place one marker well inside each separate room.')
  const named = targets.map((target, index) => {
    const { role, name } = brief.rooms[index]
    return { ...target!, name, function: role === 'hall' ? 'landing' as const : role === 'ensuite' ? 'bathroom' as const : role }
  })
  const requirements: Requirements = { ...standard, bedrooms: Math.max(1, bedroomCount(brief.rooms)) }
  for (const room of named) {
    const minimum = minimumRoomArea(room.function, requirements)
    if (room.area < minimum) return failFloor(`${room.name} has ${room.area.toFixed(1)} m². Leave at least ${minimum.toFixed(1)} m² in this draft.`)
  }
  const hall = named[hallIndex - 1]
  const links = openingConnections(initial.value.walls, named)
  const workingWalls = initial.value.walls.slice()
  const reserve = (wallId: string, opening: WallOpening) => {
    const index = workingWalls.findIndex(wall => wall.id === wallId)
    workingWalls[index] = { ...workingWalls[index], openings: [...workingWalls[index].openings ?? [], opening] }
  }
  for (const [index, room] of named.entries()) {
    const entry = brief.rooms[index].accessFrom
    if (entry === null) continue
    const from = named[entry - 1]
    if (links.some(link => (link.from === room.id && link.to === from.id) || (link.to === room.id && link.from === from.id))) continue
    const door = findRedesignDoor(source, floor, workingWalls, named, from, room, nextId) ??
      findRedesignDoor(source, floor, workingWalls, named, room, from, nextId)
    if (!door) return failFloor(`${room.name} needs a clear doorway on a wall shared with ${from.name}.`)
    operations.push(door)
    reserve(door.wallId, { id: door.id, modelId: '', center: door.offset, width: door.width, height: door.height, bottom: 0 })
  }
  const excluded = new Set(original.assistantWindowExclusion ? excludedFacadeWalls(floor, original.assistantWindowExclusion) : [])
  const needsWindow = (index: number) => brief.rooms[index].daylight || brief.rooms[index].role === 'bedroom'
  const currentGeometry = redesignScene(floor, initial.value)
  for (const [index, room] of named.entries()) {
    if (!needsWindow(index) || getRoomWindows(room.polygon, currentGeometry).length) continue
    const window = windowForRoom(workingWalls, room, excluded, room.function === 'kitchen-diner' ? 1.85 : 1.3, nextId)
    if (!window) return failFloor(`${room.name} needs a clear exterior wall for daylight.`)
    operations.push(window)
    reserve(window.wallId, { id: window.id, modelId: ASSISTANT_WINDOW_MODEL, center: window.offset, width: window.width, height: window.height, bottom: window.bottom })
  }
  const final = rebuildRedesign(source, floor, operations, operationsLimit)
  if (!final.value) return failFloor(final.error)
  const geometry = final.value
  const editedFloor = redesignScene(floor, geometry)
  const doors = openingConnections(geometry.walls, named)
  const issues = checkRedesignAccess(source, floor, geometry, named, operations)
  if (issues.length) return failFloor(issues[0])
  for (const [index, room] of named.entries()) {
    const from = brief.rooms[index].accessFrom
    const neighbours = new Set(doors.flatMap(link => link.from === room.id ? [link.to] : link.to === room.id ? [link.from] : []))
    if (from !== null && !neighbours.has(named[from - 1].id)) return failFloor(`The editor could not verify access to ${room.name}.`)
    if (brief.rooms[index].role === 'ensuite' && neighbours.size !== 1) return failFloor(`${room.name} must open only into ${named[from! - 1].name}.`)
    if (needsWindow(index) && !getRoomWindows(room.polygon, editedFloor).length) return failFloor(`The editor could not verify daylight for ${room.name}.`)
  }
  const entryIds = new Set(editedFloor.openings.filter(opening => opening.modelId !== ASSISTANT_EXTERIOR_DOOR_MODELS.patio &&
    editedFloor.walls.some(wall => wall.kind === 'external' && wall.id === opening.wallId)).map(opening => opening.id))
  const entrances = doors.filter(link => entryIds.has(link.openingId) && (link.from === null || link.to === null))
  if (fromExterior && entrances.length && !entrances.some(link => [link.from, link.to].includes(hall.id))) {
    return failFloor('The hall needs access from the existing exterior entrance.')
  }
  const edits: FloorChanges = {
    walls: geometry.walls.filter(wall => geometry.changedWalls.has(wall.id)),
    models: geometry.additions,
    removedWallIds: [...geometry.removedWalls], removedModelIds: [...geometry.removedModels],
    rooms: named.map(room => ({ ...original.rooms.find(prior => prior.id === room.id), id: room.id,
      signature: room.signature, name: room.name, function: room.function })),
  }
  const rooms: ProposedRoom[] = named.map(room => ({ id: room.id, name: room.name, function: room.function,
    polygon: room.polygon, labelPoint: room.anchor, area: room.area, windowIds: getRoomWindows(room.polygon, editedFloor) }))
  const hallDoors = doors.flatMap(link => {
    const side = link.from === hall.id ? -1 : link.to === hall.id ? 1 : 0
    if (!side) return []
    const wall = geometry.walls.find(item => item.id === link.wallId)!
    const setback = (wall.thickness / 2 + .06) / distance(wall.start, wall.end) * side
    return [{ x: link.position.x - setback * (wall.end.y - wall.start.y), y: link.position.y + setback * (wall.end.x - wall.start.x) }]
  })
  return { value: { edits, rooms, hallId: hall.id, hallDoors, operations }, error: undefined }
}

function keepsHallConnected(hall: Point[], obstacles: Point[][], approach: Point[], doors: Point[]) {
  const centre = approach.reduce((sum, point) => ({ x: sum.x + point.x / approach.length, y: sum.y + point.y / approach.length }), { x: 0, y: 0 })
  return difference(polygon(hall), ...obstacles.map(polygon)).some(([outer, ...holes]) => {
    const boundary = points(outer), cutouts = holes.map(points)
    return [centre, ...doors].every(point => pointInPolygon(point, boundary) && !cutouts.some(cutout => pointInPolygon(point, cutout)))
  })
}

export function composeTwoStoreys(source: SceneSource, originalLower: SceneFloor, originalUpper: SceneFloor, brief: Brief, id: string) {
  const adjacent = source.floors.filter(floor => floor.elevation > originalLower.elevation + .001).sort((a, b) => a.elevation - b.elevation)[0]
  if (adjacent?.id !== originalUpper.id || brief.lower.floorId !== originalLower.id || brief.upper.floorId !== originalUpper.id) {
    return fail('Choose the ground floor and the adjacent upper floor in elevation order.')
  }
  const connecting = originalUpper.stairsFromBelow.filter(stair => stair.sourceFloorId === originalLower.id)
  if (connecting.length > 1) return fail('The two floors have several existing stair connections. Choose a building with one connecting stair for a coordinated preview.')
  const prior = connecting[0]
  const allowedMove = !!prior && (brief.stair.replaceStairId === prior.id || prior.id.startsWith('agent-'))
  if (brief.stair.replaceStairId && (!prior || brief.stair.replaceStairId !== prior.id)) return fail('Choose the existing stair that connects these two floors.')
  const model = source.floors.find(floor => floor.id === originalLower.id)?.models.find(item => item.id === prior?.id)
  const definition = source.models.find(item => item.id === model?.modelId)
  const openSource = model ? { ...source, floors: source.floors.map(floor => floor.id === originalLower.id
    ? { ...floor, models: floor.models.filter(item => item.id !== model.id) } : floor) } : source
  const lower = prior ? { ...originalLower, stairIds: originalLower.stairIds.filter(id => id !== prior.id) } : originalLower
  const upper = prior ? { ...originalUpper, stairsFromBelow: originalUpper.stairsFromBelow.filter(item => item.id !== prior.id) } : originalUpper
  const ground = prepareFloor(openSource, lower, brief.lower, `${id}-lower`, true)
  if (!ground.value) return ground
  const first = prepareFloor(openSource, upper, brief.upper, `${id}-upper`, false)
  if (!first.value) return first
  const { edits: groundEdits, hallId: groundHall, hallDoors: groundDoors, operations } = ground.value
  const { edits: firstEdits, hallId: firstHall, hallDoors: firstDoors } = first.value
  const draftSource = { ...openSource, floors: openSource.floors.map(floor =>
    floor.id === lower.id ? materializeFloorEdits(floor, groundEdits) :
    floor.id === upper.id ? materializeFloorEdits(floor, firstEdits) : floor) }
  const levels = captureArchitecturalScene(draftSource).floors
  const hallOnly = (floorId: string, hallId: string) => {
    const floor = levels.find(item => item.id === floorId)!
    return { ...floor, rooms: floor.rooms.filter(room => room.id === hallId) }
  }
  const down = hallOnly(lower.id, groundHall), up = hallOnly(upper.id, firstHall)
  const connected = (fit: NonNullable<ReturnType<typeof checkStairFit>>) =>
    keepsHallConnected(fit.lowerRoom.polygon, fit.body, fit.lowerApproach, groundDoors) &&
    keepsHallConnected(fit.upperRoom.polygon, fit.openings, fit.upperApproach, firstDoors)
  const existingFit = prior && model && definition && (!definition.stairDesign || brief.stair.layout === 'auto' || brief.stair.layout === definition.stairDesign.layout)
    ? checkStairFit(draftSource, down, up, model, definition, prior.clearWidth) : null
  const retained = existingFit && connected(existingFit) ? existingFit : null
  if (prior && !retained && !allowedMove) return fail('The existing stair does not fit within both proposed circulation spaces. Widen or realign the hall and landing, or ask to move the existing stair.')
  const stairProposal = retained ? null : planStaircase(draftSource, down, up, { floorId: lower.id, upperFloorId: upper.id,
    layout: brief.stair.layout, width: null, near: brief.stair.near }, `${id}-stair`, connected)
  const stairEdits = stairProposal && validateStairProposal(draftSource, down, stairProposal, up)
  if (!retained && !stairEdits?.stair) return fail('No stair fits between the proposed ground-floor hall and upstairs landing. Realign or widen the circulation spaces on both floors and keep doors clear of the approach.')
  const openings = retained?.openings ?? stairEdits!.stair!.openings
  const upperRooms = first.value.rooms.map(room => room.id === firstHall ? { ...room,
    area: area(difference(polygon(room.polygon), ...openings.map(polygon))),
    labelPoint: roomLabelPoint(room.polygon) } : room)
  if (upperRooms.find(room => room.id === firstHall)!.area < 2.2) return fail('Leave at least 2.2 m² of usable landing beyond the stair opening.')
  const groundRooms = ground.value.rooms
  const bedrooms = bedroomCount(brief.upper.rooms)
  const preserve = (floor: SceneFloor, stairOpenings: Point[][] = []) => ({
    stairId: retained && prior ? prior.id : '', stairOpenings, wallIds: floor.walls.map(wall => wall.id), openingIds: floor.openings.map(opening => opening.id),
  })
  const proposal: DesignProposal = {
    projectId: source.projectId, sourceRevision: source.revision, version: 1, method: 'coordinated', coordinated: brief,
    id, floorId: lower.id, floorName: lower.name, stairId: retained && prior ? prior.id : '', workspaceSignature: 'two-storey-layout',
    requirements: { ...standard, bedrooms: Math.max(1, bedrooms) }, priority: 'landing', assumptions: [],
    rooms: groundRooms, operations: [...operations, ...(stairProposal?.operations ?? [])], preserved: preserve(lower),
    validation: { passed: true, checks: ['Both room layouts and their doorway connections checked', 'Stair approaches and room entrances stay connected on both floors'] },
    warnings: ['Concept layout. Check structure, drainage, headroom and guarding before building.'], tradeoff: brief.explanation,
    narrative: { title: brief.title, explanation: brief.explanation, advantages: [], compromises: [] },
    metrics: { smallestBedroom: Math.min(...upperRooms.filter(room => room.function === 'bedroom').map(room => room.area), bedrooms ? Infinity : 0),
      bedroomArea: upperRooms.filter(room => room.function === 'bedroom').reduce((total, room) => total + room.area, 0),
      bathroomArea: upperRooms.filter(room => room.function === 'bathroom').reduce((total, room) => total + room.area, 0),
      landingArea: upperRooms.find(room => room.id === firstHall)!.area, circulationWidth: retained ? prior.clearWidth : stairProposal!.metrics.circulationWidth,
      daylitBedrooms: upperRooms.filter(room => room.function === 'bedroom' && room.windowIds.length).length,
      landingDaylight: !!upperRooms.find(room => room.id === firstHall)?.windowIds.length,
      usableArea: [...groundRooms, ...upperRooms].reduce((total, room) => total + room.area, 0) },
    layoutAxis: 0, landingRoute: [],
  }
  const edits: FloorEdits = { ...groundEdits,
    models: [...groundEdits.models, ...stairEdits?.models ?? []],
    removedModelIds: [...groundEdits.removedModelIds ?? [], ...(!retained && model ? [model.id] : [])],
    additionalFloors: [{ floorId: upper.id, edits: firstEdits }],
    ...(stairEdits && { stair: stairEdits.stair }),
    overlays: { [upper.id]: { rooms: upperRooms, operations: first.value.operations, preserved: preserve(upper, retained ? openings : []) } },
  }
  return { value: { proposal, edits }, error: undefined }
}

export function validateCoordinatedLayout(source: SceneSource, lower: SceneFloor, proposal: DesignProposal) {
  const brief = proposal.coordinated
  if (proposal.version !== 1 || proposal.projectId !== source.projectId || proposal.sourceRevision !== source.revision ||
      proposal.floorId !== lower.id || typeof proposal.id !== 'string' || !proposal.id || proposal.id.length > 120 ||
      !validToolArguments('compose_two_storey_layout', brief) || !brief) return null
  const working = proposal.extensionBasis ? stageExtension(source, proposal.extensionBasis) : source
  if (!working) return null
  const scene = captureArchitecturalScene(working)
  const ground = scene.floors.find(floor => floor.id === lower.id)
  const upper = scene.floors.find(floor => floor.id === brief.upper.floorId)
  if (!ground || !upper) return null
  const edits = checkCandidate(() => composeTwoStoreys(working, ground, upper, brief, proposal.id))?.value?.edits
  if (!edits) return null
  if (working === source) return edits
  const finished = materializeProposalFloors(working.floors, ground.id, edits)
  if (!finished) return null
  const changes = finished.flatMap((floor, index) => floor === source.floors[index] ? [] :
    [{ floorId: floor.id, edits: differenceBetweenFloors(source.floors[index], floor) }])
  const primary = changes.find(change => change.floorId === ground.id)
  return primary ? { ...primary.edits, stair: edits.stair, overlays: edits.overlays,
    additionalFloors: changes.filter(change => change !== primary) } : null
}

/** Fold the shell and interior draft into ordinary editor changes against the original project. */
function differenceBetweenFloors(original: FloorLevel, final: FloorLevel): FloorChanges {
  const previousWalls = new Map(original.walls.map(wall => [wall.id, wall]))
  const previousModels = new Map(original.models.map(model => [model.id, model]))
  const finalWallIds = new Set(final.walls.map(wall => wall.id))
  const finalModels = new Map(final.models.map(model => [model.id, model]))
  return {
    walls: final.walls.filter(wall => previousWalls.get(wall.id) !== wall),
    rooms: final.rooms,
    models: final.models.filter(model => previousModels.get(model.id) !== model),
    removedWallIds: original.walls.filter(wall => !finalWallIds.has(wall.id)).map(wall => wall.id),
    removedModelIds: original.models.filter(model => finalModels.get(model.id) !== model).map(model => model.id),
    ...(original.floorFootprints !== final.floorFootprints && { floorFootprints: final.floorFootprints }),
    ...(original.assistantWindowExclusion !== final.assistantWindowExclusion && { windowExclusion: final.assistantWindowExclusion }),
  }
}
