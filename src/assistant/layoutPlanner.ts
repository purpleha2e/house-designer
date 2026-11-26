import type { Polygon } from 'polygon-clipping'
import { getWallAngle } from '../modelPlacement.ts'
import type { Point } from '../types.ts'
import type { LayoutPriority, Requirements, RoomFunction } from './intent.ts'
import { exitClearance, findLandingRoute, getRoomWindows, matchNativeRooms, minimumRoomArea, nativeDoor, partitionCutsOpening, roomLabelPoint, ROUTE_WIDTH, spanAt, validateAndMaterialize, validatePartitions } from './layoutValidation.ts'
import { area, bounds, checkCandidate, covers, difference, distance, edges, EPSILON, intersection, pointInPolygon, points, polygon, projection, rectangle, transformedFrame } from './planGeometry.ts'
import type { DesignProposal, Doorway, Partition, PlanningResult, ProposedRoom } from './proposal.ts'
import type { SceneFloor, SceneRoom, SceneSnapshot, SceneSource, SceneStair } from './scene.ts'

type RoomBrief = { id: string; name: string; function: RoomFunction }
type Side = { rooms: RoomBrief[]; cuts: number[]; min: number; max: number }
type DraftRoom = RoomBrief & { outline: Point[]; side?: -1 | 1 }
type Draft = { angle: number; lower: number; upper: number; sides: [Side, Side]; rooms: DraftRoom[]; score: number[]; key: string }
export type RevisionGuidance = { previous: DesignProposal; largerBathroom: boolean; largerPrimary: boolean; keepLanding: boolean; moveBedroom?: boolean }

function targetFloor(source: SceneSnapshot, floor: 'current' | 'upstairs') {
  const levels = [...source.floors].sort((a, b) => a.elevation - b.elevation)
  if (!levels.length) return undefined
  const selected = levels.find(level => level.id === source.selection.floorId)
  if (selected && selected.elevation > levels[0].elevation + 0.001) return selected
  if (floor === 'current') return undefined
  return levels.find(level => level.elevation > levels[0].elevation + 0.001)
}

function roomBriefs(requirements: Requirements): RoomBrief[] {
  return [...Array.from({ length: requirements.bedrooms }, (_, index): RoomBrief => ({
    id: `bedroom-${index + 1}`, name: `Bedroom ${index + 1}`, function: 'bedroom',
  })), { id: 'bathroom', name: 'Bathroom', function: 'bathroom' }]
}

function candidateOrders(rooms: RoomBrief[], moved: number | null) {
  const bedrooms = rooms.filter(room => room.function === 'bedroom')
  const bathroom = rooms.find(room => room.function === 'bathroom')!
  const orderings = [bedrooms, bedrooms.toReversed()]
  if (moved) {
    const bedroom = bedrooms[moved - 1]
    const rest = bedrooms.filter(room => room !== bedroom)
    orderings.push([bedroom, ...rest], [...rest, bedroom])
  }
  return orderings.flatMap(order => Array.from({ length: order.length + 1 }, (_, index) =>
    [...order.slice(0, index), bathroom, ...order.slice(index)]))
}

function localPolygon(shape: Polygon, minX: number, minY: number, maxX: number, maxY: number) {
  if (maxX - minX < 0.1 || maxY - minY < 0.1) return null
  const clipped = checkCandidate(() => intersection(shape, rectangle(minX, minY, maxX, maxY)))
  return clipped?.length === 1 && clipped[0].length === 1 ? points(clipped[0][0]) : null
}

function candidateAxes(outline: Point[], stair: SceneStair, revision?: RevisionGuidance) {
  const angle = (radians: number) => (radians % Math.PI + Math.PI) % Math.PI
  const longest = edges(outline).sort(([a, b], [c, d]) => distance(c, d) - distance(a, b))[0]
  const shell = Math.atan2(longest[1].y - longest[0].y, longest[1].x - longest[0].x)
  const flight = Math.atan2(stair.upperDirection.y, stair.upperDirection.x)
  return [...new Set([...(revision ? [revision.previous.layoutAxis] : []), ...[shell, shell + Math.PI / 2, flight, flight + Math.PI / 2].map(angle)])]
    .filter((value, index, all) => index === all.findIndex(candidate => Math.abs(Math.sin(candidate - value)) < 0.005))
}

