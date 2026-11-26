import { buildCeilingSlabFootprints } from '../ceilingSlabFootprint.ts'
import type { FloorLevel, Point, Wall } from '../types.ts'
import { buildWallTopology } from '../wallTopology.ts'
import { validToolArguments, type ToolArguments } from './architecturalTools.ts'
import type { CompassDirection, DimensionedExtension } from './extensionBrief.ts'
import { roomLabelPoint, wallsCrossOrOverlap } from './layoutValidation.ts'
import { area, checkCandidate, difference, distance, intersection, pointInPolygon, points, polygon, projection, union } from './planGeometry.ts'
import { materializeProposalFloors, type DesignProposal, type Doorway, type ExtensionBasis, type FloorChanges, type FloorEdits, type NewExtension, type PlanningResult, type UpperExtension } from './proposal.ts'
import { createRedesignExteriorDoor, findRedesignDoor, openingConnections, rebuildRedesign } from './roomRedesign.ts'
import { ASSISTANT_EXTERIOR_DOOR_MODELS, captureArchitecturalScene, stairsEnteringFloor, type SceneFloor, type SceneSnapshot, type SceneSource } from './scene.ts'

type ExtensionBrief = ToolArguments<'propose_extension'>
type Facade = { wallIds: string[]; start: Point; end: Point; outward: Point; thickness: number }
const JOIN_TOLERANCE = 0.035
const compass: Record<CompassDirection, Point> = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
}
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const delta = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y })
const offset = (p: Point, v: Point, metres: number) => ({ x: p.x + v.x * metres, y: p.y + v.y * metres })
const fail = (error: string) => ({ error, value: undefined })

function facadeWalls(floor: FloorLevel, scene: SceneFloor, snapped = false): Facade[] {
  const inside = (point: Point) => scene.rooms.some(room => pointInPolygon(point, room.polygon))
  const walls = snapped ? scene.walls : floor.walls
  return walls.flatMap(wall => {
    const length = distance(wall.start, wall.end)
    if (wall.kind !== 'external' || length < 0.2) return []
    const direction = delta(wall.end, wall.start)
    const normal = { x: -direction.y / length, y: direction.x / length }
    const sample = [0.2, 0.5, 0.8].map(fraction => offset(wall.start, direction, fraction))
    const probe = wall.thickness / 2 + 0.08
    const positive = sample.filter(p => inside(offset(p, normal, probe))).length
    const negative = sample.filter(p => inside(offset(p, normal, -probe))).length
    if (positive === negative || (positive && negative)) return []
    return [{ wallIds: [wall.id], start: wall.start, end: wall.end, thickness: wall.thickness,
      outward: positive ? { x: -normal.x, y: -normal.y } : normal }]
  })
}

function facadeRun(walls: Facade[], reference: Facade): Facade {
  const length = distance(reference.start, reference.end)
  const direction = offset({ x: 0, y: 0 }, delta(reference.end, reference.start), 1 / length)
  let start = reference.start, end = reference.end
  const wallIds = new Set(reference.wallIds)
  for (let grew = true; grew;) {
    grew = false
    for (const wall of walls) {
      if (wall.wallIds.some(id => wallIds.has(id)) || dot(wall.outward, reference.outward) < 0.999 ||
        [wall.start, wall.end].some(point => Math.abs(dot(delta(point, reference.start), reference.outward)) > JOIN_TOLERANCE)) continue
      const [first, last] = dot(delta(wall.end, wall.start), direction) > 0 ? [wall.start, wall.end] : [wall.end, wall.start]
      if (distance(first, end) <= JOIN_TOLERANCE) end = last
      else if (distance(last, start) <= JOIN_TOLERANCE) start = first
      else continue
      wall.wallIds.forEach(id => wallIds.add(id))
      grew = true
    }
  }
  return { ...reference, start, end, wallIds: [...wallIds] }
}

function facadeRuns(walls: Facade[]) {
  const offered = new Set<string>()
  return walls.flatMap(wall => {
    if (offered.has(wall.wallIds[0])) return []
    const run = facadeRun(walls, wall)
    run.wallIds.forEach(id => offered.add(id))
    return [run]
  })
}

