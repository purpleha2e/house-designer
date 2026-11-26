import type { FloorLevel, Point, SurfaceMaterialAssignment, Wall, WallOpening } from './types.ts'
import { parseWallSideFragmentBounds } from './wallFragmentAssignments.ts'
import { getCanonicalWallUvDistance } from './wallEngine/wallUv.ts'
import { EXTERNAL_WALL_NODE_MERGE_METERS } from './wallTopology.ts'

const EPSILON = 1e-6

function getSplitBlocker(wall: Wall, length: number, offset: number) {
  // A shorter exterior segment would snap back onto its own endpoint.
  const minimum = wall.kind === 'external' ? EXTERNAL_WALL_NODE_MERGE_METERS + EPSILON : .15
  if (!Number.isFinite(length) || !Number.isFinite(offset) || offset < minimum || length - offset < minimum) return 'end'
  if (wall.openings?.some(opening => Math.abs(opening.center - offset) < opening.width / 2 + EPSILON)) return 'opening'
  return null
}

export type WallSplitTarget = {
  wallId: string
  offset: number
  point: Point
  reference: Point
  normal: Point
  direction: Point
  hostHalfThickness: number
  distance: number
  blocker: 'opening' | 'end' | null
}

export function getWallSplitTarget(walls: Wall[], pointer: Point, tolerance: number) {
  let hit: { wall: Wall; offset: number; side: -1 | 1 | null } | null = null
  let nearest = Infinity
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dy)
    if (length < EPSILON) continue
    const axis = { x: dx / length, y: dy / length }
    const offset = Math.min(length, Math.max(0, (pointer.x - wall.start.x) * axis.x + (pointer.y - wall.start.y) * axis.y))
    const point = { x: wall.start.x + axis.x * offset, y: wall.start.y + axis.y * offset }
    const gap = Math.hypot(pointer.x - point.x, pointer.y - point.y)
    const hostHalfThickness = wall.thickness / 2
    if (gap > hostHalfThickness + tolerance || gap >= nearest) continue
    nearest = gap
    const across = (pointer.x - point.x) * -axis.y + (pointer.y - point.y) * axis.x
    hit = { wall, offset, side: across < -EPSILON ? -1 : across > EPSILON ? 1 : null }
  }
  return hit
}

export function getWallSplitGuide(
  wall: Wall,
  offset: number,
  side: -1 | 1,
  faceRanges: { faceStart: Point; faceEnd: Point }[],
): WallSplitTarget {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  const axis = { x: dx / length, y: dy / length }
  const projectOntoWall = (point: Point) => (point.x - wall.start.x) * axis.x + (point.y - wall.start.y) * axis.y
  const pointAt = (along: number) => ({ x: wall.start.x + axis.x * along, y: wall.start.y + axis.y * along })
  // An interior face can have several clear spans separated by intersecting walls.
  let start = 0
  let end = length
  let nearest = Infinity
  for (const { faceStart, faceEnd } of faceRanges) {
    const a = projectOntoWall(faceStart)
    const b = projectOntoWall(faceEnd)
    const rangeStart = Math.min(a, b)
    const rangeEnd = Math.max(a, b)
    const gap = Math.max(rangeStart - offset, offset - rangeEnd, 0)
    if (gap >= nearest) continue
    nearest = gap
    start = rangeStart
    end = rangeEnd
  }
  const fromStart = Math.abs(offset - start) <= Math.abs(offset - end)
  const referenceOffset = fromStart ? start : end
  const forward = offset === referenceOffset ? fromStart : offset > referenceOffset
  return {
    wallId: wall.id, offset, point: pointAt(offset),
    reference: pointAt(referenceOffset),
    direction: forward ? axis : { x: -axis.x, y: -axis.y },
    normal: { x: -axis.y * side, y: axis.x * side },
    hostHalfThickness: wall.thickness / 2,
    distance: Math.abs(offset - referenceOffset),
    blocker: getSplitBlocker(wall, length, offset),
  }
}

export function getWallSplitAtDistance(wall: Wall, guide: WallSplitTarget, value: string): WallSplitTarget | null {
  const text = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(text)) return null
  const distance = Number(text)
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  const point = {
    x: guide.reference.x + guide.direction.x * distance,
    y: guide.reference.y + guide.direction.y * distance,
  }
  const offset = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / length
  if (!Number.isFinite(offset) || offset < 0 || offset > length) return null
  return { ...guide, point, offset, distance, blocker: getSplitBlocker(wall, length, offset) }
}

