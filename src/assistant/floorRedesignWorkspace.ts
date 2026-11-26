import { type ToolArguments, type ToolResult, toolError } from './architecturalTools.ts'
import { composeFloorLayout } from './composeFloorLayout.ts'
import { existingRoomPlans, type ExistingRoomBrief } from './existingRoomPlan.ts'
import type { Requirements } from './intent.ts'
import { getRoomWindows } from './layoutValidation.ts'
import { area, checkCandidate, difference, pointInPolygon, polygon } from './planGeometry.ts'
import type { DesignProposal, Partition, ProposedRoom, RoomRedesign, WindowExclusion } from './proposal.ts'
import { checkRedesignAccess, checkRoomSchedule, createRedesignDoor, createRedesignExteriorDoor, createRedesignWindow, detectRedesignSpaces, excludedFacadeWalls, openingConnections, rebuildRedesign,
  redesignMeasurements, redesignScene, roomScheduleLabels, validateRoomRedesign, type RedesignGeometry, type RedesignOperation, type RedesignSpace } from './roomRedesign.ts'
import { ASSISTANT_EXTERIOR_DOOR_MODELS, type SceneFloor, type SceneSource } from './scene.ts'

type FloorDraft = { id: string; floor: SceneFloor; bedrooms: number | null; expectedEnsuites: number;
  windowExclusion?: WindowExclusion; excludedWindowWallIds: string[];
  operations: RedesignOperation[]; geometry: RedesignGeometry; rooms: RedesignSpace[]; schedule?: RoomRedesign;
  evaluations: number; cached?: { findings: string[]; proposal: DesignProposal | null } }

const ok = (value: unknown): ToolResult => ({ ok: true, value })
const invalid = (message: string) => toolError('redesign_geometry', message)