export function inspectExtensionSite(floor: FloorLevel, scene: SceneFloor, selection: SceneSource['selection']) {
  const walls = facadeWalls(floor, scene)
  const selectedWallIds = selection.floorId === floor.id ? selection.wallIds : []
  const frontDoors = scene.openings.filter(opening => opening.modelId === ASSISTANT_EXTERIOR_DOOR_MODELS.front)
  const frontIds = [...new Set([...frontDoors.map(opening => opening.wallId), ...floor.models.flatMap(model =>
    model.modelId === ASSISTANT_EXTERIOR_DOOR_MODELS.front && model.wallAttachment ? [model.wallAttachment.wallId] : [])])]
  const front = frontIds.length === 1 ? walls.find(wall => wall.wallIds.includes(frontIds[0])) : undefined
  const directions = {
    front: front?.outward, rear: front && offset({ x: 0, y: 0 }, front.outward, -1),
    right: front && { x: front.outward.y, y: -front.outward.x },
    left: front && { x: -front.outward.y, y: front.outward.x },
  }
  const facades = facadeRuns(walls).map(run => {
    const wallId = run.wallIds.find(id => selectedWallIds.includes(id)) ?? run.wallIds[0]
    const direction = Object.entries(directions).find(([, normal]) => normal && dot(run.outward, normal) > 0.98)?.[0] ?? null
    const planDirection = Object.entries(compass).find(([, normal]) => dot(run.outward, normal) > 0.98)?.[0] ?? null
    return { wallId, start: run.start, end: run.end, outward: run.outward, direction, planDirection }
  })
  return { floorId: floor.id, frontDoorWallId: front?.wallIds[0] ?? null,
    selectedWallIds: facades.filter(facade => selectedWallIds.includes(facade.wallId)).map(facade => facade.wallId), facades,
  }
}

type OuterLine = Pick<Facade, 'start' | 'outward'>

function extensionShape(facades: Array<Pick<Facade, 'start' | 'end' | 'outward'>>, depths: number[], targets?: OuterLine[]) {
  const [first, second] = facades
  const atOuterLine = (point: Point, index: number) => {
    const target = targets?.[index]
    return target ? offset(point, target.outward, dot(delta(target.start, point), target.outward)) :
      offset(point, facades[index].outward, depths[index])
  }
  if (!second) {
    const outer = [first.start, atOuterLine(first.start, 0), atOuterLine(first.end, 0), first.end]
    return { outer, pad: polygon(outer) }
  }
  if (Math.abs(dot(first.outward, second.outward)) > 0.015) return null
  for (const [a, corner] of [[first.start, first.end], [first.end, first.start]]) {
    for (const [joint, b] of [[second.start, second.end], [second.end, second.start]]) {
      if (distance(corner, joint) > JOIN_TOLERANCE) continue
      // Both wall runs must lead into the existing house from the shared corner.
      if (dot(delta(a, corner), second.outward) >= 0 || dot(delta(b, joint), first.outward) >= 0) continue
      let extensionCorner = offset(offset(corner, first.outward, depths[0]), second.outward, depths[1])
      if (targets?.length === 2) {
        const tangent = { x: -targets[0].outward.y, y: targets[0].outward.x }
        const crossing = dot(tangent, targets[1].outward)
        if (Math.abs(crossing) < 0.98) return null
        extensionCorner = offset(targets[0].start, tangent, dot(delta(targets[1].start, targets[0].start), targets[1].outward) / crossing)
      }
      const outer = [a, atOuterLine(a, 0), extensionCorner, atOuterLine(b, 1), b]
      return { outer, pad: polygon([...outer, joint, corner]) }
    }
  }
  return null
}

