export type { RoomFunction } from '../types.ts'

export const ASSISTANT_PROMPT_LIMIT = 1000

type Intent = 'layout' | 'select' | 'extension' | 'question'
type FloorChoice = 'current' | 'upstairs'
export type LayoutPriority = 'bedrooms' | 'landing'

export type Requirements = {
  bedrooms: number
  bathrooms: number
  landing: 'standard' | 'spacious'
  bathroom: 'standard' | 'larger'
  primaryBedroom: 'standard' | 'larger'
  oppositeBedroom: number | null
}

export type Interpretation = {
  intent: Intent
  floor: FloorChoice
  requirements: Requirements
  selection: number | null
  message: string
}

export type ConversationTurn = { role: 'user' | 'assistant'; text: string }

export type InterpretationRequest = {
  prompt: string
  history: ConversationTurn[]
  previous: Requirements | null
  previousFloor: FloorChoice | null
  options: number
}

export interface InterpretationProvider {
  interpret(request: InterpretationRequest, signal?: AbortSignal): Promise<Interpretation>
}

const requirementsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    bedrooms: { type: 'integer', minimum: 1, maximum: 4 },
    bathrooms: { type: 'integer', minimum: 1, maximum: 1 },
    landing: { type: 'string', enum: ['standard', 'spacious'] },
    bathroom: { type: 'string', enum: ['standard', 'larger'] },
    primaryBedroom: { type: 'string', enum: ['standard', 'larger'] },
    oppositeBedroom: { type: ['integer', 'null'], minimum: 1, maximum: 4 },
  },
  required: ['bedrooms', 'bathrooms', 'landing', 'bathroom', 'primaryBedroom', 'oppositeBedroom'],
}

export const interpretationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['layout', 'select', 'extension', 'question'] },
    floor: { type: 'string', enum: ['current', 'upstairs'] },
    requirements: requirementsSchema,
    selection: { type: ['integer', 'null'], minimum: 1, maximum: 2 },
    message: { type: 'string' },
  },
  required: ['intent', 'floor', 'requirements', 'selection', 'message'],
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

const integerInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

export function validRequirements(value: unknown): value is Requirements {
  const requirements = asRecord(value)
  return !!requirements && Object.keys(requirements).length === 6 &&
    integerInRange(requirements.bedrooms, 1, 4) && requirements.bathrooms === 1 &&
    (requirements.landing === 'standard' || requirements.landing === 'spacious') &&
    (requirements.bathroom === 'standard' || requirements.bathroom === 'larger') &&
    (requirements.primaryBedroom === 'standard' || requirements.primaryBedroom === 'larger') &&
    (requirements.oppositeBedroom === null || integerInRange(requirements.oppositeBedroom, 1, requirements.bedrooms))
}

export function validInterpretation(value: unknown): value is Interpretation {
  const result = asRecord(value)
  return !!result && Object.keys(result).length === 5 &&
    ['layout', 'select', 'extension', 'question'].some(intent => intent === result.intent) &&
    (result.floor === 'current' || result.floor === 'upstairs') && validRequirements(result.requirements) &&
    (result.intent === 'select' ? integerInRange(result.selection, 1, 2) : result.selection === null) &&
    typeof result.message === 'string' && result.message.length <= 600
}

const defaults: Requirements = {
  bedrooms: 3, bathrooms: 1, landing: 'standard', bathroom: 'standard',
  primaryBedroom: 'standard', oppositeBedroom: null,
}
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
const count = (value?: string) => value === undefined ? undefined : numberWords[value] ?? Number(value)
const amount = '(\\d+|one|two|three|four|five|six)'
const sizeChange = /\b(bigger|larger|good[- ]sized|more\s+(?:room|space)|enlarge|increase|expand)\b/