export function createFloorRedesignWorkspace(source: SceneSource, maxEvaluations: number, nextId: () => string,
  invalidate: (id: string) => void, requestedExclusion: (floorId: string) => WindowExclusion | undefined) {
  const drafts = new Map<string, FloorDraft>()
  const isFloorDraft = (id: string) => drafts.has(id)
  const proposal = (id: string) => drafts.get(id)?.cached?.proposal

  function describe(draft: FloorDraft) {
    const floor = redesignScene(draft.floor, draft.geometry)
    return { draftId: draft.id, floorId: draft.floor.id, units: 'metres', footprint: draft.floor.footprint,
      walls: draft.geometry.walls, rooms: draft.rooms.map(room => redesignMeasurements(room, floor)),
      connections: openingConnections(draft.geometry.walls, draft.rooms), stairs: draft.floor.stairsFromBelow, schedule: draft.schedule }
  }

  function layout(id: string, floorId: string) {
    const draft = drafts.get(id)
    return draft?.floor.id === floorId ? ok(describe(draft)) : invalid('Inspect a current floor redesign draft on this floor.')
  }

  function inspectRoom(id: string, roomId: string) {
    const draft = drafts.get(id)
    const room = draft?.rooms.find(item => item.id === roomId)
    return draft && room ? ok({ ...redesignMeasurements(room, redesignScene(draft.floor, draft.geometry)),
      connections: openingConnections(draft.geometry.walls, draft.rooms).filter(link => link.from === roomId || link.to === roomId) }) : invalid('Use a room ID from the current floor redesign.')
  }

  function inspectWall(id: string, wallId: string) {
    const wall = drafts.get(id)?.geometry.walls.find(item => item.id === wallId)
    return wall ? ok({ ...wall, length: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y),
      materialIds: source.wallMaterials?.filter(item => item.wallId === wall.id).map(item => item.materialId) ?? [] }) : invalid('Use a wall ID from the current floor redesign.')
  }

  function save(draft: FloorDraft) {
    drafts.set(draft.id, { ...draft, cached: undefined })
    invalidate(draft.id)
  }

  function begin(floor: SceneFloor, args: ToolArguments<'begin_room_redesign'>, seed?: DesignProposal): ToolResult {
    if (drafts.size >= 4) return invalid('Four redesign experiments are available per request. Continue with one of the current drafts.')
    const existing = args.baseId ? drafts.get(args.baseId) : undefined
    if (args.baseId && !existing && seed?.method !== 'room-redesign') return invalid('Choose a current floor redesign to copy or start a new one.')
    if (existing && existing.floor.id !== floor.id || seed && seed.floorId !== floor.id) return invalid('The selected base must belong to this floor.')
    const operations = existing?.operations ?? seed?.operations.filter(op => op.type !== 'label-room') ?? []
    const rebuilt = rebuildRedesign(source, floor, operations)
    if (!rebuilt.value) return invalid(rebuilt.error)
    const prior: RedesignSpace[] = existing?.rooms ?? seed?.rooms.map(room => ({ ...room, signature: '', anchor: room.labelPoint })) ?? []
    const schedule = existing?.schedule ?? seed?.redesign
    const bedrooms = args.bedrooms ?? schedule?.bedroomIds.length ?? null
    const expectedEnsuites = args.bedrooms === null && schedule ? schedule.ensuites.length : args.ensuites
    if (expectedEnsuites > (bedrooms ?? 0)) return invalid('A bedroom schedule permits at most one en suite per bedroom.')
    const windowExclusion = requestedExclusion(floor.id) ?? existing?.windowExclusion ?? seed?.windowExclusion
    const excludedWindowWallIds = windowExclusion ? excludedFacadeWalls(floor, windowExclusion) : []
    if (windowExclusion && !excludedWindowWallIds.length) return invalid(`The editor could not identify the ${windowExclusion} facade in plan view.`)
    const draft: FloorDraft = { id: nextId(), floor, bedrooms, expectedEnsuites,
      windowExclusion, excludedWindowWallIds,
      operations: [...operations], geometry: rebuilt.value, rooms: detectRedesignSpaces(floor, rebuilt.value, prior, nextId),
      schedule: schedule?.bedroomIds.length === bedrooms && schedule.ensuites.length === expectedEnsuites ? schedule : undefined, evaluations: 0 }
    drafts.set(draft.id, draft)
    return ok({ draftId: draft.id, floorId: floor.id, baseId: args.baseId, schedule: draft.schedule,
      excludedWindowWallIds: windowExclusion ? excludedWindowWallIds : undefined,
      excludedOpeningIds: windowExclusion ? excludedWindows(draft) : undefined })
  }

  function reuseExistingRooms(floor: SceneFloor, brief: ExistingRoomBrief): DesignProposal | null {
    const initial = rebuildRedesign(source, floor, [])
    if (!initial.value) return null
    const rooms = detectRedesignSpaces(floor, initial.value, [], nextId)
    const windowExclusion = requestedExclusion(floor.id)
    const excludedWindowWallIds = windowExclusion ? excludedFacadeWalls(floor, windowExclusion) : []
    let attempts = 0
    for (const { schedule, operations } of existingRoomPlans(source, floor, initial.value, rooms, brief, nextId)) {
      if (attempts++ >= 12) break
      const rebuilt = rebuildRedesign(source, floor, operations)
      if (!rebuilt.value) continue
      const draft: FloorDraft = { id: nextId(), floor, bedrooms: brief.bedrooms, expectedEnsuites: brief.ensuites,
        windowExclusion, excludedWindowWallIds, operations, geometry: rebuilt.value, rooms: rooms.map(room => ({ ...room, name: null })),
        schedule, evaluations: 0 }
      const { proposal } = evaluateFloorDraft(source, draft)
      if (proposal) return proposal
    }
    return null
  }

  function compose(floor: SceneFloor, args: ToolArguments<'compose_floor_layout'>) {
    const windowExclusion = requestedExclusion(floor.id)
    const result = composeFloorLayout(source, floor, args, nextId, windowExclusion)
    if ('error' in result) return { error: result.error }
    const draft: FloorDraft = { ...result, id: nextId(), floor, bedrooms: args.bedrooms.length, expectedEnsuites: args.ensuites.length,
      windowExclusion, excludedWindowWallIds: windowExclusion ? excludedFacadeWalls(floor, windowExclusion) : [], evaluations: 1 }
    const { findings, proposal } = evaluateFloorDraft(source, draft)
    return proposal ? { proposal } : { error: findings.join(' ') }
  }

  function change(draft: FloorDraft, operations: RedesignOperation[]) {
    const rebuilt = rebuildRedesign(source, draft.floor, operations)
    if (!rebuilt.value) return invalid(rebuilt.error)
    const updated = { ...draft, operations, geometry: rebuilt.value, rooms: detectRedesignSpaces(draft.floor, rebuilt.value, draft.rooms, nextId) }
    save(updated)
    const beforeWalls = new Map(draft.geometry.walls.map(wall => [wall.id, JSON.stringify(wall)]))
    const walls = updated.geometry.walls.filter(wall => beforeWalls.get(wall.id) !== JSON.stringify(wall))
    const beforeRooms = new Map(draft.rooms.map(room => [room.id, room.signature]))
    const beforeConnections = new Map(openingConnections(draft.geometry.walls, draft.rooms).map(link => [link.openingId, JSON.stringify(link)]))
    const connections = openingConnections(rebuilt.value.walls, updated.rooms)
    const connectionIds = new Set(connections.map(link => link.openingId))
    const editedFloor = redesignScene(updated.floor, updated.geometry)
    return ok({ draftId: draft.id, walls,
      removedWallIds: draft.geometry.walls.filter(wall => !updated.geometry.walls.some(item => item.id === wall.id)).map(wall => wall.id),
      rooms: updated.rooms.filter(room => beforeRooms.get(room.id) !== room.signature).map(room => redesignMeasurements(room, editedFloor)),
      removedRoomIds: draft.rooms.filter(room => !updated.rooms.some(item => item.id === room.id)).map(room => room.id),
      connections: connections.filter(link => beforeConnections.get(link.openingId) !== JSON.stringify(link)),
      removedConnectionIds: [...beforeConnections.keys()].filter(id => !connectionIds.has(id)),
    })
  }

  function partitions(draft: FloorDraft, walls: ToolArguments<'create_partition_wall'>['walls']): Partition[] {
    return walls.map(({ start, end }): Partition => ({ type: 'create-partition', id: nextId(), start, end,
      thickness: source.partitionThickness, height: draft.geometry.original.roomHeight }))
  }

  function addWalls(args: ToolArguments<'create_partition_wall'>) {
    const draft = drafts.get(args.draftId)!
    return change(draft, [...draft.operations, ...partitions(draft, args.walls)])
  }

  function editPartitions(args: ToolArguments<'edit_floor_partitions'>) {
    const draft = drafts.get(args.draftId)!
    const removedWalls = new Set(args.removeWallIds)
    const closedOpenings = new Set(args.removeOpeningIds)
    const movedWalls = new Map(args.moves.map(move => [move.wallId, move]))
    if (!removedWalls.size && !closedOpenings.size && !movedWalls.size && !args.walls.length) return invalid('Supply at least one partition or opening change.')
    if (movedWalls.size !== args.moves.length || args.moves.some(move => removedWalls.has(move.wallId))) {
      return invalid('Choose one action for each wall in the batch.')
    }
    const proposedWalls = new Set(draft.operations.flatMap(op => op.type === 'create-partition' ? [op.id] : []))
    const proposedOpenings = new Set(draft.operations.flatMap(op => op.type === 'create-doorway' || op.type === 'create-window' ? [op.id] : []))
    const operations = draft.operations.flatMap((op): RedesignOperation[] => {
      if (op.type === 'create-partition') {
        if (removedWalls.has(op.id)) return []
        const move = movedWalls.get(op.id)
        return [move ? { ...op, start: move.start, end: move.end } : op]
      }
      if (op.type === 'move-partition' && (removedWalls.has(op.wallId) || movedWalls.has(op.wallId))) return []
      if ((op.type === 'create-doorway' || op.type === 'create-window') &&
          (closedOpenings.has(op.id) || removedWalls.has(op.wallId) && proposedWalls.has(op.wallId))) return []
      return [op]
    })
    for (const openingId of closedOpenings) {
      if (!proposedOpenings.has(openingId)) operations.push({ type: 'remove-opening', openingId })
    }
    for (const wallId of removedWalls) {
      if (!proposedWalls.has(wallId)) operations.push({ type: 'remove-partition', wallId })
    }
    for (const move of movedWalls.values()) {
      if (!proposedWalls.has(move.wallId)) operations.push({ type: 'move-partition', ...move })
    }
    return change(draft, [...operations, ...partitions(draft, args.walls)])
  }

  function moveWall(args: ToolArguments<'move_partition_wall'>) {
    const draft = drafts.get(args.draftId)!
    const wall = draft.geometry.walls.find(item => item.id === args.wallId)
    if (!wall || wall.kind !== 'internal') return invalid('Choose a current internal wall. Exterior wall lines remain in place.')
    if (draft.operations.some(op => op.type === 'create-partition' && op.id === wall.id)) {
      if (wall.openings?.length) return invalid('Relocate the proposed opening before moving its host wall.')
      return change(draft, draft.operations.map(op => op.type === 'create-partition' && op.id === wall.id ? { ...op, start: args.start, end: args.end } : op))
    }
    return change(draft, [...draft.operations.filter(op => op.type !== 'move-partition' || op.wallId !== wall.id),
      { type: 'move-partition', wallId: wall.id, start: args.start, end: args.end }])
  }

  function removeWall(args: ToolArguments<'remove_internal_partition'>, onlyProposed: boolean) {
    const draft = drafts.get(args.draftId)!
    const proposed = draft.operations.some(op => op.type === 'create-partition' && op.id === args.wallId)
    if (!proposed && onlyProposed) return invalid('Use remove_internal_partition to remove an existing partition in this draft.')
    if (proposed) return change(draft, draft.operations.filter(op => !(op.type === 'create-partition' && op.id === args.wallId ||
      (op.type === 'create-doorway' || op.type === 'create-window') && op.wallId === args.wallId)))
    return change(draft, [...draft.operations.filter(op => op.type !== 'move-partition' || op.wallId !== args.wallId),
      { type: 'remove-partition', wallId: args.wallId }])
  }

  function editDoor(args: ToolArguments<'insert_internal_door'>, priorId?: string) {
    const draft = drafts.get(args.draftId)!
    if (priorId && !draft.operations.some(op => op.type === 'create-doorway' && !op.exterior && op.id === priorId)) return invalid('Choose a proposed internal door ID for this move.')
    const doors = args.doors.flatMap(({ roomId, offset, wallId }) => {
      const wall = draft.geometry.walls.find(item => item.id === wallId)
      const door = wall ? createRedesignDoor(wall, draft.rooms, roomId, offset, priorId ?? nextId(), source) : null
      return door ? [door] : []
    })
    if (doors.length !== args.doors.length) return invalid('At that offset the door does not have a detected room on each side. Check the wall, offset and swing room.')
    return change(draft, [...draft.operations.filter(op => op.type !== 'create-doorway' || op.id !== priorId), ...doors])
  }

  function insertWindows(args: ToolArguments<'insert_windows'>) {
    const draft = drafts.get(args.draftId)!
    if (args.windows.some(window => draft.excludedWindowWallIds.includes(window.wallId))) {
      return invalid(`The ${draft.windowExclusion} facade must remain window-free. Use other exterior walls for daylight.`)
    }
    const windows = args.windows.flatMap(({ wallId, offset, width, height, sillHeight }) => {
      const wall = draft.geometry.walls.find(item => item.id === wallId && item.kind === 'external')
      return wall ? [createRedesignWindow(wall, nextId(), offset, width, height, sillHeight)] : []
    })
    if (windows.length !== args.windows.length) return invalid('Choose a current exterior wall for each window.')
    return change(draft, [...draft.operations, ...windows])
  }

  function insertExteriorDoors(args: ToolArguments<'insert_exterior_doors'>) {
    const draft = drafts.get(args.draftId)!
    const doors = args.doors.flatMap(({ wallId, offset, kind }) => {
      const wall = draft.geometry.walls.find(item => item.id === wallId)
      const door = wall && createRedesignExteriorDoor(wall, draft.rooms, offset, kind, nextId(), source)
      return door ? [door] : []
    })
    if (doors.length !== args.doors.length) return invalid('Choose an exterior wall with a clear opening into a detected room and a supported door model.')
    return change(draft, [...draft.operations, ...doors])
  }

  function removeOpening(args: ToolArguments<'remove_opening'>) {
    const draft = drafts.get(args.draftId)!
    if (draft.operations.some(op => (op.type === 'create-doorway' || op.type === 'create-window') && op.id === args.openingId)) {
      return change(draft, draft.operations.filter(op => (op.type !== 'create-doorway' && op.type !== 'create-window') || op.id !== args.openingId))
    }
    return change(draft, [...draft.operations, { type: 'remove-opening', openingId: args.openingId }])
  }

  function setSchedule({ draftId, ...schedule }: ToolArguments<'set_room_schedule'>) {
    const draft = drafts.get(draftId)!
    const updatedSchedule = { ...schedule, home: draft.schedule?.home }
    const labels = roomScheduleLabels(updatedSchedule)
    if (schedule.bedroomIds.length !== draft.bedrooms || schedule.ensuites.length !== draft.expectedEnsuites ||
      new Set(labels.map(label => label.roomId)).size !== labels.length || labels.some(label => !draft.rooms.some(room => room.id === label.roomId))) {
      return invalid('Provide the requested bedroom and ensuite counts and a landing, all using different current room IDs.')
    }
    save({ ...draft, schedule: updatedSchedule, rooms: draft.rooms.map(room => {
      const label = labels.find(label => label.roomId === room.id)
      return label ? { ...room, name: label.name, function: label.function } : room
    }) })
    return ok({ schedule: updatedSchedule, rooms: labels })
  }

  function nameRooms(args: ToolArguments<'set_room_name'>) {
    const draft = drafts.get(args.draftId)!
    if (!draft.schedule || args.rooms.some(item => !roomScheduleLabels(draft.schedule!).some(label => label.roomId === item.roomId))) {
      return invalid('Assign these rooms to the schedule before naming them.')
    }
    if (args.rooms.some(item => !draft.rooms.some(room => room.id === item.roomId))) return invalid('Use current detected room IDs.')
    save({ ...draft, rooms: draft.rooms.map(room => ({ ...room, name: args.rooms.find(item => item.roomId === room.id)?.name ?? room.name })) })
    return ok({ rooms: args.rooms })
  }

  function evaluate(id: string) {
    const draft = drafts.get(id)!
    if (!draft.cached && draft.evaluations >= maxEvaluations) return toolError('revision_limit', 'The floor redesign reached its evaluation limit.')
    if (!draft.cached) {
      draft.evaluations++
      draft.cached = evaluateFloorDraft(source, draft)
    }
    const floor = redesignScene(draft.floor, draft.geometry)
    return ok({ draftId: id, valid: !!draft.cached.proposal, findings: draft.cached.findings, metrics: draft.cached.proposal?.metrics,
      excludedOpeningIds: draft.windowExclusion ? excludedWindows(draft) : undefined,
      warnings: draft.cached.proposal?.warnings, rooms: draft.rooms.map(room => ({
        id: room.id, name: room.name, area: room.area, windowIds: getRoomWindows(room.polygon, floor),
      })),
    })
  }

  return { isFloorDraft, proposal, begin, reuseExistingRooms, compose, layout, inspectRoom, inspectWall, addWalls, editPartitions, moveWall, removeWall, editDoor, insertWindows, insertExteriorDoors,
    removeOpening, setSchedule, nameRooms, evaluate }
}