function sideCuts(side: RoomBrief[], min: number, max: number, requirements: Requirements, bias: number, bathShare: number) {
  const weight = (room: RoomBrief) => room.function === 'bathroom' ? bathShare
    : room.id === 'bedroom-1' && requirements.primaryBedroom === 'larger' ? 1.34 : 1
  const weights = side.map(weight)
  const total = weights.reduce((sum, value) => sum + value, 0)
  return [min, ...weights.slice(0, -1).map((_, index) => min + (max - min) *
    weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / total + bias), max]
}

function clipSide(room: RoomBrief, index: number, side: Side, outline: Polygon, direction: -1 | 1): DraftRoom | null {
  const shape = localPolygon(outline, side.cuts[index], side.min, side.cuts[index + 1], side.max)
  if (!shape) return null
  const box = bounds(shape)
  const minWidth = room.function === 'bathroom' ? 1.55 : 2.05
  if (Math.min(box.maxX - box.minX, box.maxY - box.minY) < minWidth) return null
  return { ...room, outline: shape, side: direction }
}

function bandsBesideOpenings(bands: number[][], floor: SceneFloor, frame: ReturnType<typeof transformedFrame>, thickness: number) {
  const wallById = new Map(floor.walls.map(wall => [wall.id, wall]))
  const spans = floor.openings.flatMap(opening => {
    const wall = wallById.get(opening.wallId)
    if (!wall) return []
    const start = frame.local(wall.start), end = frame.local(wall.end)
    const length = distance(start, end)
    if (length < EPSILON) return []
    const across = Math.abs(end.y - start.y) / length
    if (across < EPSILON) return []
    const center = frame.local(opening.position).y
    const half = across * (opening.width / 2 + thickness / 2 + 0.05) + 0.025
    return [{ min: center - half, max: center + half }]
  })
  const lowerSpans = spans.toSorted((a, b) => b.min - a.min)
  const upperSpans = spans.toSorted((a, b) => a.max - b.max)
  return bands.flatMap(([min, max]) => {
    const low = lowerSpans.reduce((y, span) => y > span.min && y < span.max ? span.min : y, min)
    const high = upperSpans.reduce((y, span) => y > span.min && y < span.max ? span.max : y, max)
    const widenLow = low < min && min - low <= 0.75
    const widenHigh = high > max && high - max <= 0.75
    return [...(widenLow ? [[low, max]] : []), ...(widenHigh ? [[min, high]] : []), ...(widenLow && widenHigh ? [[low, high]] : [])]
  })
}

function bandsAtWallJunctions(bands: number[][], floor: SceneFloor, frame: ReturnType<typeof transformedFrame>) {
  // A cut across two staggered wall runs may only meet both centre lines at their shared offset.
  const junctions = floor.walls.flatMap(wall => [wall.start, wall.end]).map(point => frame.local(point).y).sort((a, b) => a - b)
  return bands.flatMap(([min, max]) => {
    const low = junctions.findLast(y => y < min - EPSILON && y >= min - 0.35)
    const high = junctions.find(y => y > max + EPSILON && y <= max + 0.35)
    return [...(low === undefined ? [] : [[low, max]]), ...(high === undefined ? [] : [[min, high]]),
      ...(low === undefined || high === undefined ? [] : [[low, high]])]
  })
}