function buildExtensionFloor(source: SceneSource, original: FloorLevel, scene: SceneFloor, facades: Facade[],
  shape: NonNullable<ReturnType<typeof extensionShape>>, id: string, groundLevel: boolean) {
  const { outer, pad } = shape
  if (area(intersection(pad, scene.rooms.map(room => polygon(room.polygon)))) > 0.03) {
    return fail(`The proposed addition overlaps enclosed space on ${scene.name}.`)
  }

  const retainedFacadeIds = new Set(facades.flatMap(facade => facade.wallIds))
  const retained = original.walls.filter(wall => retainedFacadeIds.has(wall.id)).map(wall => ({ ...wall, kind: 'internal' as const }))
  const existing = original.walls.map(wall => retained.find(item => item.id === wall.id) ?? wall)
  const additions = outer.slice(1).map((end, index): Wall => ({
    id: `${id}-wall-${index}`, kind: 'external', start: outer[index], end,
    height: original.roomHeight, thickness: facades[index < 2 ? 0 : facades.length - 1].thickness,
  }))
  const occupiedIds = new Set(original.walls.map(wall => wall.id).concat(original.models.map(model => model.id), original.rooms.map(room => room.id)))
  if (additions.some(wall => occupiedIds.has(wall.id) || scene.walls.some(other => wallsCrossOrOverlap(wall, other)))) {
    return fail(`A proposed exterior wall conflicts with an existing wall on ${scene.name}.`)
  }
  const walls = [...existing, ...additions]
  const slabs = buildCeilingSlabFootprints(walls).map(polygon)
  const oldSlabs = buildCeilingSlabFootprints(original.walls).map(polygon)
  const newSlab = difference(slabs, oldSlabs)
  const floorFootprints = union(scene.footprint.map(polygon), newSlab).map(shape => points(shape[0]))
  if (!coversSlab(slabs, pad) || !coversSlab(floorFootprints.map(polygon), pad)) {
    return fail(`The proposed walls did not enclose the new slab on ${scene.name}.`)
  }

  const extended = { ...original, walls, floorFootprints }
  const topology = buildWallTopology(walls, { floorFootprints })
  const rooms = topology.rooms.map(room => {
    const anchor = roomLabelPoint(room.polygon)
    const prior = scene.rooms.find(item => item.signature === room.signature) ??
      scene.rooms.find(item => pointInPolygon(anchor, item.polygon) && area(intersection(polygon(item.polygon), polygon(room.polygon))) >= item.area * 0.9)
    return { ...room, anchor, id: prior?.id ?? `${id}-room-${room.id}`, name: prior?.name ?? null, function: prior?.function }
  })
  const padOutline = pad[0].map(([x, y]) => ({ x, y }))
  const expansion = rooms.filter(room => pointInPolygon(room.anchor, padOutline))
  if (expansion.length !== 1 || expansion[0].area < 0.5 || scene.rooms.some(prior => !rooms.some(room => room.id === prior.id))) {
    return fail(`The proposed walls did not enclose a separate connected extension while retaining the original rooms on ${scene.name}.`)
  }
  const addition = expansion[0]
  const doorWalls = retained.map(wall => topology.renderedWallsById.get(wall.id)?.wall ?? wall)
  const connected = openingConnections(doorWalls, rooms).some(link => link.from && link.to && (link.from === addition.id || link.to === addition.id))
  const nextSource = { ...source, floors: source.floors.map(floor => floor.id === original.id ? extended : floor) }
  const nextScene = { ...scene, footprint: floorFootprints }
  const doors: Doorway[] = []
  if (!connected) {
    const doorId = `${id}-door`
    if (occupiedIds.has(doorId)) return fail('An extension identifier already exists in this design.')
    const possible = rooms.filter(room => room !== addition).sort((a, b) =>
      Number(b.function === 'landing') - Number(a.function === 'landing') || b.area - a.area)
    for (const room of possible) {
      const door = findRedesignDoor(source, scene, walls, rooms, room, addition, () => doorId)
      if (door && retainedFacadeIds.has(door.wallId)) { doors.push(door); break }
    }
    if (!doors.length) return fail(`There is no clear doorway from the existing rooms to the addition on ${scene.name}.`)
  }
  const exteriorIds = new Set(facadeWalls(original, scene).flatMap(facade => facade.wallIds))
  const entrances = groundLevel ? scene.openings.filter(opening => exteriorIds.has(opening.wallId) &&
    opening.bottom <= 0.05 && opening.height >= 1.75 && opening.width >= 0.6 && opening.kind !== 'window') : []
  const coveredEntrances = entrances.filter(opening => retainedFacadeIds.has(opening.wallId))
  const entry = coveredEntrances.find(opening => opening.modelId === ASSISTANT_EXTERIOR_DOOR_MODELS.front) ??
    (entrances.length === coveredEntrances.length ? coveredEntrances[0] : undefined)
  let checked = doors.length ? rebuildRedesign(nextSource, nextScene, doors).value : undefined
  if (entry) {
    const kind = entry.modelId === ASSISTANT_EXTERIOR_DOOR_MODELS.patio ? 'patio' : 'front'
    const definition = source.models.find(model => model.id === ASSISTANT_EXTERIOR_DOOR_MODELS[kind])
    const newWall = additions[1 + facades.findIndex(facade => facade.wallIds.includes(entry.wallId))]
    const min = (definition?.openingWidth ?? definition?.width ?? 1) / 2 + 0.12
    const { length, offset } = projection(entry.position, newWall.start, newWall.end)
    checked = undefined
    if (length >= min * 2) {
      for (const position of [Math.max(min, Math.min(offset, length - min)), length / 2]) {
        const door = createRedesignExteriorDoor(newWall, rooms, position, kind, `${id}-entrance`, source)
        if (door) checked = rebuildRedesign(nextSource, nextScene, [...doors, door]).value
        if (checked) break
      }
    }
    if (!checked) return fail(`The extension covers an exterior entrance and a replacement could not fit on ${scene.name}.`)
  }
  if (doors.length && !checked) return fail(`The editor could not verify the doorway into the addition on ${scene.name}.`)
  if (checked) extended.walls = checked.walls
  const roomSignatures = new Map(rooms.map(room => [room.id, room.signature]))
  const roomEdits = [...original.rooms.map(room => ({ ...room, signature: roomSignatures.get(room.id) ?? room.signature })),
    { id: addition.id, signature: addition.signature, name: 'Extension' }]
  const edits: FloorChanges = { walls: extended.walls.filter(wall => !original.walls.includes(wall)), models: checked?.additions ?? [], rooms: roomEdits, floorFootprints }
  return { value: { edits, area: addition.area, slab: newSlab, footprints: floorFootprints }, error: undefined }
}