function excludedWindows(draft: FloorDraft) {
  return redesignScene(draft.floor, draft.geometry).openings
    .filter(opening => opening.kind === 'window' && draft.excludedWindowWallIds.includes(opening.wallId)).map(opening => opening.id)
}

function evaluateFloorDraft(source: SceneSource, draft: FloorDraft) {
  const { floor, geometry, rooms, schedule, operations } = draft
  if (draft.bedrooms !== null && !schedule) return { findings: ['Set the room schedule after inspecting the current detected spaces.'], proposal: null }
  if (!schedule && !operations.length) return { findings: ['Make a wall, door or window change before publishing the floor redesign.'], proposal: null }
  const requirements: Requirements = { bedrooms: draft.bedrooms ?? 1, bathrooms: 1, landing: 'standard', bathroom: 'standard', primaryBedroom: 'standard', oppositeBedroom: null }
  const failures = checkRedesignAccess(source, floor, geometry, rooms, operations)
  if (draft.windowExclusion && excludedWindows(draft).length) failures.push(`Close the windows on the ${draft.windowExclusion} facade before publishing.`)
  if (schedule) failures.push(...checkRoomSchedule(floor, geometry, rooms, schedule, requirements))
  if (failures.length) return { findings: failures, proposal: null }
  const [stair] = floor.stairsFromBelow
  const openings = floor.stairsFromBelow.flatMap(item => item.openings)
  const editedFloor = redesignScene(floor, geometry)
  const labels = schedule ? roomScheduleLabels(schedule).map(label => ({ ...label, name: rooms.find(room => room.id === label.roomId)!.name ?? label.name })) : []
  const proposed: ProposedRoom[] = labels.map(label => {
    const room = rooms.find(item => item.id === label.roomId)!
    const landing = label.function === 'landing'
    return { id: room.id, name: label.name, function: label.function, polygon: room.polygon, labelPoint: landing && stair &&
        openings.some(opening => pointInPolygon(room.anchor, opening)) ? stair.upperEdge : room.anchor,
      area: landing ? area(difference(polygon(room.polygon), ...openings.map(polygon))) : room.area, windowIds: getRoomWindows(room.polygon, editedFloor) }
  })
  const bedrooms = proposed.filter(room => room.function === 'bedroom')
  const landing = proposed.find(room => room.id === schedule?.landingId)
  const bathroom = proposed.find(room => room.id === schedule?.sharedBathroomId)
  const home = !!schedule?.home
  const aboveGround = source.floors.some(level => level.elevation < floor.elevation - 0.001)
  const hasExteriorDoor = editedFloor.openings.some(opening => opening.bottom <= 0.05 && opening.modelId !== ASSISTANT_EXTERIOR_DOOR_MODELS.patio &&
    editedFloor.walls.some(wall => wall.id === opening.wallId && wall.kind === 'external'))
  const moved = new Set(operations.flatMap(op => op.type === 'move-partition' ? [op.wallId] : []))
  const result: DesignProposal = {
    version: 1, method: 'room-redesign', redesign: schedule, windowExclusion: draft.windowExclusion,
    id: draft.id, projectId: source.projectId, sourceRevision: source.revision,
    floorId: floor.id, floorName: floor.name, workspaceSignature: floor.rooms.find(room => room.id === landing?.id)?.signature ?? 'floor-redesign',
    stairId: stair?.id ?? '', requirements, priority: 'bedrooms', rooms: proposed, operations: [...operations, ...labels],
    assumptions: schedule ? [home ? 'The hallway connects the shared spaces. Each en suite opens off its bedroom.' :
      'Room uses and doorway connections follow the detected floor geometry. Landing area excludes the stair opening.'] : [],
    warnings: ['Concept design. Have any wall or opening changes, bathroom clearances and drainage checked before building.',
      ...(schedule && !stair && (!home || aboveGround) ? ['This floor has no modeled stair arrival. Check where the stair will meet the proposed circulation space.'] : []),
      ...(home && !aboveGround && !hasExteriorDoor ? ['The shell has no exterior entrance. Allow for an entrance into the hallway.'] : [])],
    validation: { passed: true, checks: [stair ? 'Native floor geometry and existing stair clearances checked' : 'Native floor geometry checked',
      ...(draft.windowExclusion ? [`Window-free ${draft.windowExclusion} facade checked`] : []),
      ...(schedule ? [home ? 'Shared rooms reachable from the hallway' : 'Independent access from the landing', 'Private entry for each en suite'] :
        ['Existing room entrances and proposed door swings checked'])] },
    tradeoff: '', preserved: { wallIds: floor.walls.filter(wall => !geometry.removedWalls.has(wall.id) && !moved.has(wall.id)).map(wall => wall.id),
      openingIds: floor.openings.filter(opening => editedFloor.openings.some(item => item.id === opening.id)).map(opening => opening.id),
      stairId: stair?.id ?? '', stairOpenings: openings },
    metrics: { smallestBedroom: bedrooms.length ? Math.min(...bedrooms.map(room => room.area)) : 0, bedroomArea: bedrooms.reduce((sum, room) => sum + room.area, 0),
      bathroomArea: bathroom?.area ?? 0, landingArea: landing?.area ?? 0, circulationWidth: 0, daylitBedrooms: bedrooms.filter(room => room.windowIds.length).length,
      landingDaylight: !!landing?.windowIds.length, usableArea: rooms.reduce((sum, room) => sum + room.area, 0) }, landingRoute: [], layoutAxis: 0,
  }
  return checkCandidate(() => validateRoomRedesign(source, floor, result)) ? { findings: [], proposal: result } :
    { findings: ['The editor could not reproduce this room schedule and its openings. Inspect the detected rooms and doorway connections.'], proposal: null }
}