function rankDrafts(workspace: SceneRoom, floor: SceneFloor, stair: SceneStair, requirements: Requirements, thickness: number, revision?: RevisionGuidance) {
  const briefs = roomBriefs(requirements)
  const orders = candidateOrders(briefs, requirements.oppositeBedroom)
  const drafts = new Map<string, Draft>()
  for (const angle of candidateAxes(workspace.polygon, stair, revision)) {
    if (revision?.keepLanding && angle !== revision.previous.layoutAxis) continue
    const frame = transformedFrame(angle)
    const outline = workspace.polygon.map(frame.local), shape = polygon(outline), box = bounds(outline)
    const aperture = stair.openings.flat().map(frame.local), hole = bounds(aperture)
    const exit = exitClearance(stair).map(frame.local), clear = bounds([...aperture, ...exit])
    const step = ROUTE_WIDTH + 0.06 + thickness / 2
    const pad = 0.025 + thickness / 2
    const lower = Math.min(clear.minY - pad, hole.minY - step)
    const upper = Math.max(clear.maxY + pad, hole.maxY + step)
    const tightLow = clear.minY - pad, tightHigh = clear.maxY + pad
    const roomy = requirements.landing === 'spacious' ? 0.42 : 0.32
    const bandOptions = [
      [lower, tightHigh], [tightLow, upper], [lower, upper], [tightLow, tightHigh],
      [lower - roomy, tightHigh + 0.12], [tightLow - 0.12, upper + roomy],
      [lower - roomy, upper + roomy], [lower, upper + roomy * 2], [lower - roomy * 2, upper],
      [tightLow - roomy, tightHigh + roomy],
    ]
    bandOptions.push(...bandsBesideOpenings(bandOptions, floor, frame, thickness))
    bandOptions.push(...bandsAtWallJunctions(bandOptions, floor, frame))
    if (revision && angle === revision.previous.layoutAxis) {
      const prior = revision.previous.rooms.find(room => room.function === 'landing')!
      const previousBox = bounds(prior.polygon.map(frame.local))
      const exact = [previousBox.minY - thickness / 2, previousBox.maxY + thickness / 2]
      if (revision.keepLanding) bandOptions.splice(0, bandOptions.length, exact)
      else bandOptions.unshift(exact)
    }
    const distinctBands = new Map(bandOptions.map(band => [band.map(value => value.toFixed(6)).join('/'), band]))
    for (const [min, max] of distinctBands.values()) {
      const low = min < box.minY + 0.1 ? box.minY - 0.01 : min
      const high = max > box.maxY - 0.1 ? box.maxY + 0.01 : max
      const landing = localPolygon(shape, box.minX - 0.1, low, box.maxX + 0.1, high)
      if (!landing) continue
      const landingShape = polygon(landing)
      const landingArea = checkCandidate(() => covers(landingShape, polygon(exit))
        ? area(difference(landingShape, ...stair.openings.map(opening => polygon(opening.map(frame.local))))) : 0)
      if (landingArea === null || landingArea < 2.6) continue
      const ranges = [[box.minY, low], [high, box.maxY]]
      const sideBounds = ranges.map(([start, end]) => {
        const side = localPolygon(shape, box.minX - 0.01, start, box.maxX + 0.01, end)
        return side ? bounds(side) : null
      })
      for (let split = 0; split <= briefs.length; split++) {
        const counts = [split, briefs.length - split]
        if (sideBounds.some((side, index) => counts[index] ? !side || side.maxY - side.minY < 1.6 : !!side && side.maxY - side.minY > 0.25)) continue
        for (const order of orders) {
          const [before, after] = [order.slice(0, split), order.slice(split)]
          if (revision?.moveBedroom && requirements.oppositeBedroom) {
            const id = `bedroom-${requirements.oppositeBedroom}`
            const previous = revision.previous.rooms.find(room => room.id.endsWith(`-${id}`))
            const formerLanding = revision.previous.rooms.find(room => room.function === 'landing')!
            if (!previous || angle !== revision.previous.layoutAxis ||
              (frame.local(previous.labelPoint).y < frame.local(formerLanding.labelPoint).y) === before.some(room => room.id === id)) continue
          }
          for (const bias of [0, -0.24, 0.24]) for (const bathShare of requirements.bathroom === 'larger' ? [0.85, 1.05, 1.25] : [0.67, 0.88]) {
            const sides = [before, after].map((rooms, index): Side => {
              const side = sideBounds[index]
              return { rooms, cuts: side ? sideCuts(rooms, side.minX, side.maxX, requirements, bias, bathShare) : [], min: ranges[index][0], max: ranges[index][1] }
            }) as [Side, Side]
            const partitions = sides.flatMap((side, index) => side.rooms.map((room, next) => clipSide(room, next, side, shape, index === 0 ? -1 : 1)))
            if (partitions.some(room => room === null)) continue
            const rooms = partitions.filter(room => room !== null)
            const areas = rooms.map(room => area([polygon(room.outline)]))
            if (rooms.some((room, index) => areas[index] < minimumRoomArea(room.function, requirements) + 0.18)) continue
            const bedrooms = rooms.flatMap((room, index) => room.function === 'bedroom' ? [areas[index]] : [])
            const bathroomArea = areas[rooms.findIndex(room => room.function === 'bathroom')]
            const primaryArea = areas[rooms.findIndex(room => room.id === 'bedroom-1')]
            if (revision?.largerBathroom && bathroomArea < revision.previous.metrics.bathroomArea + 0.45 ||
                revision?.largerPrimary && primaryArea < (revision.previous.rooms.find(room => room.name === 'Bedroom 1')?.area ?? 0) + 0.45) continue
            const bedroomArea = bedrooms.reduce((sum, value) => sum + value, 0)
            const smallest = Math.min(...bedrooms)
            const daylit = rooms.filter(room => room.function === 'bedroom' && getRoomWindows(room.outline.map(frame.world), floor).length > 0).length
            const landingDaylight = getRoomWindows(landing.map(frame.world), floor).length > 0 ? 1 : 0
            const preference = bathroomArea * (requirements.bathroom === 'larger' ? 0.45 : 0.08) + primaryArea * (requirements.primaryBedroom === 'larger' ? 0.35 : 0)
            const bedroomScore = smallest * 1.8 + bedroomArea * 0.4 + daylit * 3 + preference
            const landingScore = landingArea * 1.3 + landingDaylight * 2.5 + daylit * 2 + smallest * 0.65 + preference
            const key = [angle, low, high, ...sides.flatMap(side => side.cuts)].map(value => value.toFixed(3)).join('/') + ':' + order.map(room => room.id).join(',')
            drafts.set(key, { angle, lower: low, upper: high, sides, rooms: [...rooms,
              { id: 'landing', name: 'Landing', function: 'landing', outline: landing }], score: [bedroomScore, landingScore], key })
          }
        }
      }
    }
  }
  return [...drafts.values()]
}