function coversSlab(slab: ReturnType<typeof polygon>[], pad: ReturnType<typeof polygon>) {
  return slab.length > 0 && area(difference(pad, slab)) < 0.035
}

function retainsStairOpenings(prior: FloorLevel, next: FloorLevel, source: SceneSource, extended: SceneSource) {
  const original = stairsEnteringFloor(prior, source), updated = stairsEnteringFloor(next, extended)
  return original.length === updated.length && original.every(stair => {
    const match = updated.find(item => item.id === stair.id)
    return match && area(difference(match.openings.map(polygon), stair.openings.map(polygon))) <= 0.015 &&
      area(difference(stair.openings.map(polygon), match.openings.map(polygon))) <= 0.015
  })
}

function verifyExtensionStairs(source: SceneSource, floorId: string, edits: FloorEdits) {
  const floors = materializeProposalFloors(source.floors, floorId, edits)
  if (!floors) return 'The extension floors are no longer available.'
  const extended = { ...source, floors }
  const changedOpening = floors.find((floor, index) => !retainsStairOpenings(source.floors[index], floor, source, extended))
  return changedOpening ? `The extension would change an existing stair opening on ${changedOpening.name}.` : undefined
}

/** Meet the outer wall lines below, allowing the original upper walls to be set back. */
function buildUpperExtension(source: SceneSource, original: FloorLevel, scene: SceneFloor, targets: OuterLine[], footprint: Point[][], id: string) {
  const runs = facadeRuns(facadeWalls(original, scene, true))
  if (targets.every(target => runs.some(facade => dot(facade.outward, target.outward) > 0.999 &&
    [facade.start, facade.end].every(point => Math.abs(dot(delta(target.start, point), target.outward)) <= JOIN_TOLERANCE)))) {
    return { ...fail(`The exterior walls on ${scene.name} already reach the requested outer lines.`), alreadyApplied: true }
  }
  const supported = footprint.map(polygon)
  const byTarget = targets.map(target => runs.flatMap(facade => {
    if (dot(facade.outward, target.outward) < 0.999) return []
    const start = dot(delta(target.start, facade.start), target.outward)
    const end = dot(delta(target.start, facade.end), target.outward)
    return start > 0.15 && end > 0.15 && Math.abs(start - end) <= JOIN_TOLERANCE ? [{ facade, depth: (start + end) / 2 }] : []
  }))
  const combinations = byTarget.length === 1 ? byTarget[0].map(run => [run]) :
    byTarget[0].flatMap(first => byTarget[1].map(second => [first, second]))
  const fits = combinations.flatMap(combination => {
    const facades = combination.map(run => run.facade)
    const shape = extensionShape(facades, combination.map(run => run.depth), targets)
    return shape && coversSlab(supported, shape.pad) &&
      area(intersection(shape.pad, scene.rooms.map(room => polygon(room.polygon)))) <= 0.03 ? [{ facades, shape }] : []
  })
  if (fits.length !== 1) return fail(fits.length
    ? `More than one set of exterior walls on ${scene.name} could join the lower extension.`
    : `I couldn't find adjoining exterior walls on ${scene.name} that enclose an addition within the footprint below.`)
  const top = buildExtensionFloor(source, original, scene, fits[0].facades, fits[0].shape, id, false)
  if (top.value && area(difference(top.value.slab, supported)) > 0.035) return fail('The new upper slab would project beyond the footprint below.')
  return top
}

