import { asRecord, type ConversationTurn } from './intent.ts'
import type { DesignProposal } from './proposal.ts'
import type { SceneSource } from './scene.ts'

export type Schema = { type: 'string'; minLength?: number; maxLength?: number; enum?: readonly string[] } |
  { type: 'number' | 'integer'; minimum: number; maximum: number } |
  { type: 'boolean' } |
  { type: 'array'; items: Schema; minItems: number; maxItems: number } |
  { type: 'object'; properties: Record<string, Schema>; required: readonly string[]; additionalProperties: false } |
  { anyOf: readonly [Schema, { type: 'null' }] }

type Value<S> = S extends { anyOf: readonly [infer A, unknown] } ? Value<A> | null :
  S extends { type: 'object'; properties: infer P; required: readonly (infer K)[] } ?
    { [Key in Extract<keyof P, K>]: Value<P[Key]> } & { [Key in Exclude<keyof P, K>]?: Value<P[Key]> } :
  S extends { type: 'array'; items: infer I } ? Value<I>[] :
  S extends { type: 'string'; enum: readonly (infer V)[] } ? V :
  S extends { type: 'string' } ? string : S extends { type: 'boolean' } ? boolean : number

const object = <P extends Record<string, Schema>, O extends keyof P = never>(properties: P, optional: readonly O[] = []) =>
  ({ type: 'object' as const, properties, required: Object.keys(properties).filter(key => !optional.some(field => field === key)) as
    Exclude<Extract<keyof P, string>, O>[], additionalProperties: false as const })
const array = <S extends Schema>(items: S, minItems: number, maxItems: number) => ({ type: 'array' as const, items, minItems, maxItems })
const string = (maxLength: number) => ({ type: 'string' as const, minLength: 1, maxLength })
const options = <const V extends string[]>(...values: V) => ({ type: 'string' as const, enum: values })
const number = (minimum: number, maximum: number) => ({ type: 'number' as const, minimum, maximum })
const nullable = <S extends Schema>(schema: S) => ({ anyOf: [schema, { type: 'null' as const }] as const })
const integer = (minimum: number, maximum: number) => ({ type: 'integer' as const, minimum, maximum })
const point = object({ x: number(-10_000, 10_000), y: number(-10_000, 10_000) })
const planPoint = array(number(-10_000, 10_000), 2, 2)
const id = string(140), draftId = id, floorId = id, wallId = id, roomId = id, doorId = id
const segment = { start: point, end: point }
const priority = options('bedrooms', 'landing')
const roomFunction = options('bedroom', 'bathroom', 'landing')
const requirements = object({ bedrooms: integer(1, 4), bathrooms: integer(1, 1), landing: options('standard', 'spacious'),
  bathroom: options('standard', 'larger'), primaryBedroom: options('standard', 'larger'), oppositeBedroom: nullable(integer(1, 4)) })
const doorPosition = { wallId, roomId, offset: number(0, 500) }
const windowPosition = object({ wallId, offset: number(0, 500), width: number(0.35, 3.5), height: number(0.35, 3), sillHeight: number(0.4, 2.5) })
const exteriorDoorKind = options('front', 'patio')
const extensionSpan = object({ wallId, depth: number(0.75, 20) })
const coordinatedFloor = object({
  floorId, walls: array(object({ start: planPoint, end: planPoint }), 0, 12),
  removeWallIds: array(wallId, 0, 12), closeOpeningIds: array(string(300), 0, 8),
  rooms: array(object({ name: string(60), at: planPoint,
    role: options('hall', 'bedroom', 'bathroom', 'ensuite', 'kitchen-diner', 'utility', 'office', 'living-room', 'cloakroom'),
    accessFrom: nullable(integer(1, 10)), daylight: { type: 'boolean' } }), 1, 10),
})

function tool<S extends Schema>(category: 'inspection' | 'draft', description: string, parameters: S) {
  return { category, description, parameters }
}

