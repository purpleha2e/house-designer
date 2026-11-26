import { requestsCoordinatedLayout } from './coordinatedIntent.ts'

export type CompassDirection = 'north' | 'east' | 'south' | 'west'
export type DimensionedExtension = { spans: Array<{ direction: CompassDirection; depth: number }>; twoStoreys: boolean }
const twoStoreys = /\b(?:(?:two|2)[- ]stor(?:eys?|ys?|ies)|(?:both|two|2)\s+(?:floors|levels|storeys|stories)|extend (?:it|the house) (?:upstairs|on both))\b/i

export function requestsSecondStorey(prompt: string) {
  if (/\b(?:not|no longer|instead of) (?:a )?(?:two|2)[- ]stor(?:ey|y)\b/i.test(prompt)) return false
  return twoStoreys.test(prompt) && /\b(?:meant|make (?:it|that|this|the extension)|change (?:it|that|this|the extension)|turn (?:it|that|this|the extension)|same extension|existing extension|applied extension)\b/i.test(prompt) ||
    /\b(?:add|put|build)\s+(?:a |an |the )?(?:second|upper|another)\s+(?:storey|story|floor|level)\s+(?:above|over|to|on(?: top of)?)\s+(?:the |this |my |our )?(?:existing |applied )?extension\b/i.test(prompt)
}

export function readDimensionedExtension(prompt: string): DimensionedExtension | null {
  const wraparound = /\bwrap[ -]?around\b/i.test(prompt)
  if (!wraparound && !/\b(?:extensions?|extend)\b/i.test(prompt)) return null
  // Leave revisions, partial-width additions and ambiguous measurements to the conversational agent.
  if (/\b(?:half[- ]width|partial[- ]width|half of|centred|centered|upper[- ]floor extension|three[- ]stor(?:ey|y)|3[- ]stor(?:ey|y))\b/i.test(prompt) ||
      /\bextend (?:only )?(?:the )?(?:first|second|top|upper) floor\b/i.test(prompt)) return null
  const spans = [...prompt.matchAll(/\b(north|east|south|west)(?:[- ]facing)?(?:\s+(?:side|wall|fa[cç]ade))?\s+(?:(?:by|up to)\s+)?(\d+(?:\.\d+)?)\s*m(?:et(?:re|er)s?)?\b(?![²³^])/gi)]
  if (spans.length < (wraparound ? 2 : 1) || spans.length > 2 || spans.some(match =>
    /(?:\b(?:not|no|avoid|instead of)|can['’]t)\b[^.!?,]{0,32}$/i.test(prompt.slice(0, match.index)) ||
    /^\s*(?:or|to|[-–])\s*\d/i.test(prompt.slice(match.index + match[0].length)))) return null
  const measured = spans.map(([, direction, depth]) => ({ direction: direction.toLowerCase() as CompassDirection, depth: Number(depth) }))
  if (new Set(measured.map(span => span.direction)).size !== measured.length ||
      measured.some(span => span.depth < 0.75 || span.depth > 20)) return null
  return { spans: measured, twoStoreys: twoStoreys.test(prompt) }
}

export function requestsExtensionLayout(prompt: string) {
  if (!requestsCoordinatedLayout(prompt)) return false
  if (readDimensionedExtension(prompt)) return true
  return /\bextend\b[^.!?]*\b\d+(?:\.\d+)?\s*m(?:et(?:re|er)s?)?\b/i.test(prompt) ||
    /\b(?:design|build|add|create|draw|propose)\s+(?:me\s+)?(?:an?|new)\s+(?:(?:new|two[- ]storey|single[- ]storey|rear|front|side|wrap[ -]?around)\s+){0,4}extension\b/i.test(prompt)
}

export function extensionDesignSteps(brief: string) {
  if (requestsCoordinatedLayout(brief)) return [{
    label: 'Design both floors and stairs',
    prompt: 'Design the rooms on both floors and fit the stairs between the proposed hall and landing. Use the room requirements and style from my original brief and keep the applied footprint. Show one coordinated layout.',
  }]
  const steps = []
  if (/\b(?:kitchen|dining|diner|living|utility|downstairs)\b/i.test(brief)) steps.push({
    label: 'Design the ground floor',
    prompt: 'Design the ground-floor layout using the current footprint. Use the ground-floor room requirements and style from my original brief. Show a validated floor preview.',
  })
  if (/\b(?:stair|stairs|staircase|stairway)\b/i.test(brief)) steps.push({
    label: 'Plan the stairs',
    prompt: 'Plan the stair between the ground and first floors using the style in my original brief. Check whether there is already a suitable stair. If there is none, add a staircase that fits and show a preview.',
  })
  if (/\b(?:upstairs|bedrooms?|en[- ]?suites?|family bathroom)\b/i.test(brief)) steps.push({
    label: 'Design upstairs',
    prompt: 'Design the upper-floor layout using the current footprint. Use the upstairs room counts, en suites, shared bathroom and style requested in my original brief. Show a validated floor preview.',
  })
  return steps
}