function materializeExtension(source: SceneSource, lower: SceneFloor, upper: SceneFloor | undefined, op: NewExtension) {
  const brief: ExtensionBrief = { floorId: lower.id, upperFloorId: op.upperFloorId, spans: op.spans }
  if (!validToolArguments('propose_extension', brief) || !op.id || op.id.length > 120 ||
      new Set(op.spans.map(span => span.wallId)).size !== op.spans.length) return fail('Use one or two different exterior walls and a depth for each.')
  const original = source.floors.find(floor => floor.id === lower.id)
  const above = source.floors.filter(floor => floor.elevation > lower.elevation + 0.001).sort((a, b) => a.elevation - b.elevation)[0]
  const below = source.floors.filter(floor => floor.elevation < lower.elevation - 0.001).sort((a, b) => b.elevation - a.elevation)[0]
  if (!original || !lower.rooms.length || !lower.footprint.length) return fail('The lower floor needs a closed exterior footprint.')
  if (op.upperFloorId !== null && (!upper || above?.id !== op.upperFloorId || upper.id !== above.id || !upper.rooms.length || !upper.footprint.length)) {
    return fail('Choose two adjoining existing floors with closed footprints for a two-storey addition.')
  }
  const candidates = facadeWalls(original, lower)
  const facades = op.spans.flatMap(span => {
    const wall = candidates.find(item => item.wallIds.includes(span.wallId))
    return wall ? [facadeRun(candidates, wall)] : []
  })
  if (facades.length !== op.spans.length) return fail('Choose exterior walls bounding an enclosed room.')
  const depths = op.spans.map(span => span.depth)
  const shape = extensionShape(facades, depths)
  if (!shape) return fail('Choose two adjoining perpendicular façades at an outside corner for a wraparound.')
  const base = buildExtensionFloor(source, original, lower, facades, shape, `${op.id}-lower`, !below)
  if (!base.value) return base
  if (below && area(difference(base.value.slab, (below.floorFootprints ?? buildCeilingSlabFootprints(below.walls)).map(polygon))) > 0.035) {
    return fail('The new slab would extend beyond the footprint of the floor below.')
  }
  const edits: FloorEdits = base.value.edits
  const floorAreas = [{ name: lower.name, area: base.value.area }]
  if (op.upperFloorId !== null && upper && above) {
    const targets = facades.map((facade, index) => {
      const start = shape.outer[index + 1], end = shape.outer[index + 2]
      const edge = delta(end, start), length = distance(start, end)
      const normal = { x: -edge.y / length, y: edge.x / length }
      return { start, outward: offset({ x: 0, y: 0 }, normal, Math.sign(dot(normal, facade.outward))) }
    })
    const top = buildUpperExtension(source, above, upper, targets, base.value.footprints, `${op.id}-upper`)
    if (!top.value) return top
    edits.additionalFloors = [{ floorId: upper.id, edits: top.value.edits }]
    floorAreas.push({ name: upper.name, area: top.value.area })
  }
  const stairIssue = verifyExtensionStairs(source, lower.id, edits)
  if (stairIssue) return fail(stairIssue)
  return { value: { edits, floorAreas }, error: undefined }
}