export function splitFloorWall(floor: FloorLevel, wallId: string, offset: number, newId: string) {
  const wall = floor.walls.find(candidate => candidate.id === wallId)
  if (!wall) return null
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  if (getSplitBlocker(wall, length, offset)) return null

  const point = { x: wall.start.x + dx * offset / length, y: wall.start.y + dy * offset / length }
  const beforeOpenings: WallOpening[] = [], afterOpenings: WallOpening[] = []
  for (const opening of wall.openings ?? []) {
    if (opening.center < offset) beforeOpenings.push(opening)
    else afterOpenings.push({ ...opening, center: opening.center - offset })
  }
  const first = { ...wall, end: point, openings: beforeOpenings.length ? beforeOpenings : undefined }
  const second = { ...wall, id: newId, start: point, openings: afterOpenings.length ? afterOpenings : undefined }
  const models = (floor.models ?? []).map(model => {
    const attachment = model.wallAttachment
    if (attachment?.wallId !== wallId || attachment.offset < offset) return model
    return { ...model, wallAttachment: { ...attachment, wallId: newId, offset: attachment.offset - offset } }
  })

  return {
    floor: { ...floor, models, walls: floor.walls.flatMap(candidate => candidate.id === wallId ? [first, second] : [candidate]) },
    wall, second, point,
  }
}

type WallSplit = NonNullable<ReturnType<typeof splitFloorWall>>

export function remapSplitWallFinishes(assignments: SurfaceMaterialAssignment[], split: WallSplit, syncedFloor: FloorLevel, createId: () => string) {
  const { wall, second, point } = split
  const cut = getCanonicalWallUvDistance(wall, point)
  const startsBelowCut = getCanonicalWallUvDistance(wall, wall.start) < cut
  const newOpenings = new Set(syncedFloor.walls.find(candidate => candidate.id === second.id)?.openings?.map(opening => opening.id))
  const movedOpenings = new Map<string, string>()
  const oldSuffix = `:wall:${wall.id}`
  for (const { id } of second.openings ?? []) {
    const originalId = id.endsWith(oldSuffix) ? id.slice(0, -oldSuffix.length) : id
    const movedId = [id, originalId, `${originalId}:wall:${second.id}`].find(candidate => newOpenings.has(candidate))
    if (movedId) movedOpenings.set(id, movedId)
  }
  const prefix = `perimeter-wall:${wall.id}:`

  return assignments.flatMap(assignment => {
    const { target } = assignment
    if (!('wallId' in target) || target.wallId !== wall.id) return [assignment]
    if (target.type === 'wall-face') {
      return [assignment, { ...assignment, id: createId(), target: { ...target, wallId: second.id } }]
    }
    if (target.type === 'portal-floor') {
      const openingId = movedOpenings.get(target.openingId)
      return openingId && target.floorId === syncedFloor.id
        ? [{ ...assignment, target: { ...target, openingId, wallId: second.id } }]
        : [assignment]
    }

    const bounds = parseWallSideFragmentBounds(target.fragmentId)
    if (bounds && target.fragmentId.startsWith(prefix)) {
      const overlapsLower = bounds.minAlong < cut - EPSILON
      const overlapsUpper = bounds.maxAlong > cut + EPSILON
      const stays = startsBelowCut ? overlapsLower : overlapsUpper
      const moves = startsBelowCut ? overlapsUpper : overlapsLower
      if (!moves) return [assignment]
      const moved = {
        ...assignment,
        id: stays ? createId() : assignment.id,
        target: { ...target, wallId: second.id, fragmentId: `perimeter-wall:${second.id}:${target.fragmentId.slice(prefix.length)}` },
      }
      return stays ? [assignment, moved] : [moved]
    }

    for (const [oldId, newId] of movedOpenings) {
      const revealPrefix = `${wall.id}:opening:${oldId}:`
      if (target.fragmentId.startsWith(revealPrefix)) {
        return [{ ...assignment, target: { ...target, wallId: second.id,
          fragmentId: `${second.id}:opening:${newId}:${target.fragmentId.slice(revealPrefix.length)}` } }]
      }
    }
    if (target.fragmentId.startsWith(`${wall.id}:cap:end`) || target.fragmentId.startsWith(`${wall.id}:join-side:end:`)) {
      return [{ ...assignment, target: { ...target, wallId: second.id, fragmentId: `${second.id}${target.fragmentId.slice(wall.id.length)}` } }]
    }
    return [assignment]
  })
}