function partitionEndpoints(draft: Draft, workspace: SceneRoom, floor: SceneFloor, source: SceneSource) {
  const frame = transformedFrame(draft.angle)
  const outline = workspace.polygon.map(frame.local), box = bounds(outline)
  const original = source.floors.find(level => level.id === floor.id)!
  const wallLines = floor.walls.map(wall => ({ ...wall, start: frame.local(wall.start), end: frame.local(wall.end) }))
  const segments: Array<{ axis: 'x' | 'y'; at: number; span: [number, number] }> = [draft.lower, draft.upper].flatMap(at =>
    spanAt(outline, 'y', at, box.minX - 0.01, box.maxX + 0.01).map(span => ({ axis: 'y', at, span })))
  for (const side of draft.sides) {
    for (const at of side.cuts.slice(1, -1)) {
      segments.push(...spanAt(outline, 'x', at, side.min, side.max).map(span => ({ axis: 'x' as const, at, span })))
    }
  }
  const joined = segments.map(({ axis, at, span }) => {
    const other = axis === 'x' ? 'y' : 'x'
    const endpoints = span.map((position, index) => {
      const point = axis === 'x' ? { x: at, y: position } : { x: position, y: at }
      const shellEdge = edges(outline).some(([a, b]) => projection(point, a, b).gap < 0.002)
      if (!shellEdge) return frame.world(point)
      const hits = wallLines.flatMap(host => {
        const delta = host.end[axis] - host.start[axis]
        if (Math.abs(delta) < EPSILON || projection(point, host.start, host.end).gap > host.thickness / 2 + 0.04) return []
        const fraction = (at - host.start[axis]) / delta
        if (fraction < -0.001 || fraction > 1.001) return []
        const fixed = host.start[other] + fraction * (host.end[other] - host.start[other])
        const gap = (fixed - position) * (index === 0 ? -1 : 1)
        return gap >= -0.002 && gap <= Math.max(0.45, host.thickness) ? [{ gap, fixed }] : []
      }).sort((a, b) => a.gap - b.gap)
      return hits.length ? frame.world({ ...point, [other]: hits[0].fixed }) : original.floorFootprints?.length ? frame.world(point) : null
    })
    return endpoints[0] && endpoints[1] ? { start: endpoints[0], end: endpoints[1] } : null
  })
  return joined.every(wall => wall !== null) ? joined : null
}

