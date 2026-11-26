import { asRecord, validRequirements } from './intent.ts'
import { type ToolArguments, type ToolName, type ToolResult, toolError, validToolArguments } from './architecturalTools.ts'
import { availableArea, availableSite, draftGeometry, evaluateDraft, movedPartitions, reconcileDraftRooms,
  resolveDraftDoor, roomMeasurements, type Draft, type DraftDoor, type DraftRoom } from './agentGeometry.ts'
import { planLayout } from './layoutPlanner.ts'
import { exitClearance, minimumRoomArea, partitionCutsOpening, ROUTE_WIDTH } from './layoutValidation.ts'
import { createFloorRedesignWorkspace } from './floorRedesignWorkspace.ts'
import { isOpenFloor } from './composeFloorLayout.ts'
import { excludedFacadeWalls, openingConnections } from './roomRedesign.ts'
import { validateProposal } from './proposalValidation.ts'
import { planStaircase } from './stairPlacement.ts'
import { composeTwoStoreys } from './coordinatedLayout.ts'
import { inspectExtensionSite, planExtension } from './extensionPlacement.ts'
import { area, bounds, checkCandidate, distance, edges, intersection, polygon, union } from './planGeometry.ts'
import type { DesignProposal, Partition } from './proposal.ts'
import { ASSISTANT_DOOR_MODEL, ASSISTANT_EXTERIOR_DOOR_MODELS, captureArchitecturalScene, type SceneFloor, type SceneRoom, type SceneSource } from './scene.ts'
import { findModelVariants, proposeModelVariants } from './modelVariants.ts'

const ok = (value: unknown): ToolResult => ({ ok: true, value })
const missing = (entity: string) => toolError('unknown_id', `I couldn’t find that ${entity} in the named floor or draft. Inspect the current IDs first.`)

function describesDifference(a: DesignProposal, b: DesignProposal) {
  if (a.floorId !== b.floorId) return true
  if (Math.abs(a.metrics.landingArea - b.metrics.landingArea) >= 0.9) return true
  const layout = (proposal: DesignProposal) => proposal.rooms.map(room => ({ ...room, shape: polygon(room.polygon) }))
  const first = layout(a), second = layout(b)
  return first.some(room => {
    const sameUse = second.filter(other => room.function === other.function)
    const overlap = Math.max(0, ...sameUse.map(other => area(intersection(room.shape, other.shape))))
    return overlap < area([room.shape]) * 0.8 && area([room.shape]) - overlap >= 1
  })
}

function aboutRoom(room: Pick<SceneRoom, 'id' | 'polygon' | 'area' | 'name' | 'function'>, floor: SceneFloor) {
  const entrances = floor.openings.filter(opening => opening.kind !== 'window' && opening.bottom <= 0.05 &&
    edges(room.polygon).some(([a, b]) => {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      if (length < 0.001) return false
      const px = opening.position.x - a.x, py = opening.position.y - a.y
      const width = floor.walls.find(wall => wall.id === opening.wallId)?.thickness ?? 0
      const along = (px * dx + py * dy) / length
      return along >= 0 && along <= length && Math.abs(px * dy - py * dx) / length <= width / 2 + 0.025
    }))
  return { ...roomMeasurements(room, floor), outline: room.polygon, entrances: entrances.map(opening => opening.id) }
}

