import type { Wall } from './types.ts'

export type WindowClearance = {
  kind: 'left' | 'right' | 'sill' | 'head'
  from: [number, number]
  to: [number, number]
  distance: number
  target: 'wall' | 'opening' | 'floor' | 'ceiling'
}

export function parseClearanceDistance(text: string) {
  const match = text.trim().match(/^(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)?$/i)
  if (!match) throw new Error('Enter a positive distance in m, cm or mm (zero is allowed).')
  const value = Number(match[1]) / (match[2]?.toLowerCase() === 'mm' ? 1000 : match[2]?.toLowerCase() === 'cm' ? 100 : 1)
  if (!Number.isFinite(value)) throw new Error('Enter a finite distance.')
  return value
}

/** Move the opening, preserving its size and the boundary the user clicked. */
export function editWindowClearance(input: Parameters<typeof getWindowClearances>[0], kind: WindowClearance['kind'], value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Enter a distance of zero or more.')
  const measurements = getWindowClearances(input)
  const current = measurements.find(measurement => measurement.kind === kind)
  if (!current) throw new Error('This clearance is no longer available.')
  let center = input.center, bottom = input.bottom
  const delta = value - current.distance
  if (kind === 'left' || kind === 'right') {
    const shift = kind === 'left' ? delta : -delta
    const left = measurements.find(m => m.kind === 'left')?.distance ?? 0
    const right = measurements.find(m => m.kind === 'right')?.distance ?? 0
    if (shift < -left - 1e-6 || shift > right + 1e-6) throw new Error('That distance would cross a wall or another opening.')
    center += shift
  } else bottom += kind === 'sill' ? delta : -delta
  if (bottom < -1e-6 || bottom + input.height > Math.min(input.ceiling, input.wall.height) + 1e-6) {
    throw new Error('The opening must fit between the floor and ceiling.')
  }
  for (const opening of input.wall.openings ?? []) {
    if (opening.id === input.modelId || opening.id.startsWith(`${input.modelId}:`)) continue
    if (center - input.width / 2 < opening.center + opening.width / 2 - 1e-6 &&
      center + input.width / 2 > opening.center - opening.width / 2 + 1e-6 &&
      bottom < opening.bottom + opening.height - 1e-6 && bottom + input.height > opening.bottom + 1e-6) {
      throw new Error('That distance would overlap another opening.')
    }
  }
  return { center, bottom: Math.max(0, bottom) }
}

/** Distances in the host wall's (along-wall, height-above-floor) coordinates. */
export function getWindowClearances({ wall, walls, modelId, center, width, bottom, height, ceiling, side }: {
  wall: Wall; walls: readonly Wall[]; modelId: string
  center: number; width: number; bottom: number; height: number; ceiling: number; side: -1 | 1
}): WindowClearance[] {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  if (length < 1e-6 || width <= 0 || height <= 0) return []
  const ux = (wall.end.x - wall.start.x) / length, uz = (wall.end.y - wall.start.y) / length
  const left = center - width / 2, right = center + width / 2, top = bottom + height
  const middle = bottom + height / 2
  let leftLimit = 0, rightLimit = length, leftY = middle, rightY = middle
  let leftTarget: WindowClearance['target'] = 'wall', rightTarget: WindowClearance['target'] = 'wall'
  const consider = (min: number, max: number, target: 'wall' | 'opening', y = middle) => {
    if (max <= left + 1e-6 && max >= leftLimit) { leftLimit = max; leftTarget = target; leftY = y }
    if (min >= right - 1e-6 && min <= rightLimit) { rightLimit = min; rightTarget = target; rightY = y }
  }
  for (const opening of wall.openings ?? []) {
    if (opening.id === modelId || opening.id.startsWith(`${modelId}:`)) continue
    const low = Math.max(bottom, opening.bottom), high = Math.min(top, opening.bottom + opening.height)
    if (high <= low) continue
    consider(opening.center - opening.width / 2, opening.center + opening.width / 2, 'opening', Math.max(low, Math.min(high, middle)))
  }
  // Intersect this wall face with the actual thickness of joining walls.
  // A partition ending at the inside face must not shorten the outside ruler.
  const ox = wall.start.x - uz * side * (wall.thickness / 2 + .001)
  const oz = wall.start.y + ux * side * (wall.thickness / 2 + .001)
  for (const other of walls) {
    if (other.id === wall.id || other.height <= bottom) continue
    const dx = other.end.x - other.start.x, dz = other.end.y - other.start.y, span = Math.hypot(dx, dz)
    if (span < 1e-6 || Math.abs(ux * dz / span - uz * dx / span) < 1e-5) continue
    const vx = dx / span, vz = dz / span, px = ox - other.start.x, pz = oz - other.start.y
    let min = -Infinity, max = Infinity
    for (const [origin, direction, low, high] of [
      [px * vx + pz * vz, ux * vx + uz * vz, 0, span],
      [-px * vz + pz * vx, -ux * vz + uz * vx, -other.thickness / 2, other.thickness / 2],
    ]) {
      if (Math.abs(direction) < 1e-8) {
        if (origin < low || origin > high) { min = Infinity; break }
      } else {
        const a = (low - origin) / direction, b = (high - origin) / direction
        min = Math.max(min, Math.min(a, b)); max = Math.min(max, Math.max(a, b))
      }
    }
    if (min <= max) consider(min, max, 'wall', Math.min(middle, other.height))
  }
  const measurements: WindowClearance[] = [
    { kind: 'left', from: [leftLimit, leftY], to: [left, leftY], distance: left - leftLimit, target: leftTarget },
    { kind: 'right', from: [right, rightY], to: [rightLimit, rightY], distance: rightLimit - right, target: rightTarget },
    { kind: 'sill', from: [center, 0], to: [center, bottom], distance: bottom, target: 'floor' },
    { kind: 'head', from: [center, top], to: [center, ceiling], distance: ceiling - top, target: 'ceiling' },
  ]
  return measurements.filter(measurement => measurement.distance >= -1e-6).map(measurement => ({ ...measurement, distance: Math.max(0, measurement.distance) }))
}