function buildProposal(source: SceneSource, floor: SceneFloor, workspace: SceneRoom, stair: SceneStair, requirements: Requirements,
  draft: Draft, ends: Array<{ start: Point; end: Point }>, priority: LayoutPriority, revision?: RevisionGuidance): DesignProposal | null {
  const frame = transformedFrame(draft.angle)
  // A stable geometry-specific prefix also makes repeated previews deterministic.
  const identity = `${floor.id}/${source.revision}/${draft.key}`
  const hash = [...identity].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0
  // Native opening IDs use ':' between the owning model ID and an opening suffix.
  const id = `layout-${hash.toString(36)}`
  const partitions: Partition[] = ends.map(({ start, end }, index) => ({ type: 'create-partition', id: `${id}-wall-${index + 1}`,
    start, end, thickness: source.partitionThickness, height: floor.roomHeight }))
  const geometry = validatePartitions(source, floor, workspace, stair, partitions)
  if (!geometry) return null
  const intended = draft.rooms.map(room => ({ ...room, id: `${id}-${room.id}`, polygon: room.outline.map(frame.world) }))
  const native = matchNativeRooms(geometry, intended, requirements)
  if (!native) return null
  const rooms: ProposedRoom[] = intended.map(room => {
    const detected = native.find(candidate => candidate.idInProposal === room.id)!
    const roomArea = room.function === 'landing' ? area(difference(polygon(detected.polygon), ...stair.openings.map(polygon))) : detected.area
    return { id: room.id, function: room.function, name: room.name, polygon: detected.polygon,
      labelPoint: roomLabelPoint(detected.polygon), area: roomArea, windowIds: getRoomWindows(detected.polygon, floor) }
  })
  if (rooms.some(room => room.area < minimumRoomArea(room.function, requirements))) return null
  const landing = rooms.find(room => room.function === 'landing')!, bathroom = rooms.find(room => room.function === 'bathroom')!
  const bedrooms = rooms.filter(room => room.function === 'bedroom')
  if (revision?.largerBathroom && bathroom.area < revision.previous.metrics.bathroomArea + 0.2 ||
      revision?.largerPrimary && bedrooms[0].area < (revision.previous.rooms.find(room => room.name === 'Bedroom 1')?.area ?? 0) + 0.2) return null
  if (revision?.keepLanding) {
    const previous = revision.previous.rooms.find(room => room.function === 'landing')!
    if (!covers(polygon(previous.polygon), polygon(landing.polygon), 0.05) || !covers(polygon(landing.polygon), polygon(previous.polygon), 0.05)) return null
  }
  const { definition } = geometry
  const width = definition.openingWidth ?? definition.width
  const choices = rooms.filter(room => room !== landing).map((room, roomIndex) => {
    const draftRoom = intended.find(item => item.id === room.id)!
    const level = draftRoom.side === -1 ? draft.lower : draft.upper
    return geometry.additions.flatMap(wall => {
      const start = frame.local(wall.start), end = frame.local(wall.end)
      if (Math.abs(start.y - level) > 0.003 || Math.abs(end.y - level) > 0.003) return []
      const range = bounds(draftRoom.outline)
      const min = Math.max(range.minX, Math.min(start.x, end.x)) + width / 2 + 0.1
      const max = Math.min(range.maxX, Math.max(start.x, end.x)) - width / 2 - 0.1
      if (min > max) return []
      return [0.5, 0.16, 0.84, 0, 1, 0.32, 0.68].flatMap(fraction => {
        const position = frame.world({ x: min + (max - min) * fraction, y: level })
        const side = (start.x < end.x ? -draftRoom.side! : draftRoom.side!) as -1 | 1
        const door = { type: 'create-doorway', id: `${id}-door-${roomIndex + 1}`, roomId: room.id, wallId: wall.id,
          offset: projection(position, wall.start, wall.end).offset, position, rotation: getWallAngle(wall) + (side < 0 ? Math.PI : 0),
          side, width, height: definition.height } satisfies Doorway
        return nativeDoor(door, room, landing, geometry) ? [door] : []
      })
    })
  })
  if (choices.some(group => !group.length)) return null
  const access = findLandingRoute(geometry, landing, draft.angle, allows => {
    const doors = choices.map(group => group.find(allows))
    return doors.every(door => door !== undefined) ? doors : null
  })
  if (!access) return null
  const warnings = ['Concept layout. Have headroom, structure, fire safety and building regulations checked before building.']
  if (stair.riseMismatch > 0.12) warnings.push('The stair model’s height differs from the level change. Verify where it meets the upper floor.')
  const windowless = bedrooms.filter(room => !room.windowIds.length)
  if (windowless.length) warnings.push(`${windowless.map(room => room.name).join(', ')} ${windowless.length === 1 ? 'has' : 'have'} no existing exterior window. Check daylight, ventilation and escape requirements.`)
  if (!bathroom.windowIds.length) warnings.push('The bathroom is internal. Check ventilation and drainage routes.')
  if (!landing.windowIds.length) warnings.push('The landing has no existing exterior window.')
  if (workspace.name && !/^Room \d+$/i.test(workspace.name)) warnings.push(`Applying this layout subdivides ${workspace.name} and replaces its room label.`)
  if (pointInPolygon(landing.labelPoint, landing.polygon) && stair.openings.some(opening => pointInPolygon(landing.labelPoint, opening))) {
    landing.labelPoint = roomLabelPoint(access.route[0])
  }
  const bedroomArea = bedrooms.reduce((sum, room) => sum + room.area, 0)
  const proposal: DesignProposal = {
    version: 1, id, projectId: source.projectId, sourceRevision: source.revision, floorId: floor.id, floorName: floor.name,
    workspaceSignature: workspace.signature, stairId: stair.id, requirements, priority, layoutAxis: draft.angle,
    assumptions: [`Uses one enclosed space on ${floor.name} and the existing stair.`, 'Room areas are measured to the inside faces of the walls. Landing area excludes the stair opening.'],
    rooms, operations: [...partitions, ...access.doors, ...rooms.map(room => ({ type: 'label-room' as const, roomId: room.id, name: room.name, function: room.function }))],
    validation: { passed: true, checks: ['Closed rooms inside the floor', 'Partition and opening junctions', 'Inward door swings', 'Clear route from the stair to each doorway', 'Existing wall, window and stair geometry preserved'] },
    warnings, tradeoff: priority === 'bedrooms' ? 'Gives more of the floor to bedrooms while keeping a clear route from the stair.' :
      'Gives more floor area to the landing and looks for an existing window that can light it.',
    preserved: { wallIds: floor.walls.map(wall => wall.id), openingIds: floor.openings.map(opening => opening.id), stairId: stair.id, stairOpenings: stair.openings },
    metrics: { smallestBedroom: Math.min(...bedrooms.map(room => room.area)), bedroomArea, bathroomArea: bathroom.area,
      landingArea: landing.area, circulationWidth: ROUTE_WIDTH, daylitBedrooms: bedrooms.length - windowless.length,
      landingDaylight: landing.windowIds.length > 0, usableArea: bedroomArea + bathroom.area + landing.area }, landingRoute: access.route,
  }
  return validateAndMaterialize(source, floor, proposal) ? proposal : null
}

