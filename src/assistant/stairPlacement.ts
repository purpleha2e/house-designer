import { createPlacedModel } from '../modelPlacement.ts'
import { stairDefinition } from '../stairDefinition.ts'
import { createStairDesign, validateStairDesign } from '../stairDesign.ts'
import { getStairLandingPosition } from '../stairLandings.ts'
import { getModelHorizontalBounds, getStairOpeningPolygon } from '../stairSlabOpenings.ts'
import type { ModelDefinition } from '../models/modelLibrary.ts'
import type { PlacedModel, Point } from '../types.ts'
import type { ToolArguments } from './architecturalTools.ts'
import { exitClearance } from './layoutValidation.ts'
import { area, bounds, covers, distance, edges, intersection, pointInPolygon, polygon, projection, transformedFrame } from './planGeometry.ts'
import type { DesignProposal, FloorEdits, NewStair } from './proposal.ts'
import { stairsEnteringFloor, type SceneFloor, type SceneRoom, type SceneSource } from './scene.ts'

type StairBrief = ToolArguments<'propose_staircase'>
type Shape = Pick<NewStair, 'layout' | 'turn' | 'width'>

const titles = { straight: 'Straight staircase', l: 'L-shaped staircase', u: 'U-shaped staircase' } as const
const clearanceDepth = 1

function definitionFor(id: string, rise: number, { layout, turn, width }: Shape) {
  const design = { ...createStairDesign(rise), layout, turn, width, landingDepth: width }
  return validateStairDesign(design) ? null : stairDefinition(`${id}-variety`, titles[layout], design)
}

function modelFor(operation: NewStair, definition: ModelDefinition): PlacedModel {
  return { ...createPlacedModel({ id: operation.id, modelId: definition.id, modelsById: new Map([[definition.id, definition]]), walls: [] }),
    position: operation.position, rotation: operation.rotation }
}

function footprint(model: PlacedModel, definition: ModelDefinition): Point[][] {
  if (definition.stairFootprint?.length) {
    const frame = transformedFrame(model.rotation)
    const scale = model.scale || 1
    return definition.stairFootprint.map(outline => outline.map(point => {
      const offset = frame.world({ x: point.x * scale * (model.widthScale || 1) * (model.mirrored ? -1 : 1),
        y: point.y * scale * (model.depthScale || 1) })
      return { x: offset.x + model.position.x, y: offset.y + model.position.y }
    }))
  }
  return [getStairOpeningPolygon(model.position, model.rotation, definition.width, definition.depth, model.scale,
    getModelHorizontalBounds(definition), model.widthScale, model.depthScale, model.mirrored)]
}

function landing(model: PlacedModel, definition: ModelDefinition, end: 'lower' | 'upper', width: number): Point[] {
  const edge = getStairLandingPosition(model, definition, end)
  const outside = getStairLandingPosition(model, definition, end, -1)
  const forward = { x: outside.x - edge.x, y: outside.y - edge.y }
  const at = (depth: number, side: number) => ({ x: edge.x + depth * forward.x - side * forward.y,
    y: edge.y + depth * forward.y + side * forward.x })
  const half = width / 2
  return [at(0, -half), at(clearanceDepth, -half), at(clearanceDepth, half), at(0, half)]
}