export const architecturalTools = {
  find_model_variants: tool('inspection', 'Look up compatible open or closed models and their placed instances. Search by a model name such as bifold or patio door. Use null floorId to search the house.', object({
    query: string(80), floorId: nullable(floorId),
  })),
  propose_model_variants: tool('draft', 'Preview replacements for placed models found with find_model_variants. Use the installed instanceId, its floorId and the desired variant modelId. The objects and apertures stay in place.', object({
    replacements: array(object({ floorId, instanceId: id, modelId: id }), 1, 24),
  })),
  inspect_two_storey_layout: tool('inspection', 'Read both adjacent levels in one call. Each wall includes its ID and centre-line endpoints in plan metres. Openings identify protected exterior entrances. The existing connecting stair includes its opening and landings.', object({
    floorId, upperFloorId: floorId,
  })),
  compose_two_storey_layout: tool('draft', 'Submit both complete proposed floor plans together. Include one marker per room, one hall on each floor, and connected partition centre lines. Ordinary rooms use the 1-based hall index as accessFrom. An ensuite uses its bedroom index and a utility may use its kitchen index. The hall uses null. Remove former internal walls by ID and let the editor fit doors, daylight and the staircase together. Use null replaceStairId unless the user wants an existing stair reconsidered.', object({
    lower: coordinatedFloor, upper: coordinatedFloor,
    stair: object({ layout: options('auto', 'straight', 'l', 'u'), near: nullable(point), replaceStairId: nullable(id) }),
    title: string(55), explanation: string(440),
  })),
  get_extension_site: tool('inspection', 'Read the buildable exterior wall references, outward directions, recognized front door wall and selection on a floor.', object({ floorId })),
  propose_extension: tool('draft', 'Preview a front, rear or side extension along a full straight facade, or a wraparound along two adjoining perpendicular facades with independent depths in metres. Use lower-floor wall IDs from get_extension_site. Use null upperFloorId for one storey.', object({
    floorId, upperFloorId: nullable(floorId), spans: array(extensionSpan, 1, 2),
  })),
  get_project_overview: tool('inspection', 'Inspect level IDs, current selection, elevations and overall building dimensions in metres.', object({})),
  get_floor_layout: tool('inspection', 'Read the existing floor or a draft. Includes native walls, derived rooms and IDs, stair and openings. Supply null draftId for the original.', object({ floorId, draftId: nullable(draftId) })),
  get_room_details: tool('inspection', 'Read the room outline, measured dimensions and area, entrance and exterior windows. Use the ID returned by the floor tool.', object({ roomId, draftId: nullable(draftId) })),
  get_wall_details: tool('inspection', 'Read a wall, its dimensions, attached openings and known material assignments.', object({ wallId, draftId: nullable(draftId) })),
  measure_distance: tool('inspection', 'Measure the straight-line distance in metres between two plan points.', object({ pointA: point, pointB: point })),
  measure_area: tool('inspection', 'Measure a closed plan polygon or a room in square metres. Provide exactly one of roomId and polygon.', object({ roomId: nullable(roomId), draftId: nullable(draftId), polygon: nullable(array(point, 3, 100)) })),
  get_constraints: tool('inspection', 'Inspect the usable enclosed area, fixed elements, stair opening and exit, door size, partition thickness, and circulation constraints.', object({ floorId })),
  evaluate_layout: tool('inspection', 'Validate a draft. Returns room measurements, metrics and findings to resolve. Evaluate again after edits.', object({ draftId })),
  begin_design: tool('draft', 'Start an empty upstairs draft, or copy a current draft or validated option by ID. Copying permits independent alternatives. Use null baseId for an empty draft.', object({ floorId, baseId: nullable(id), requirements, priority })),
  begin_room_redesign: tool('draft', 'Start or copy a floor draft and return its ID. Inspect geometry with get_floor_layout. For an upstairs bedroom layout supply bedroom and ensuite counts. For other edits use bedrooms null and ensuites 0.', object({ floorId, baseId: nullable(id), bedrooms: nullable(integer(1, 4)), ensuites: integer(0, 2) })),
  propose_staircase: tool('draft', 'Find and preview a new staircase between adjacent existing floors. The editor compares configurations and checks the opening and access at both ends. Use auto unless a shape was requested. near is an optional preferred point on the lower floor. Use null width for the editor default.', object({
    floorId, upperFloorId: floorId, near: nullable(point), layout: options('auto', 'straight', 'l', 'u'), width: nullable(number(0.8, 1.5)),
  })),
  compose_floor_layout: tool('draft', 'Deliver a validated layout on an undivided shell. Use [x,y] metres, connected partition centre lines and one marker per room. Link en suites to 1-based bedroom indexes. The hallway serves shared rooms, with optional utility access from the kitchen. Aim new glazing near windowFocus and place exteriorDoors at wall centres along the requested facade. Use null for unused rooms.', object({
    floorId, walls: array(object({ start: planPoint, end: planPoint }), 1, 12),
    hallway: planPoint, bedrooms: array(planPoint, 1, 4), familyBathroom: nullable(planPoint),
    ensuites: array(object({ bedroom: integer(1, 4), bathroom: planPoint }), 0, 2),
    kitchenDiner: nullable(planPoint), utility: nullable(planPoint),
    daylight: object({ bedrooms: { type: 'boolean' }, hallway: { type: 'boolean' }, kitchenDiner: { type: 'boolean' } }),
    title: string(55), explanation: string(440),
    exteriorDoors: array(object({ kind: exteriorDoorKind, at: planPoint }), 0, 2),
    design: object({
      utilityAccess: options('hallway', 'kitchen'),
      windowFocus: array(object({ room: options('hallway', 'kitchenDiner'), at: planPoint }), 0, 2),
      advantages: array(string(125), 0, 2), compromises: array(string(125), 0, 2),
    }),
  }, ['design', 'exteriorDoors'])),
  reuse_existing_rooms: tool('draft', 'Find and publish a validated bedroom and ensuite layout by reusing existing upper-floor rooms. May reroute interior doors. Use for room-count briefs without requested partition moves. Set leftBathroomWindows when left-side glazing is allowed for bathrooms only.', object({
    floorId, bedrooms: integer(1, 4), ensuites: integer(1, 2), leftBathroomWindows: { type: 'boolean' },
  })),
  create_partition_wall: tool('draft', 'Add proposed internal partitions as one operation. Coordinates are wall centre lines in plan metres. Put endpoints on existing wall centre lines or other partition centre lines, including T-junctions.', object({ draftId, walls: array(object(segment), 1, 12) })),
  edit_floor_partitions: tool('draft', 'Batch a floor redesign: close openings, remove or move internal walls, and add partitions. Include hosted openings for walls you move or remove. Coordinates are centre lines in metres. Use empty arrays for unused edits.', object({
    draftId, removeOpeningIds: array(string(300), 0, 12), removeWallIds: array(wallId, 0, 12),
    moves: array(object({ wallId, ...segment }), 0, 12), walls: array(object(segment), 0, 12),
  })),
  move_partition_wall: tool('draft', 'Move a partition to new centre-line endpoints. In a floor redesign, both existing internal walls and proposed partitions can move after removing any hosted openings. Check the connected wall endpoints and reopen doors at their desired locations.', object({ draftId, wallId, ...segment })),
  remove_proposed_wall: tool('draft', 'Remove a proposed wall and its proposed doors. Only a wall in the named draft can be removed.', object({ draftId, wallId })),
  remove_internal_partition: tool('draft', 'Remove an existing internal wall from a floor redesign. First remove any openings hosted by that wall. Exterior wall lines are preserved.', object({ draftId, wallId })),
  remove_opening: tool('draft', 'Remove a door or window by opening ID in a floor redesign. This can close a former hall doorway when making an ensuite. Exterior entrance doors are preserved.', object({ draftId, openingId: string(300) })),
  insert_windows: tool('draft', 'Add needed windows together to permitted exterior walls. Offsets are measured from the wall start in metres. Each window needs a width, height and sill height.', object({ draftId, windows: array(windowPosition, 1, 8) })),
  insert_exterior_doors: tool('draft', 'Add requested front or patio doors to exterior walls in a floor redesign. Offset is the opening centre in metres along the wall from its start. The editor uses the built-in front door or 2.4 m bifold patio model.', object({
    draftId, doors: array(object({ kind: exteriorDoorKind, wallId, offset: number(0, 500) }), 1, 3),
  })),
  insert_internal_door: tool('draft', 'Add doors from one detected room to another. Floor redesigns support existing internal walls as well as new ones. roomId is the room the door swings into. Offset is metres from the start of the wall.', object({ draftId, doors: array(object(doorPosition), 1, 6) })),
  move_proposed_door: tool('draft', 'Move a draft door to an offset along a proposed wall, opening into a detected room. Only proposed doors can move.', object({ draftId, doorId, ...doorPosition })),
  set_room_function: tool('draft', 'Assign bedroom, bathroom or landing to detected draft room IDs. The native geometry determines the room boundaries.', object({ draftId, rooms: array(object({ roomId, function: roomFunction }), 1, 6) })),
  set_room_name: tool('draft', 'Set display names for detected draft rooms.', object({ draftId, rooms: array(object({ roomId, name: string(60) }), 1, 6) })),
  set_room_schedule: tool('draft', 'Assign the landing, bedrooms and ensuite pairs by room ID. Each ensuite must open only into its bedroom. Use null sharedBathroomId if no shared bathroom is needed. publish_design checks access and areas.', object({ draftId, landingId: roomId, bedroomIds: array(roomId, 1, 4), sharedBathroomId: nullable(roomId), ensuites: array(object({ bedroomId: roomId, bathroomId: roomId }), 0, 2) })),
  request_layout_candidates: tool('draft', 'Ask the deterministic upstairs planner for optional starting layouts. Copy an option with begin_design to modify walls or doors. Use publish_design to present a seed as an option.', object({ floorId, requirements })),
  publish_design: tool('draft', 'Validate and present a floor redesign, or present a previously validated layout. Give it a title, explain the choices and describe trade-offs.', object({ draftId, title: string(55), explanation: string(440), advantages: array(string(125), 0, 3), compromises: array(string(125), 0, 3) })),
} as const