export function createAgentWorkspace(source: SceneSource, previous: DesignProposal | null, maxEvaluations: number,
  windowExclusion?: DesignProposal['windowExclusion'], priorWindowExclusion?: DesignProposal['windowExclusion']) {
  const scene = captureArchitecturalScene(source)
  const drafts = new Map<string, Draft>()
  const seeds = new Map<string, DesignProposal>()
  const published = new Map<string, DesignProposal>()
  const prefix = `agent-${crypto.randomUUID()}`
  let sequence = 0
  const id = () => `${prefix}-${++sequence}`
  const level = (floorId: string) => scene.floors.find(floor => floor.id === floorId)
  const activeFloor = level(scene.selection.floorId)
  const revisingAppliedLayout = !!activeFloor?.rooms.some(room => room.function === 'bedroom') &&
    activeFloor.rooms.some(room => room.function === 'landing')
  const exclusionFor = (floorId: string) => windowExclusion ?? source.floors.find(floor => floor.id === floorId)?.assistantWindowExclusion ??
    (previous?.floorId === floorId ? previous.windowExclusion : undefined) ??
    (revisingAppliedLayout && floorId === activeFloor?.id ? priorWindowExclusion : undefined)
  const redesigns = createFloorRedesignWorkspace(source, maxEvaluations, id, draftId => published.delete(draftId), exclusionFor)
  const siteFor = (floor: SceneFloor) => availableSite(floor, scene.selection.floorId === floor.id ? scene.selection.roomSignature : null)
  if (previous) {
    const floor = level(previous.floorId)
    if (!floor || !checkCandidate(() => validateProposal(source, floor, previous))) {
      throw new Error('The previous proposal could not be restored against the current geometry. Start a new design from this revision.')
    }
    const stair = floor.stairsFromBelow.find(item => item.id === previous.stairId)
    const removedWalls = new Set(previous.operations.filter(op => op.type === 'remove-partition' || op.type === 'move-partition').map(op => op.wallId))
    const removedOpenings = new Set(previous.operations.filter(op => op.type === 'remove-opening').map(op => op.openingId))
    seeds.set(previous.id, { ...previous, preserved: { stairId: previous.stairId, stairOpenings: stair?.openings ?? [],
      wallIds: floor.walls.filter(wall => !removedWalls.has(wall.id)).map(wall => wall.id),
      openingIds: floor.openings.filter(opening => !removedOpenings.has(opening.id)).map(opening => opening.id) } })
  }

  function getDraft(draftId: string) { return drafts.get(draftId) }
  function save(draft: Draft) {
    drafts.set(draft.id, { ...draft, changes: draft.changes + 1, cached: undefined })
    published.delete(draft.id)
  }

  function begin(args: ToolArguments<'begin_design'>): ToolResult {
    if (exclusionFor(args.floorId)) return toolError('redesign_scope', 'Use begin_room_redesign to enforce the window-free facade.')
    const floor = level(args.floorId)
    if (!floor) return missing('level')
    if (!validRequirements(args.requirements)) return toolError('room_schedule', 'Choose one to four bedrooms, one bathroom, and a landing.')
    if (drafts.size >= 4) return toolError('draft_limit', 'Four draft experiments are available in this request. Improve one of the drafts already created.')
    const prior = args.baseId ? drafts.get(args.baseId) : undefined
    const seed = args.baseId ? seeds.get(args.baseId) : undefined
    if (seed?.method === 'room-redesign' || args.baseId && redesigns.isFloorDraft(args.baseId)) return toolError('redesign_scope', 'Use begin_room_redesign to revise this floor design.')
    if (args.baseId && !prior && !seed || prior && prior.site.floor.id !== floor.id || seed && seed.floorId !== floor.id) return missing('base design')
    const site = prior?.site ?? (seed ? availableSite(floor, seed.workspaceSignature) : siteFor(floor))
    if (!site) return toolError('unsupported_space', 'Choose one existing upper-floor enclosure with a single staircase opening. Inspect the floor and its constraints.')
    const minimum = (['bathroom', 'landing'] as const).reduce((sum, kind) => sum + minimumRoomArea(kind, args.requirements),
      args.requirements.bedrooms * minimumRoomArea('bedroom', args.requirements))
    const available = availableArea(site)
    if (available < minimum) return toolError('insufficient_area', `The enclosure provides ${available.toFixed(2)} m² after the stair opening. This room schedule needs at least ${minimum.toFixed(2)} m² before partitions. Consider fewer bedrooms or a larger enclosure.`)
    const walls = prior?.walls ?? seed?.operations.filter(op => op.type === 'create-partition') ?? []
    const doors = prior?.doors ?? seed?.operations.filter(op => op.type === 'create-doorway') ?? []
    const oldRooms = prior?.rooms ?? seed?.rooms.map(room => ({ ...room, signature: '', anchor: room.labelPoint })) ?? []
    const draft: Draft = { id: id(), requirements: args.requirements, site, priority: args.priority, walls: [...walls], doors: [...doors], rooms: [...oldRooms], changes: 0, evaluations: 0 }
    draft.rooms = reconcileDraftRooms(draft, draftGeometry(source, draft), id)
    if (walls.length && !draft.rooms.length) return toolError('base_geometry', 'The base design could not be opened in the tool workspace.')
    drafts.set(draft.id, draft)
    return ok({ draftId: draft.id, floorId: floor.id, baseId: args.baseId, walls: draft.walls, doors: draft.doors,
      rooms: draft.rooms.map(room => aboutRoom(room, floor)), availableArea: available })
  }

  function editWalls(draft: Draft, walls: Partition[], doors = draft.doors) {
    const candidate = { ...draft, walls, doors }
    const conflict = walls.find(wall => partitionCutsOpening(draft.site.floor, wall))
    if (conflict) return toolError('opening_conflict', `Partition ${conflict.id} meets an existing opening. Use the floor’s measured opening position and leave the wall junction clear.`)
    const geometry = walls.length ? draftGeometry(source, candidate) : null
    if (walls.length && !geometry) return toolError('partition_geometry', 'A partition crosses a wall or the stair, overlaps another wall, or leaves the editable enclosure. Inspect the floor and adjust its centre-line endpoints.')
    candidate.rooms = reconcileDraftRooms(candidate, geometry, id)
    save(candidate)
    return ok({ walls: candidate.walls, doors: candidate.doors, rooms: candidate.rooms.map(room => aboutRoom(room, draft.site.floor)) })
  }

  function editDoors(draft: Draft, added: DraftDoor[], keep: DraftDoor[]) {
    const geometry = draftGeometry(source, draft)
    if (!geometry) return toolError('door_wall', 'Create valid partitions before adding doors.')
    const complete = [...keep, ...added]
    for (const door of added) {
      const resolved = resolveDraftDoor(door, draft, geometry)
      if (!resolved) return toolError('door_clearance', `Door opening at ${door.offset.toFixed(2)} m on ${door.wallId} does not fit between two rooms, clear the adjoining walls, or have room to swing. Inspect the wall and room IDs and choose an offset away from the ends and junctions.`)
      if (complete.some(other => other !== door && other.wallId === door.wallId && Math.abs(other.offset - door.offset) < resolved.door.width + 0.05)) {
        return toolError('door_overlap', 'That opening overlaps another proposed door. Increase the separation or choose another wall.')
      }
    }
    save({ ...draft, doors: complete })
    return ok({ doors: added })
  }

  function inspectRoom(args: ToolArguments<'get_room_details'>): ToolResult {
    if (args.draftId) {
      if (redesigns.isFloorDraft(args.draftId)) return redesigns.inspectRoom(args.draftId, args.roomId)
      const draft = getDraft(args.draftId)
      const room = draft?.rooms.find(room => room.id === args.roomId)
      if (!draft || !room) return missing('room')
      return ok({ ...aboutRoom(room, draft.site.floor), proposedDoors: draft.doors.filter(door => door.roomId === room.id || room.function === 'landing') })
    }
    for (const floor of scene.floors) {
      const room = floor.rooms.find(room => room.id === args.roomId)
      if (room) return ok(aboutRoom(room, floor))
    }
    return missing('room')
  }

  const handlers: { [N in ToolName]: (args: ToolArguments<N>) => ToolResult } = {
    find_model_variants: args => args.floorId !== null && !level(args.floorId) ? missing('floor') : ok(findModelVariants(source, args)),
    propose_model_variants: args => {
      const proposal = proposeModelVariants(source, args, id())
      if (!proposal) return toolError('model_variant_fit', 'The replacement model is unavailable, the source door has changed, or the models do not share a matching aperture. Check the installed instance and available variants.')
      published.clear()
      published.set(proposal.id, proposal)
      return ok({ draftId: proposal.id, ready: true, replaced: proposal.operations.length })
    },
    get_project_overview: () => ok({ units: scene.units, axes: scene.coordinateSystem, selectedFloorId: scene.selection.floorId,
      levels: scene.floors.map(floor => ({ id: floor.id, name: floor.name, elevation: floor.elevation, roomHeight: floor.roomHeight,
        bounds: floor.footprint.length ? bounds(floor.footprint.flat()) : null, area: area(floor.footprint.map(polygon)), stairConnections: floor.stairsFromBelow.length })) }),
    inspect_two_storey_layout: ({ floorId, upperFloorId }) => {
      const lower = level(floorId), upper = level(upperFloorId)
      if (!lower || !upper || scene.floors.filter(floor => floor.elevation > lower.elevation + .001)
        .sort((a, b) => a.elevation - b.elevation)[0]?.id !== upper.id) return toolError('layout_levels', 'Choose adjacent levels from the level summary, starting below.')
      const compact = (floor: SceneFloor) => ({
        floorId: floor.id, name: floor.name, footprint: floor.footprint,
        walls: floor.walls.filter(wall => distance(wall.start, wall.end) > .01).map(wall => ({
          id: wall.id, kind: wall.kind, fromPoint: [wall.start.x, wall.start.y], toPoint: [wall.end.x, wall.end.y], thickness: wall.thickness,
        })),
        rooms: floor.rooms.map(room => ({ name: room.name, area: room.area })),
        openings: floor.openings.map(opening => ({ id: opening.id, wallId: opening.wallId, kind: opening.kind,
          at: [opening.position.x, opening.position.y], width: opening.width })),
      })
      return ok({ lower: compact(lower), upper: compact(upper), partitionThickness: source.partitionThickness,
        stairs: upper.stairsFromBelow.filter(stair => stair.sourceFloorId === lower.id) })
    },
    compose_two_storey_layout: args => {
      const lower = level(args.lower.floorId), upper = level(args.upper.floorId)
      if (!lower || !upper) return missing('floor')
      const result = composeTwoStoreys(source, lower, upper, args, id())
      if (!result.value) return toolError('coordinated_fit', result.error)
      const { proposal } = result.value
      published.clear()
      published.set(proposal.id, proposal)
      return ok({ draftId: proposal.id, ready: true, rooms: proposal.rooms.length + args.upper.rooms.length, staircase: proposal.stairId ? 'retained' : 'new' })
    },
    get_floor_layout: ({ floorId, draftId }) => {
      if (draftId && redesigns.isFloorDraft(draftId)) return redesigns.layout(draftId, floorId)
      const floor = level(floorId), draft = draftId ? getDraft(draftId) : undefined
      if (!floor || draftId && draft?.site.floor.id !== floor.id) return missing('floor or draft')
      if (draft) return ok({ id: floor.id, units: 'metres', draftId, workspace: draft.site.workspace.polygon, walls: draft.walls,
        doors: draft.doors, rooms: draft.rooms.map(room => aboutRoom(room, floor)), stair: draft.site.stair })
      const door = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
      const excludedSide = exclusionFor(floorId)
      return ok({ id: floor.id, name: floor.name, units: 'metres', footprint: floor.footprint, walls: floor.walls, rooms: floor.rooms.map(room => aboutRoom(room, floor)),
        partitionThickness: source.partitionThickness, roomHeight: floor.roomHeight, doorWidth: door?.openingWidth ?? door?.width,
        excludedWindowWallIds: excludedSide ? excludedFacadeWalls(floor, excludedSide) : undefined,
        stairs: floor.stairsFromBelow, openings: floor.openings, selectedWallIds: scene.selection.wallIds, selectedRoomId: floor.rooms.find(room => room.signature === scene.selection.roomSignature)?.id,
        connections: openingConnections(source.floors.find(item => item.id === floorId)!.walls, floor.rooms),
        constraints: scene.constraints })
    },
    get_room_details: inspectRoom,
    get_wall_details: ({ wallId, draftId }) => {
      if (draftId) {
        if (redesigns.isFloorDraft(draftId)) return redesigns.inspectWall(draftId, wallId)
        const draft = getDraft(draftId), wall = draft?.walls.find(wall => wall.id === wallId)
        if (draft && wall) return ok({ ...wall, length: distance(wall.start, wall.end), proposed: true, doors: draft.doors.filter(door => door.wallId === wallId) })
        if (!draft) return missing('draft')
      }
      for (const floor of scene.floors) {
        const wall = floor.walls.find(item => item.id === wallId)
        if (wall) return ok({ ...wall, length: distance(wall.start, wall.end), protected: wall.kind === 'external', materialIds: source.wallMaterials?.filter(item => item.wallId === wall.id).map(item => item.materialId) ?? [],
          openings: floor.openings.filter(opening => opening.wallId === wall.id) })
      }
      return missing('wall')
    },
    measure_distance: ({ pointA, pointB }) => ok({ metres: distance(pointA, pointB) }),
    measure_area: ({ polygon: outline, roomId, draftId }) => {
      if ((outline === null) === (roomId === null)) return toolError('measurement_arguments', 'Provide a room ID or a polygon, using null for the other input.')
      if (outline) {
        const geometry = union(polygon(outline))
        return geometry.length === 1 && geometry[0].length === 1 && area(geometry) > 0 ? ok({ squareMetres: area(geometry) }) : toolError('measurement_geometry', 'Use a simple closed polygon with a nonzero area.')
      }
      const measured = inspectRoom({ roomId: roomId!, draftId })
      return measured.ok ? ok({ squareMetres: asRecord(measured.value)?.area }) : measured
    },
    get_extension_site: ({ floorId }) => {
      const floor = level(floorId), original = source.floors.find(item => item.id === floorId)
      return floor && original ? ok(inspectExtensionSite(original, floor, scene.selection)) : missing('floor')
    },
    get_constraints: ({ floorId }) => {
      const floor = level(floorId)
      if (!floor) return missing('floor')
      const site = siteFor(floor), door = source.models.find(model => model.id === ASSISTANT_DOOR_MODEL)
      return ok({ protectedWallIds: floor.walls.filter(wall => wall.kind === 'external').map(wall => wall.id), existingOpeningIds: floor.openings.map(opening => opening.id), protectedRoofIds: floor.roofIds,
        workspace: site ? { id: site.workspace.id, outline: site.workspace.polygon, usableSquareMetres: availableArea(site), stair: site.stair, exitClearance: exitClearance(site.stair) } : null,
        partitionThickness: source.partitionThickness, wallHeight: floor.roomHeight, doorWidth: door?.openingWidth ?? door?.width, doorHeight: door?.height,
        circulationWidth: ROUTE_WIDTH, requirements: 'Use begin_room_redesign for existing floors. It allows partitions and openings to change in a preview while preserving exterior wall lines, exterior doors and the stair aperture. General structural and regulatory checks require independent verification.' })
    },
    begin_design: begin,
    begin_room_redesign: args => {
      const floor = level(args.floorId)
      return floor ? redesigns.begin(floor, args, args.baseId ? seeds.get(args.baseId) : undefined) : missing('floor')
    },
    propose_staircase: args => {
      const lower = level(args.floorId), upper = level(args.upperFloorId)
      if (!lower || !upper || upper.elevation <= lower.elevation || scene.floors.some(floor =>
        floor.elevation > lower.elevation + 0.001 && floor.elevation < upper.elevation - 0.001)) {
        return toolError('stair_levels', 'Choose adjacent existing floors, starting with the lower one.')
      }
      if (published.size >= 2) return toolError('alternative_limit', 'Two options are already available.')
      const proposal = planStaircase(source, lower, upper, args, id())
      if (!proposal) return toolError('stair_fit', 'No position was found with a clear stair footprint, lower approach and upper arrival in the existing rooms.')
      published.set(proposal.id, proposal)
      return ok({ draftId: proposal.id, ready: true, staircase: proposal.operations[0] })
    },
    propose_extension: args => {
      const lower = level(args.floorId), upper = args.upperFloorId === null ? undefined : level(args.upperFloorId)
      if (!lower || args.upperFloorId !== null && !upper) return missing('floor')
      if (published.size >= 2) return toolError('alternative_limit', 'Two options are already available.')
      const result = planExtension(source, lower, upper, args, id())
      if (!result.proposal) return toolError('extension_fit', result.error)
      const { proposal } = result
      published.set(proposal.id, proposal)
      return ok({ draftId: proposal.id, ready: true, addedArea: proposal.metrics.usableArea })
    },
    compose_floor_layout: args => {
      const floor = level(args.floorId)
      if (!floor) return missing('floor')
      if (published.size >= 2) return toolError('alternative_limit', 'Two options are already available.')
      const result = redesigns.compose(floor, args)
      if (!result.proposal) return toolError('layout_needs_revision', result.error ?? 'The layout could not be validated.')
      const { proposal } = result
      const narrative = { title: args.title, explanation: args.explanation,
        advantages: args.design?.advantages ?? [], compromises: args.design?.compromises ?? [] }
      published.set(proposal.id, { ...proposal, narrative, tradeoff: narrative.explanation })
      return ok({ draftId: proposal.id, ready: true, metrics: proposal.metrics })
    },
    reuse_existing_rooms: args => {
      const floor = level(args.floorId)
      if (!floor) return missing('floor')
      if (published.size >= 2) return toolError('alternative_limit', 'Two options are already available.')
      const proposal = redesigns.reuseExistingRooms(floor, args)
      if (!proposal) return toolError('existing_rooms', 'The existing rooms do not fit this brief through doorway changes alone.')
      if ([...published.values()].some(existing => !describesDifference(existing, proposal))) {
        return toolError('similar_alternative', 'This arrangement is already available to preview.')
      }
      const doorsAdded = proposal.operations.filter(op => op.type === 'create-doorway').length
      const openingsClosed = proposal.operations.filter(op => op.type === 'remove-opening').length
      const title = `${args.bedrooms} bedrooms and ${args.ensuites} en ${args.ensuites === 1 ? 'suite' : 'suites'}`
      const endpoints = (count: number) => `${count} interior ${count === 1 ? 'doorway' : 'doorways'}`
      const changes = [doorsAdded ? `adds ${endpoints(doorsAdded)}` : '', openingsClosed ? `closes ${endpoints(openingsClosed)}` : ''].filter(Boolean)
      const edits = changes.length
        ? `The draft ${changes.join(' and ')} so each en suite has private access.`
        : 'The existing doors already provide private access to each en suite.'
      const explanation = `Reuses the existing rooms and landing. ${edits}`
      const narrative = { title, explanation, advantages: ['Keeps the existing room sizes and exterior openings.'], compromises: [] }
      seeds.set(proposal.id, proposal)
      published.set(proposal.id, { ...proposal, narrative, tradeoff: explanation })
      return ok({ draftId: proposal.id, title, explanation, metrics: proposal.metrics })
    },
    create_partition_wall: ({ draftId, walls }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.addWalls({ draftId, walls })
      const draft = getDraft(draftId)
      return draft ? editWalls(draft, [...draft.walls, ...walls.map(({ start, end }): Partition => ({ type: 'create-partition', id: id(), start, end, thickness: source.partitionThickness, height: draft.site.floor.roomHeight }))]) : missing('draft')
    },
    edit_floor_partitions: args => redesigns.isFloorDraft(args.draftId) ? redesigns.editPartitions(args) : missing('floor redesign'),
    move_partition_wall: ({ draftId, wallId, start, end }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.moveWall({ draftId, wallId, start, end })
      const draft = getDraft(draftId), wall = draft?.walls.find(wall => wall.id === wallId)
      return draft && wall ? editWalls(draft, movedPartitions(draft, wall, start, end)) : toolError('protected_or_missing_wall', 'Only proposed walls in the named draft can move. Existing walls are protected.')
    },
    remove_proposed_wall: ({ draftId, wallId }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.removeWall({ draftId, wallId }, true)
      const draft = getDraft(draftId)
      return draft?.walls.some(wall => wall.id === wallId) ? editWalls(draft, draft.walls.filter(wall => wall.id !== wallId), draft.doors.filter(door => door.wallId !== wallId)) : toolError('protected_or_missing_wall', 'Only proposed walls in the named draft can be removed. Existing walls are protected.')
    },
    remove_internal_partition: args => redesigns.isFloorDraft(args.draftId) ? redesigns.removeWall(args, false) : missing('floor redesign'),
    remove_opening: args => redesigns.isFloorDraft(args.draftId) ? redesigns.removeOpening(args) : missing('floor redesign'),
    insert_windows: args => redesigns.isFloorDraft(args.draftId) ? redesigns.insertWindows(args) : missing('floor redesign'),
    insert_exterior_doors: args => redesigns.isFloorDraft(args.draftId) ? redesigns.insertExteriorDoors(args) : missing('floor redesign'),
    insert_internal_door: ({ draftId, doors }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.editDoor({ draftId, doors })
      const draft = getDraft(draftId)
      if (!draft) return missing('draft')
      if (draft.doors.length + doors.length > 6) return toolError('door_limit', 'This draft can hold up to six proposed doors.')
      return editDoors(draft, doors.map(door => ({ ...door, id: id() })), draft.doors)
    },
    move_proposed_door: ({ draftId, doorId, ...position }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.editDoor({ draftId, doors: [position] }, doorId)
      const draft = getDraft(draftId)
      return draft?.doors.some(door => door.id === doorId) ? editDoors(draft, [{ ...position, id: doorId }], draft.doors.filter(door => door.id !== doorId)) : missing('proposed door')
    },
    set_room_function: ({ draftId, rooms }) => redesigns.isFloorDraft(draftId) ? toolError('redesign_schedule', 'Use set_room_schedule to assign linked room uses in a floor redesign.') : assignRooms(draftId, rooms),
    set_room_name: args => redesigns.isFloorDraft(args.draftId) ? redesigns.nameRooms(args) : assignRooms(args.draftId, args.rooms),
    set_room_schedule: args => redesigns.isFloorDraft(args.draftId) ? redesigns.setSchedule(args) : missing('floor redesign'),
    evaluate_layout: ({ draftId }) => {
      if (redesigns.isFloorDraft(draftId)) return redesigns.evaluate(draftId)
      const draft = getDraft(draftId)
      if (!draft) return missing('draft')
      if (draft.cached?.version !== draft.changes) {
        if (draft.evaluations >= maxEvaluations) return toolError('revision_limit', 'This draft reached its revision limit. Use another validated draft or explain the remaining limitations.')
        draft.evaluations++
        draft.cached = { version: draft.changes, evaluation: evaluateDraft(source, draft) }
      }
      const { findings, rooms, proposal } = draft.cached.evaluation
      return ok({ valid: !!proposal, findings, rooms, metrics: proposal?.metrics, warnings: proposal?.warnings, doors: draft.doors })
    },
    request_layout_candidates: ({ floorId, requirements }) => {
      if (exclusionFor(floorId)) return toolError('redesign_scope', 'Use begin_room_redesign to enforce the window-free facade.')
      if (!level(floorId)) return missing('floor')
      if (!validRequirements(requirements)) return toolError('room_schedule', 'Provide a supported room schedule.')
      const { proposals, message } = planLayout(source, { ...scene, selection: { ...scene.selection, floorId } }, 'current', requirements)
      proposals.filter(proposal => proposal.floorId === floorId).forEach(proposal => seeds.set(proposal.id, proposal))
      return ok({ message, options: proposals.filter(proposal => proposal.floorId === floorId).map(proposal => ({ id: proposal.id, rooms: proposal.rooms.map(room => aboutRoom(room, level(floorId)!)), priority: proposal.priority,
        metrics: proposal.metrics, walls: proposal.operations.filter(op => op.type === 'create-partition'), doors: proposal.operations.filter(op => op.type === 'create-doorway') })) })
    },
    publish_design: ({ draftId, ...narrative }) => {
      const draft = getDraft(draftId)
      const isRedesign = redesigns.isFloorDraft(draftId)
      if (isRedesign && !redesigns.proposal(draftId)) {
        const checked = redesigns.evaluate(draftId)
        if (!checked.ok) return checked
        const value = checked.value as { valid: boolean; findings: string[] }
        if (!value.valid) return toolError('unvalidated_design', value.findings.join(' '))
      }
      const proposal = isRedesign ? redesigns.proposal(draftId) :
        draft ? draft.cached?.version === draft.changes ? draft.cached.evaluation.proposal : null : seeds.get(draftId)
      if (!proposal) return toolError('unvalidated_design', 'Evaluate the current design and resolve every hard finding before presenting it.')
      const excludedSide = exclusionFor(proposal.floorId)
      if (excludedSide && proposal.windowExclusion !== excludedSide) return toolError('redesign_scope', 'Revise the proposal to enforce the window-free facade before publishing.')
      if (!published.has(draftId) && published.size >= 2) return toolError('alternative_limit', 'Two distinct options have already been prepared.')
      const different = checkCandidate(() => [...published.entries()].every(([key, existing]) => key === draftId || describesDifference(existing, proposal)))
      if (!different) return toolError('similar_alternative', 'This draft is too similar to the published alternative. Change the layout meaningfully or present one option.')
      published.set(draftId, { ...proposal, narrative, tradeoff: narrative.explanation })
      return ok({ draftId, ready: true, metrics: proposal.metrics })
    },
  }

  function assignRooms(draftId: string, assignments: Array<{ roomId: string; function?: DraftRoom['function']; name?: string }>) {
    const draft = getDraft(draftId)
    if (!draft || assignments.some(item => !draft.rooms.some(room => room.id === item.roomId))) return missing('draft room')
    const changes = new Map(assignments.map(({ roomId, ...update }) => [roomId, update]))
    save({ ...draft, rooms: draft.rooms.map(room => ({ ...room, ...changes.get(room.id) })) })
    return ok({ rooms: assignments })
  }

  const targetShell = previous?.redesign?.home ? level(previous.floorId) : activeFloor
  const openFloor = targetShell && isOpenFloor(targetShell) ? {
    floorId: targetShell.id, area: targetShell.rooms[0].area, partitionThickness: source.partitionThickness,
    walls: targetShell.walls.map(wall => ({ start: [wall.start.x, wall.start.y], end: [wall.end.x, wall.end.y], thickness: wall.thickness })),
    openings: targetShell.openings.map(opening => ({ at: [opening.position.x, opening.position.y], width: opening.width, kind: opening.kind })),
    doorWidths: Object.fromEntries(Object.entries(ASSISTANT_EXTERIOR_DOOR_MODELS).flatMap(([kind, id]) => {
      const model = source.models.find(item => item.id === id)
      return model ? [[kind, model.openingWidth ?? model.width]] : []
    })),
  } : undefined
  const revisingShell = !!previous?.redesign?.home && previous.floorId === openFloor?.floorId
  return {
    context: { units: scene.units, selection: { floorId: scene.selection.floorId }, windowExclusion: exclusionFor(openFloor?.floorId ?? scene.selection.floorId),
      revisingAppliedLayout, openFloor, levels: scene.floors.map(floor => ({
      id: floor.id, name: floor.name, elevation: floor.elevation, roomCount: floor.rooms.length, stairArrivals: floor.stairsFromBelow.length,
      bedroomCount: floor.rooms.filter(room => room.function === 'bedroom').length,
    })),
      activeProposal: previous ? { id: previous.id, floorId: previous.floorId, method: previous.method, redesign: previous.redesign, windowExclusion: previous.windowExclusion,
        title: previous.narrative?.title, requirements: previous.requirements, priority: previous.priority,
        metrics: previous.metrics,
        partitions: revisingShell ? previous.operations.flatMap(op => op.type === 'create-partition' ?
          [{ start: [op.start.x, op.start.y], end: [op.end.x, op.end.y] }] : []) : undefined,
        exteriorDoors: revisingShell ? previous.operations.flatMap(op => op.type === 'create-doorway' && op.exterior ?
          [{ kind: op.exterior, at: [op.position.x, op.position.y] }] : []) : undefined,
        staircase: previous.method === 'stair-placement' ? previous.operations.find(op => op.type === 'add-stair') : undefined,
        extension: previous.method === 'extension' ? previous.operations.find(op => op.type === 'add-extension' || op.type === 'extend-above') : undefined,
        modelVariants: previous.method === 'model-variants' ? previous.operations : undefined,
        coordinated: previous.coordinated,
        rooms: previous.rooms.map(room => ({ id: room.id, name: room.name, area: room.area,
          at: revisingShell ? [room.labelPoint.x, room.labelPoint.y] : undefined })) } : null },
    execute<N extends ToolName>(name: N, args: unknown): ToolResult {
      if (!validToolArguments(name, args)) return toolError('invalid_arguments', 'Check the tool schema, required fields and units before calling it again.')
      return checkCandidate(() => handlers[name](args)) ?? toolError('geometry_precision', 'The geometry engine could not verify that operation. Try a slightly different partition or doorway position.')
    },
    proposals: () => [...published.values()],
  }
}