function obstacles(source: SceneSource, floor: SceneFloor) {
  const native = source.floors.find(item => item.id === floor.id)!
  const existingStairs = native.models.flatMap(model => {
    const definition = source.models.find(item => item.id === model.modelId)
    return definition?.objectType === 'stairs' ? footprint(model, definition) : []
  })
  const doorClearances = floor.openings.flatMap(opening => {
    if (opening.bottom > 0.05 || opening.width < 0.6) return []
    const wall = floor.walls.find(item => item.id === opening.wallId)
    if (!wall) return []
    const frame = transformedFrame(Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x))
    const half = opening.width / 2, depth = Math.max(opening.width / 2, .45) + wall.thickness / 2
    return [[{ x: -half, y: -depth }, { x: half, y: -depth }, { x: half, y: depth }, { x: -half, y: depth }].map(point => {
      const offset = frame.world(point)
      return { x: opening.position.x + offset.x, y: opening.position.y + offset.y }
    })]
  })
  const wallBodies = floor.walls.map(wall => {
    const frame = transformedFrame(Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x))
    const length = distance(wall.start, wall.end), half = wall.thickness / 2
    return [{ x: 0, y: -half }, { x: length, y: -half }, { x: length, y: half }, { x: 0, y: half }].map(point => {
      const offset = frame.world(point)
      return { x: wall.start.x + offset.x, y: wall.start.y + offset.y }
    })
  })
  return [...wallBodies, ...existingStairs, ...doorClearances, ...floor.stairsFromBelow.flatMap(stair => [...stair.openings, exitClearance(stair)])].map(polygon)
}

const stairRooms = (floor: SceneFloor): SceneRoom[] => floor.rooms.length || floor.walls.length ? floor.rooms :
  floor.footprint.map((outline, index) => ({ id: `${floor.id}:${index}`, polygon: outline, name: null, signature: '', area: area([polygon(outline)]) }))

function nextFloor(source: SceneSource, elevation: number) {
  return source.floors.filter(floor => floor.elevation > elevation + 0.001).sort((a, b) => a.elevation - b.elevation)[0]
}

function checkPlacement(source: SceneSource, lower: SceneFloor, upper: SceneFloor, operation: NewStair, definition: ModelDefinition,
  lowerObstacles = obstacles(source, lower), upperObstacles = obstacles(source, upper)) {
  return checkStairFit(source, lower, upper, modelFor(operation, definition), definition, operation.width, lowerObstacles, upperObstacles, 0.001)
}

export function checkStairFit(source: SceneSource, lower: SceneFloor, upper: SceneFloor, model: PlacedModel, definition: ModelDefinition, width: number,
  lowerObstacles = obstacles(source, lower), upperObstacles = obstacles(source, upper), riseTolerance = 0.05) {
  const placement = definition.stairDesign && model.flipped ? { ...model, rotation: model.rotation + Math.PI } : model
  const body = footprint(placement, definition)
  const lowerApproach = landing(placement, definition, 'lower', width)
  const fits = (floor: SceneFloor, room: SceneRoom, outlines: Point[][], blocked: ReturnType<typeof obstacles>) =>
    outlines.every(outline => covers(polygon(room.polygon), polygon(outline), 0.003) &&
      covers(floor.footprint.map(polygon), polygon(outline), 0.003) &&
      !blocked.some(region => area(intersection(region, polygon(outline))) > 0.003))
  const lowerRoom = stairRooms(lower).find(room => fits(lower, room, [...body, lowerApproach], lowerObstacles))
  if (!lowerRoom) return null
  const nativeUpper = source.floors.find(floor => floor.id === upper.id)!
  const draft = { ...source, models: source.models.some(item => item.id === definition.id) ? source.models : [...source.models, definition], floors: source.floors.map(floor =>
    floor.id === lower.id ? { ...floor, models: [...floor.models, model] } : floor) }
  const stair = stairsEnteringFloor(nativeUpper, draft).find(item => item.id === model.id)
  if (!stair || stair.riseMismatch > riseTolerance) return null
  const upperApproach = exitClearance(stair)
  const upperRoom = stairRooms(upper).find(room => fits(upper, room, [...stair.openings, upperApproach], upperObstacles))
  return upperRoom ? { model, lowerRoom, upperRoom, openings: stair.openings, body, lowerApproach, upperApproach } : null
}

function circulationCost(room: SceneRoom) {
  if (room.function === 'landing' || /\b(?:hall|hallway|landing|corridor|foyer)\b/i.test(room.name ?? '')) return 0
  return room.function === 'bedroom' || room.function === 'bathroom' || /\b(?:bedroom|bathroom|en suite)\b/i.test(room.name ?? '') ? 12 : 4
}