export type ToolName = keyof typeof architecturalTools
export type ToolArguments<N extends ToolName> = Value<(typeof architecturalTools)[N]['parameters']>
export type ToolCall = { name: string; args: string; id: string }
export type ToolResult = { ok: true; value: unknown } | { ok: false; code: string; message: string }
export type AgentMode = 'demo' | 'live'
export type AgentRequest = { mode: AgentMode; prompt: string; history: ConversationTurn[]; source: SceneSource; previous: DesignProposal | null }
export type AgentTrace = { tool: string; arguments: unknown; result: ToolResult; milliseconds: number }
type AgentTokenCounts = { inputTokens: number; outputTokens: number }
export type AgentTokenUsage = AgentTokenCounts & { inputTokenLimit: number; outputTokenLimit: number }
export type AgentReport = AgentTokenCounts & { trace: AgentTrace[]; milliseconds: number; stop: string }
export type AgentReply = { proposals: DesignProposal[]; message: string; selection: number | null; report: AgentReport }
export type AgentProgress = { type: 'phase'; text: string; usage?: AgentTokenUsage }
export type AgentEvent = AgentProgress | { type: 'heartbeat' } | { type: 'result'; result: AgentReply } |
  { type: 'error'; text: string; report?: AgentReport; retryable?: boolean }