export function planLayout(source: SceneSource, snapshot: SceneSnapshot, floorChoice: 'current' | 'upstairs', requirements: Requirements, revision?: RevisionGuidance): PlanningResult {
  const empty = (message: string): PlanningResult => ({ proposals: [], message })
  const floor = revision ? snapshot.floors.find(level => level.id === revision.previous.floorId) : targetFloor(snapshot, floorChoice)
  if (!floor) return empty('I need an upper floor with a closed outline. Create or open an upstairs floor, then ask for a layout again.')
  if (floor.stairsFromBelow.length !== 1) return empty(floor.stairsFromBelow.length ?
    `I found multiple stairs feeding ${floor.name}. Phase 1 needs a single stair opening in the area to divide.` :
    `I couldn’t find a staircase opening into ${floor.name}. Place or connect the stairs below so I can keep the upstairs exit clear.`)
  const stair = floor.stairsFromBelow[0]
  const selected = snapshot.selection.floorId === floor.id ? snapshot.selection.roomSignature : null
  const workspace = floor.rooms.find(room => room.signature === (revision?.previous.workspaceSignature ?? selected)) ??
    floor.rooms.find(room => stair.openings.every(opening => covers(polygon(room.polygon), polygon(opening), 0.018)))
  if (!workspace || !stair.openings.every(opening => covers(polygon(workspace.polygon), polygon(opening), 0.018))) {
    return empty(`I couldn’t find a single enclosed space on ${floor.name} that contains the stair opening. Select the space around the stair and check that its outline closes. Existing partitions are preserved.`)
  }
  if (floor.footprint.length !== 1 || workspace.polygon.length > 24 || source.partitionThickness < 0.05 || source.partitionThickness > 0.3) {
    return empty(`The outline on ${floor.name} exceeds the range this planner supports. Try a single, simpler enclosed footprint around the stairs.`)
  }
  const usable = area(difference(polygon(workspace.polygon), ...stair.openings.map(polygon)))
  const minimum = roomBriefs(requirements).reduce((sum, room) => sum + minimumRoomArea(room.function, requirements), 2.2)
  const compromise = requirements.bedrooms > 1 ? ` Try ${requirements.bedrooms - 1} ${requirements.bedrooms === 2 ? 'bedroom' : 'bedrooms'} or allow more floor space around the stair.` :
    ' Try allowing more floor space around the stair.'
  if (usable < minimum + 0.5) return empty(`There is ${usable.toFixed(1)} m² of usable floor space in the available enclosure on ${floor.name}. The requested rooms and landing need at least ${(minimum + 0.5).toFixed(1)} m² before testing the shape and door access.${compromise}`)

  const drafts = rankDrafts(workspace, floor, stair, requirements, source.partitionThickness, revision)
  const priorities: LayoutPriority[] = revision ? [revision.previous.priority, revision.previous.priority === 'bedrooms' ? 'landing' : 'bedrooms'] : ['bedrooms', 'landing']
  const proposals: DesignProposal[] = []
  const rejected = new Set<string>()
  for (const priority of priorities) {
    const index = priority === 'bedrooms' ? 0 : 1
    const triedShapes = new Map<string, number>()
    const sorted = drafts.toSorted((a, b) => b.score[index] - a.score[index])
    let attempts = 0
    for (const draft of sorted) {
      if (attempts >= 96) break
      if (rejected.has(draft.key) || proposals.some(proposal => proposal.layoutAxis === draft.angle &&
        Math.abs(proposal.metrics.landingArea - area([polygon(draft.rooms.at(-1)!.outline)]) +
          stair.openings.reduce((sum, opening) => sum + area([polygon(opening)]), 0)) < 0.85)) continue
      const shape = `${draft.angle}/${draft.lower.toFixed(2)}/${draft.upper.toFixed(2)}/${draft.sides[0].rooms.length}`
      const count = triedShapes.get(shape) ?? 0
      if (count >= 10) continue
      const ends = partitionEndpoints(draft, workspace, floor, source)
      if (!ends || ends.some(wall => partitionCutsOpening(floor, { ...wall, thickness: source.partitionThickness }))) {
        rejected.add(draft.key)
        continue
      }
      triedShapes.set(shape, count + 1)
      attempts++
      const proposal = checkCandidate(() => buildProposal(source, floor, workspace, stair, requirements, draft, ends, priority, revision))
      if (proposal) { proposals.push(proposal); break }
      rejected.add(draft.key)
    }
  }
  if (!proposals.length) return empty(revision ?
    'I couldn’t fit that revision while keeping the other requirements and a clear route from the stair. The previous layout is still available. Try a smaller change or give the rooms more space.' :
    `I couldn’t fit the requested layout into the ${usable.toFixed(1)} m² enclosure while keeping the stair, openings and room access clear.${compromise}`)
  const message = proposals.length === 2 ? `I found two layouts for ${floor.name}. Compare the room areas and landing in the plan before applying one.` :
    `I found one layout for ${floor.name} that fits the area and keeps access from the stair. You can preview it and ask for changes.`
  return { proposals, message }
}
