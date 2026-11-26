import type { ToolArguments } from './architecturalTools.ts'

const downstairs = /\b(?:downstairs|ground[- ]floor|kitchen|diner|office|cloakroom|front room|utility)\b/i
const upstairs = /\b(?:upstairs|upper[- ]floor|first[- ]floor|stairs? up to)\b/i
const rooms = /\b(?:rooms?|lay(?:out| out)|kitchen|bedrooms?|bathrooms?)\b/i

export function requestsCoordinatedLayout(prompt: string) {
  return rooms.test(prompt) && (downstairs.test(prompt) && upstairs.test(prompt) ||
    /\b(?:both|two|2) (?:floors|storeys|stories|levels)\b/i.test(prompt) &&
      /\b(?:stairs?|staircase|layout|design|rooms?)\b/i.test(prompt))
}

export function missingCoordinatedRooms(prompt: string, brief: ToolArguments<'compose_two_storey_layout'>) {
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 }
  const bedroom = /\b([1-4]|one|two|three|four) bedrooms?\b/i.exec(prompt)?.[1]?.toLowerCase()
  const suite = /\b([1-4]|one|two|three|four|an?) en[- ]?suites?\b/i.exec(prompt)?.[1]?.toLowerCase()
  const requestedBedrooms = bedroom ? counts[bedroom] ?? Number(bedroom) : 0
  const requestedSuites = suite ? suite === 'a' || suite === 'an' ? 1 : counts[suite] ?? Number(suite) : 0
  const upper = brief.upper.rooms.map(room => room.role)
  const lower = brief.lower.rooms.map(room => room.role)
  const missing: string[] = []
  if (requestedBedrooms && upper.filter(role => role === 'bedroom').length !== requestedBedrooms) missing.push(`${requestedBedrooms} upstairs bedrooms`)
  if (requestedSuites && upper.filter(role => role === 'ensuite').length !== requestedSuites) missing.push(`${requestedSuites} private en suite${requestedSuites === 1 ? '' : 's'}`)
  if (/\bfamily bathroom\b/i.test(prompt) && !upper.includes('bathroom')) missing.push('family bathroom')
  if (downstairs.test(prompt)) {
    if (/\bkitchen\b/i.test(prompt) && !lower.includes('kitchen-diner')) missing.push('ground-floor kitchen/diner')
    if (/\boffice\b/i.test(prompt) && !lower.includes('office')) missing.push('office')
    if (/\butility\b/i.test(prompt) && !lower.includes('utility')) missing.push('utility')
    if (/\bcloakroom\b/i.test(prompt) && !lower.includes('cloakroom')) missing.push('cloakroom')
    if (/\bfront room\b/i.test(prompt) && !lower.includes('living-room')) missing.push('front room')
  }
  return missing
}