export function planStaircase(source: SceneSource, lower: SceneFloor, upper: SceneFloor, brief: StairBrief, id: string,
  accept?: (placement: NonNullable<ReturnType<typeof checkStairFit>>) => boolean): DesignProposal | null {
  if (nextFloor(source, lower.elevation)?.id !== upper.id || !stairRooms(lower).length || !stairRooms(upper).length) return null
  const width = brief.width ?? 0.9, rise = upper.elevation - lower.elevation
  const lowerBlocked = obstacles(source, lower), upperBlocked = obstacles(source, upper)
  const layouts = brief.layout === 'auto' ? ['straight', 'l', 'u'] as const : [brief.layout]
  const longest = [...lower.walls].sort((a, b) => distance(b.start, b.end) - distance(a.start, a.end))[0]
  const axis = longest ? Math.atan2(longest.end.y - longest.start.y, longest.end.x - longest.start.x) : 0
  const angles = [0, 1, 2, 3].map(turn => axis + turn * Math.PI / 2)
  const candidates: { operation: NewStair; definition: ModelDefinition; score: number }[] = []

  for (const layout of layouts) for (const turn of layout === 'straight' ? ['right'] as const : ['left', 'right'] as const) {
    const template: NewStair = { type: 'add-stair', id, upperFloorId: upper.id, position: { x: 0, y: 0 }, rotation: 0, layout, turn, width }
    const definition = definitionFor(id, rise, template)
    if (!definition) continue
    const origin = modelFor(template, definition)
    const body = footprint(origin, definition)
    const below = [...body, landing(origin, definition, 'lower', width)]
    const above = [...body, landing(origin, definition, 'upper', width)]
    const lowerSpace = bounds(below.flat()), upperSpace = bounds(above.flat())
    for (const rotation of angles) {
      const frame = transformedFrame(rotation)
      const near = brief.near ? frame.local(brief.near) : undefined
      const start = getStairLandingPosition(origin, definition, 'lower')
      const roomBounds = (floor: SceneFloor) => stairRooms(floor).map(room => ({ room, ...bounds(room.polygon.map(frame.local)) }))
      const lowerRooms = roomBounds(lower), upperRooms = roomBounds(upper)
      for (const a of lowerRooms) for (const b of upperRooms) {
        const minX = Math.max(a.minX - lowerSpace.minX, b.minX - upperSpace.minX) + .04
        const minY = Math.max(a.minY - lowerSpace.minY, b.minY - upperSpace.minY) + .04
        const maxX = Math.min(a.maxX - lowerSpace.maxX, b.maxX - upperSpace.maxX) - .04
        const maxY = Math.min(a.maxY - lowerSpace.maxY, b.maxY - upperSpace.maxY) - .04
        if (maxX < minX || maxY < minY) continue
        const samples = (minimum: number, maximum: number, preferred?: number) => new Set([
          ...[0, .25, .5, .75, 1].map(fraction => minimum + (maximum - minimum) * fraction),
          ...(preferred === undefined ? [] : [Math.max(minimum, Math.min(maximum, preferred))]),
        ])
        for (const x of samples(minX, maxX, near && near.x - start.x)) for (const y of samples(minY, maxY, near && near.y - start.y)) {
          const inside = (outlines: Point[][], room: SceneRoom) => outlines.every(outline =>
            outline.every(point => pointInPolygon(frame.world({ x: point.x + x, y: point.y + y }), room.polygon)))
          if (!inside(below, a.room) || !inside(above, b.room)) continue
          const position = frame.world({ x, y })
          const wallDistance = Math.min(...below.flatMap(outline => outline.map(point => {
            const world = frame.world({ x: point.x + x, y: point.y + y })
            return Math.min(...edges(a.room.polygon).map(([from, to]) => projection(world, from, to).gap))
          })))
          const score = circulationCost(a.room) + circulationCost(b.room) * 1.5 + wallDistance +
            (near ? 6 * distance(near, { x: x + start.x, y: y + start.y }) : 0) +
            (layout === 'straight' ? 0 : layout === 'l' ? 0.4 : 0.8)
          candidates.push({ operation: { ...template, position, rotation }, definition, score })
        }
      }
    }
  }

  for (const { operation, definition } of candidates.sort((a, b) => a.score - b.score).slice(0, 160)) {
    const checked = checkPlacement(source, lower, upper, operation, definition, lowerBlocked, upperBlocked)
    if (!checked || accept && !accept(checked)) continue
    const explanation = `Connects ${checked.lowerRoom.name ?? lower.name} to ${checked.upperRoom.name ?? upper.name} with a ${width.toFixed(2)} m wide stair sized for the ${rise.toFixed(2)} m floor-to-floor rise.`
    const distanceFromPreference = brief.near ? distance(brief.near, getStairLandingPosition(checked.model, definition, 'lower')) : 0
    return {
      version: 1, method: 'stair-placement', id, projectId: source.projectId, sourceRevision: source.revision,
      floorId: lower.id, floorName: lower.name, operations: [operation], rooms: [], stairId: '', workspaceSignature: 'stair-placement',
      requirements: { bedrooms: 1, bathrooms: 1, landing: 'standard', bathroom: 'standard', primaryBedroom: 'standard', oppositeBedroom: null },
      priority: 'landing', assumptions: [], warnings: ['Concept staircase. Check structural support, headroom and guarding before construction.',
        ...(distanceFromPreference > 1.5 ? [`The lower approach is ${distanceFromPreference.toFixed(1)} m from the preferred point.`] : [])],
      validation: { passed: true, checks: ['Fits the floor-to-floor rise', 'Clear approaches and upper floor opening checked'] },
      narrative: { title: titles[operation.layout], explanation, advantages: [], compromises: [] }, tradeoff: explanation,
      preserved: { wallIds: lower.walls.map(wall => wall.id), openingIds: lower.openings.map(opening => opening.id), stairId: '', stairOpenings: [] },
      metrics: { smallestBedroom: 0, bedroomArea: 0, bathroomArea: 0, landingArea: 0, circulationWidth: width,
        daylitBedrooms: 0, landingDaylight: false, usableArea: checked.lowerRoom.area },
      landingRoute: [], layoutAxis: operation.rotation,
    }
  }
  return null
}