function conforms(schema: Schema, input: unknown): boolean {
  if ('anyOf' in schema) return input === null || conforms(schema.anyOf[0], input)
  switch (schema.type) {
    case 'object': {
      const record = asRecord(input)
      return !!record && schema.required.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key =>
        Object.hasOwn(schema.properties, key) && conforms(schema.properties[key], record[key]))
    }
    case 'array': return Array.isArray(input) && input.length >= schema.minItems && input.length <= schema.maxItems && input.every(item => conforms(schema.items, item))
    case 'string': return typeof input === 'string' && input.trim().length >= (schema.minLength ?? 0) && input.length <= (schema.maxLength ?? 200) && (!schema.enum || schema.enum.includes(input))
    case 'boolean': return typeof input === 'boolean'
    case 'integer':
    case 'number': return typeof input === 'number' && Number.isFinite(input) && input >= schema.minimum && input <= schema.maximum && (schema.type !== 'integer' || Number.isInteger(input))
  }
}

export function isToolName(name: string): name is ToolName { return Object.hasOwn(architecturalTools, name) }
export function validToolArguments<N extends ToolName>(name: N, args: unknown): args is ToolArguments<N> {
  return conforms(architecturalTools[name].parameters, args)
}

export function toolError(code: string, message: string): ToolResult { return { ok: false, code, message } }