function extensionProposal(source: SceneSource, floor: SceneFloor, operation: NewExtension | UpperExtension,
  title: string, explanation: string, addedArea: number, checksBelow: boolean): DesignProposal {
  return {
    version: 1, method: 'extension', id: operation.id, projectId: source.projectId, sourceRevision: source.revision,
    floorId: floor.id, floorName: floor.name, operations: [operation], rooms: [], stairId: '', workspaceSignature: 'extension',
    requirements: { bedrooms: 1, bathrooms: 1, landing: 'standard', bathroom: 'standard', primaryBedroom: 'standard', oppositeBedroom: null },
    priority: 'landing', assumptions: [], warnings: ['Concept footprint and access. Roof joining, structure and site clearances need separate review.'],
    validation: { passed: true, checks: ['Enclosed addition and slab', 'Connection to an existing room', ...(checksBelow ? ['New upper slab is within the lower footprint'] : [])] },
    narrative: { title, explanation, advantages: [], compromises: [] }, tradeoff: explanation,
    preserved: { wallIds: floor.walls.map(wall => wall.id), openingIds: floor.openings.map(opening => opening.id), stairId: '', stairOpenings: [] },
    metrics: { smallestBedroom: 0, bedroomArea: 0, bathroomArea: 0, landingArea: 0, circulationWidth: 0,
      daylitBedrooms: 0, landingDaylight: false, usableArea: addedArea },
    landingRoute: [], layoutAxis: 0,
  }
}

export function planExtension(source: SceneSource, lower: SceneFloor, upper: SceneFloor | undefined, brief: ExtensionBrief, id: string) {
  const operation: NewExtension = { type: 'add-extension', id, upperFloorId: brief.upperFloorId, spans: brief.spans }
  const result = materializeExtension(source, lower, upper, operation)
  if (!result.value) return { error: result.error, proposal: null }
  const { floorAreas } = result.value
  const title = `${upper ? 'Two-storey' : 'Single-storey'} ${brief.spans.length === 2 ? 'wraparound ' : ''}extension`
  const explanation = `The preview adds ${floorAreas.map(({ name, area }) => `${area.toFixed(1)} m² on ${name}`).join(' and ')}. Each addition connects to an existing room.`
  return { proposal: extensionProposal(source, lower, operation, title, explanation, floorAreas.reduce((sum, floor) => sum + floor.area, 0), !!upper) }
}

type ExtensionPlan = PlanningResult & { alreadyApplied?: boolean }

export function planDimensionedExtension(source: SceneSource, scene: SceneSnapshot, brief: DimensionedExtension): ExtensionPlan {
  const blocked = (message: string) => ({ proposals: [], message })
  const ordered = [...scene.floors].sort((a, b) => a.elevation - b.elevation)
  const lower = ordered.find(floor => /\b(?:ground|floor 0)\b/i.test(floor.name)) ?? ordered[0]
  const floor = source.floors.find(item => item.id === lower?.id)
  if (!lower || !floor || !lower.rooms.length) return blocked('Close the ground-floor outline so I can check the extension.')
  const upper = brief.twoStoreys ? ordered.find(floor => floor.elevation > lower.elevation + 0.001) : undefined
  if (brief.twoStoreys && !upper) return blocked('The two-storey extension needs a modelled floor above the ground floor.')
  const matching = matchingAppliedExtensions(floor, lower, brief)
  if (matching.length) {
    if (!upper) return { ...blocked('The requested ground-floor extension is already in the model.'), alreadyApplied: true }
    const selectedWall = scene.selection.floorId === lower.id ? scene.selection.wallIds.find(id => matching.some(run => run.some(wall => wall.id === id))) : undefined
    if (matching.length > 1 && !selectedWall) return blocked('Select the applied extension you want to build above.')
    return planSecondStorey(source, scene, null, selectedWall ?? matching[0][0].id)
  }
  const site = inspectExtensionSite(floor, lower, scene.selection)
  const choices = brief.spans.map(({ direction }) => {
    const candidates = site.facades.filter(facade => facade.planDirection === direction)
    const selected = candidates.filter(facade => site.selectedWallIds.includes(facade.wallId))
    return selected.length ? selected : candidates
  })
  if (choices.some(group => !group.length)) return blocked('I could not identify all the named sides on the 2D plan. Select the intended exterior walls or describe their position on the plan.')
  const depths = brief.spans.map(span => span.depth)
  const combinations = choices.length === 1 ? choices[0].map(facade => [facade]) :
    choices[0].flatMap(first => choices[1].filter(second => extensionShape([first, second], depths)).map(second => [first, second]))
  if (combinations.length !== 1) return blocked(combinations.length
    ? 'More than one wall run fits those directions. Select the exterior walls you want to extend.'
    : 'Those sides do not meet at an outside corner on the ground-floor plan. A wraparound needs two adjoining façades.')
  const spans = combinations[0].map(({ wallId }, index) => ({ wallId, depth: depths[index] }))
  const result = checkCandidate(() => planExtension(source, lower, upper, { floorId: lower.id, upperFloorId: upper?.id ?? null, spans },
    `agent-${crypto.randomUUID()}`))
  if (!result?.proposal) return blocked(result?.error ?? 'The editor could not verify the extension geometry.')
  const { proposal } = result
  return { proposals: [proposal], message: `${proposal.narrative!.title}. ${proposal.narrative!.explanation}` }
}