export function validateStairProposal(source: SceneSource, lower: SceneFloor, proposal: DesignProposal, upper: SceneFloor | undefined): FloorEdits | null {
  const operation = proposal.operations[0]
  if (proposal.version !== 1 || proposal.projectId !== source.projectId || proposal.sourceRevision !== source.revision || proposal.floorId !== lower.id ||
    proposal.operations.length !== 1 || operation?.type !== 'add-stair' || !upper || upper.id !== operation.upperFloorId ||
    nextFloor(source, lower.elevation)?.id !== upper.id || typeof operation.id !== 'string' || !operation.id ||
    source.models.some(model => model.id === `${operation.id}-variety`) || source.floors.some(floor => floor.models.some(model => model.id === operation.id)) ||
    !['straight', 'l', 'u'].includes(operation.layout) || !['left', 'right'].includes(operation.turn) ||
    ![operation.position?.x, operation.position?.y, operation.rotation, operation.width].every(Number.isFinite) ||
    operation.width < .8 || operation.width > 1.5) return null
  const definition = definitionFor(operation.id, upper.elevation - lower.elevation, operation)
  const checked = definition && checkPlacement(source, lower, upper, operation, definition)
  return definition && checked ? { walls: [], rooms: source.floors.find(floor => floor.id === lower.id)!.rooms, models: [checked.model],
    stair: { definition, upperFloorId: upper.id, openings: checked.openings } } : null
}