function mockInterpret({ prompt, previous, previousFloor, options }: InterpretationRequest): Interpretation {
  const input = prompt.toLowerCase()
  const floor = /\b(upstairs|first[- ]floor|upper[- ]floor)\b/.test(input) ? 'upstairs'
    : /\b(this|current|selected) floor\b/.test(input) ? 'current' : previousFloor ?? 'upstairs'
  const requirements = { ...defaults, ...previous }
  const reply = (intent: Intent, message = '', selection: number | null = null): Interpretation =>
    ({ intent, floor, requirements, message, selection })

  if (/\b(extend|extension|kitchen|diner)\b/.test(input)) {
    const depth = input.match(/\b(\d+(?:\.\d+)?)\s*(?:m\b|metres?\b|meters?\b)/)?.[1]
    return reply('extension', `${depth ? `A ${depth} m extension` : 'An extension'} could create room for an open-plan kitchen and dining area. I’d start by identifying the exterior wall, the site boundary and the route from the existing house. Which wall is the rear of the house?`)
  }
  if (/\b(ground[- ]floor|downstairs)\b/.test(input)) return reply('question', 'I can divide an upstairs floor into bedrooms, a bathroom and a landing. Which upper floor would you like to work on?')
  if (/\b(whole house|entire house|new house|design (?:a|the) house|site layout)\b/.test(input)) return reply('question', 'This planner starts with an existing upper floor and staircase. It can help divide that space once the house footprint and stairs are in place.')
  if (/\b(no|without) (?:a )?landing\b/.test(input)) return reply('question', 'This layout needs a landing to keep a route from the stair to each room. Would a compact landing work for you?')

  const selection = input.match(/\b(?:option|layout|alternative)\s*(a|b|1|2)\b|\b(first|second)\s+(?:layout|option|alternative)\b/)
  const chosen = selection && (/^(b|2|second)$/.test(selection[1] ?? selection[2]) ? 2 : 1)
  if (chosen && !sizeChange.test(input) && !/\b(move|revise|change|smaller)\b/.test(input)) {
    return chosen <= options ? reply('select', `I’ve selected option ${chosen}.`, chosen)
      : reply('question', 'Ask me to generate a layout first, then you can choose an option.')
  }

  const beds = count(input.match(new RegExp(`\\b${amount}\\s+(?:\\w+\\s+)?bedrooms?\\b`))?.[1] ??
    input.match(new RegExp(`\\bbedrooms?\\s+${amount}\\s+rooms?\\b`))?.[1])
  const baths = count(input.match(new RegExp(`\\b${amount}\\s+bathrooms?\\b`))?.[1])
  const qualifies = beds !== undefined || /\b(design|plan|organise|organize|divide|layout|lay out|model)\b/.test(input) &&
    /\b(upstairs|bedrooms?|bathroom|landing)\b/.test(input)
  if (beds !== undefined && (beds < 1 || beds > 4) || baths !== undefined && baths !== 1) {
    return reply('question', 'I can plan one to four bedrooms, one bathroom and a landing. How many bedrooms would you like to try?')
  }
  if (!previous && !qualifies) return reply('question', 'What would you like on the upper floor? You can tell me how many bedrooms you need and how much space to give the bathroom or landing.')

  const reviseBathroom = /\bbathroom\b/.test(input) && sizeChange.test(input)
  const reviseLanding = /\b(airy|spacious|open landing|wider landing)\b/.test(input) || /\blanding\b/.test(input) && sizeChange.test(input) && !/\bkeep the landing\b/.test(input)
  const revisePrimary = /\b(master|primary|main)\s+bedroom\b/.test(input) && sizeChange.test(input)
  const opposite = count(input.match(new RegExp(`\\bbedroom\\s+${amount}\\b`))?.[1])
  const move = opposite !== undefined && /\b(other|opposite) side\b/.test(input)
  if (move && (opposite < 1 || opposite > (beds ?? requirements.bedrooms))) {
    return reply('question', 'Which of the bedrooms in the current proposal would you like to move?')
  }
  if (!qualifies && !reviseBathroom && !reviseLanding && !revisePrimary && !move) {
    return reply('question', 'Tell me which change you’d like to try, for example a bigger bathroom, a more spacious landing or moving bedroom three to the other side.')
  }
  if (beds !== undefined) requirements.bedrooms = beds
  if (requirements.oppositeBedroom && requirements.oppositeBedroom > requirements.bedrooms) requirements.oppositeBedroom = null
  if (reviseBathroom) requirements.bathroom = 'larger'
  if (reviseLanding) requirements.landing = 'spacious'
  if (revisePrimary) requirements.primaryBedroom = 'larger'
  if (move) requirements.oppositeBedroom = opposite
  return reply('layout')
}

export const mockProvider: InterpretationProvider = {
  async interpret(request) { return mockInterpret(request) },
}