function appliedExtensionRuns(floor: FloorLevel) {
  // The original proposal ID is already part of its exterior wall IDs in saved projects.
  const groups = new Map<string, Wall[]>()
  for (const wall of floor.walls) {
    const match = /^(agent-[\da-f-]+)-lower-wall-[0-3]$/i.exec(wall.id)
    if (!match || wall.kind !== 'external') continue
    const group = groups.get(match[1]) ?? []
    group.push(wall)
    groups.set(match[1], group)
  }
  return [...groups].flatMap(([id, walls]) => {
    const ordered = walls.sort((a, b) => a.id.localeCompare(b.id))
    return (ordered.length === 3 || ordered.length === 4) &&
      ordered.every((wall, index) => wall.id === `${id}-lower-wall-${index}` &&
        (!index || distance(ordered[index - 1].end, wall.start) <= JOIN_TOLERANCE)) ? [ordered] : []
  })
}

function matchingAppliedExtensions(floor: FloorLevel, level: SceneFloor, brief: DimensionedExtension) {
  const exterior = facadeWalls(floor, level)
  return appliedExtensionRuns(floor).filter(run => {
    const faces = run.slice(1, -1)
    if (faces.length !== brief.spans.length) return false
    return faces.every((wall, index) => {
      const face = exterior.find(facade => facade.wallIds.includes(wall.id))
      const returnWall = index === 0 ? run[0] : run[run.length - 1]
      const depth = distance(returnWall.start, returnWall.end)
      return face && brief.spans.some(span => dot(face.outward, compass[span.direction]) > 0.98 && Math.abs(depth - span.depth) <= JOIN_TOLERANCE)
    })
  })
}

function materializeUpperExtension(source: SceneSource, lower: SceneFloor, upper: SceneFloor, op: UpperExtension) {
  const base = source.floors.find(floor => floor.id === lower.id)
  const above = source.floors.filter(floor => floor.elevation > lower.elevation + 0.001).sort((a, b) => a.elevation - b.elevation)[0]
  if (!base || above?.id !== upper.id || !upper.rooms.length || !upper.footprint.length) {
    return fail('The extension needs an enclosed floor immediately above it.')
  }
  const run = appliedExtensionRuns(base).find(group => group.some(wall => wall.id === op.baseWallId))
  const facades = facadeWalls(base, lower)
  const targets = run?.slice(1, -1).flatMap(wall => facades.find(facade => facade.wallIds.includes(wall.id)) ?? [])
  if (!run || targets?.length !== run.length - 2) return fail('I could not verify the outer walls of the applied extension.')
  const top = buildUpperExtension(source, above, upper, targets, lower.footprint, `${op.id}-upper`)
  if (!top.value) return top
  const stairIssue = verifyExtensionStairs(source, upper.id, top.value.edits)
  return stairIssue ? fail(stairIssue) : top
}

export function planSecondStorey(source: SceneSource, scene: SceneSnapshot, previous: DesignProposal | null, baseWallId?: string): ExtensionPlan {
  const blocked = (message: string) => ({ proposals: [], message })
  const floors = [...scene.floors].sort((a, b) => a.elevation - b.elevation)
  const levelAbove = (lower: SceneFloor) => floors.find(floor => floor.elevation > lower.elevation + 0.001)
  const id = `agent-${crypto.randomUUID()}`
  const pending = previous?.operations[0]
  if (previous?.method === 'extension' && pending?.type === 'add-extension') {
    if (pending.upperFloorId) return blocked('The current preview already includes both storeys.')
    const lower = floors.find(floor => floor.id === previous.floorId)
    const upper = lower && levelAbove(lower)
    if (!lower || !upper) return blocked('The two-storey extension needs an enclosed floor above it.')
    const result = checkCandidate(() => planExtension(source, lower, upper, { floorId: lower.id, upperFloorId: upper.id, spans: pending.spans }, id))
    return result?.proposal ? { proposals: [result.proposal], message: result.proposal.tradeoff } :
      blocked(result?.error ?? 'The editor could not verify the two-storey geometry.')
  }
  if (previous?.method === 'extension' && pending?.type === 'extend-above') return blocked('The current preview already shows the new upper storey.')
  const candidates = source.floors.flatMap(floor => appliedExtensionRuns(floor).map(walls => ({ floorId: floor.id, walls })))
  const remembered = candidates.find(candidate => candidate.walls.some(wall => wall.id === baseWallId))
  const selected = candidates.filter(candidate => candidate.floorId === scene.selection.floorId &&
    candidate.walls.some(wall => scene.selection.wallIds.includes(wall.id)))
  const candidate = remembered ?? (selected.length === 1 ? selected[0] : candidates.length === 1 ? candidates[0] : undefined)
  if (!candidate) return blocked(candidates.length ? 'Select an exterior wall of the extension you want to build above.'
    : 'I could not identify an applied ground-floor extension. Use the single-storey preview, or include the side and depth measurements in a new two-storey request.')
  const lower = floors.find(floor => floor.id === candidate.floorId)
  const upper = lower && levelAbove(lower)
  if (!lower || !upper) return blocked('The extension needs an enclosed floor immediately above it.')
  const operation: UpperExtension = { type: 'extend-above', id, lowerFloorId: lower.id, baseWallId: candidate.walls[0].id }
  const result = checkCandidate(() => materializeUpperExtension(source, lower, upper, operation))
  if (!result?.value) return { ...blocked(result?.error ?? 'The editor could not verify the upper extension geometry.'),
    alreadyApplied: !!result && 'alreadyApplied' in result && result.alreadyApplied === true }
  const title = candidate.walls.length === 4 ? 'Upper storey for the wraparound' : 'Upper storey for the extension'
  const explanation = `The preview adds ${result.value.area.toFixed(1)} m² on ${upper.name} within the footprint of the applied extension.`
  return { proposals: [extensionProposal(source, upper, operation, title, explanation, result.value.area, true)], message: explanation }
}

export function validateExtensionProposal(source: SceneSource, lower: SceneFloor, upper: SceneFloor | undefined, proposal: DesignProposal): FloorEdits | null {
  const operation = proposal.operations[0]
  if (!validExtensionIdentity(source, lower, proposal) || operation.type !== 'add-extension') return null
  return checkCandidate(() => materializeExtension(source, lower, upper, operation))?.value?.edits ?? null
}

export function stageExtension(source: SceneSource, { floorId, operation }: ExtensionBasis): SceneSource | null {
  if (!operation.id || operation.id.length > 120) return null
  const scene = captureArchitecturalScene(source)
  const floor = scene.floors.find(level => level.id === floorId)
  if (!floor) return null
  const edits = checkCandidate(() => {
    if (operation.type === 'add-extension') {
      return materializeExtension(source, floor, scene.floors.find(level => level.id === operation.upperFloorId), operation).value?.edits
    }
    if (operation.type === 'extend-above') {
      const lower = scene.floors.find(level => level.id === operation.lowerFloorId)
      return lower ? materializeUpperExtension(source, lower, floor, operation).value?.edits : undefined
    }
  })
  const floors = edits && materializeProposalFloors(source.floors, floorId, edits)
  return floors ? { ...source, floors } : null
}

export function validateUpperExtensionProposal(source: SceneSource, lower: SceneFloor, upper: SceneFloor, proposal: DesignProposal): FloorEdits | null {
  const operation = proposal.operations[0]
  if (!validExtensionIdentity(source, upper, proposal) || operation.type !== 'extend-above' || operation.lowerFloorId !== lower.id) return null
  return checkCandidate(() => materializeUpperExtension(source, lower, upper, operation))?.value?.edits ?? null
}

function validExtensionIdentity(source: SceneSource, floor: SceneFloor, proposal: DesignProposal) {
  const operation = proposal.operations[0]
  return proposal.version === 1 && proposal.projectId === source.projectId && proposal.sourceRevision === source.revision && proposal.floorId === floor.id &&
    proposal.operations.length === 1 && operation && 'id' in operation && operation.id === proposal.id &&
    typeof proposal.id === 'string' && proposal.id.length > 0 && proposal.id.length <= 120
}
