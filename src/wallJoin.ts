import type { FloorLevel, SurfaceMaterialAssignment, SurfaceWallSide, Wall } from './types.ts'
import { parseWallSideFragmentBounds } from './wallFragmentAssignments.ts'
import { getCanonicalWallUvDistance } from './wallEngine/wallUv.ts'
import { buildWallTopology, getWallEndpointNode, matchChangedRoomSignatures, remapRoomMetadata, type WallNode, type WallTopology } from './wallTopology.ts'

type ChainSegment = { wall: Wall; reversed: boolean }

export function getWallJoinChain(walls: Wall[], wallIds: string[], topology: WallTopology) {
  if (wallIds.length < 2 || new Set(wallIds).size !== wallIds.length) return null

  type Edge = { wall: Wall; start: WallNode; end: WallNode }
  const edgesByNode = new Map<WallNode, Edge[]>()
  for (const id of wallIds) {
    const wall = walls.find(candidate => candidate.id === id)
    const start = getWallEndpointNode(topology, id, 'start')
    const end = getWallEndpointNode(topology, id, 'end')
    if (!wall || !start || !end || start === end) return null

    const edge = { wall, start, end }
    for (const node of [start, end]) {
      const edges = edgesByNode.get(node) ?? []
      edges.push(edge)
      if (edges.length > 2) return null
      edgesByNode.set(node, edges)
    }
  }

  const terminals = [...edgesByNode].filter(([, edges]) => edges.length === 1)
  if (terminals.length !== 2) return null

  const segments: ChainSegment[] = []
  let node = terminals[0][0]
  let previous: Edge | undefined
  for (let index = 0; index < wallIds.length; index++) {
    const edge = edgesByNode.get(node)?.find(candidate => candidate !== previous)
    if (!edge) return null
    const reversed = edge.end === node
    segments.push({ wall: edge.wall, reversed })
    node = reversed ? edge.start : edge.end
    previous = edge
  }
  if (node !== terminals[1][0]) return null

  const primary = segments.find(segment => segment.wall.id === wallIds[0])!
  // Keep the first selected wall's direction and properties in the result.
  if (primary.reversed) {
    segments.reverse()
    for (const segment of segments) segment.reversed = !segment.reversed
  }
  const first = segments[0]
  const last = segments[segments.length - 1]
  const start = first.reversed ? first.wall.end : first.wall.start
  const end = last.reversed ? last.wall.start : last.wall.end
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (!Number.isFinite(length) || length === 0) return null
  return { segments, primary: primary.wall, start, end, length }
}

type WallJoinChain = NonNullable<ReturnType<typeof getWallJoinChain>>

export function joinFloorWalls(floor: FloorLevel, chain: WallJoinChain, newId: string) {
  const { segments, start, end, length, primary } = chain
  const lengths = segments.map(({ wall }) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y))
  const scale = length / lengths.reduce((sum, segmentLength) => sum + segmentLength, 0)
  let travelled = 0
  const sources = new Map(segments.map((segment, index) => {
    const segmentLength = lengths[index]
    const from = travelled
    travelled += segmentLength
    const mapOffset = (offset: number) => (from + (segment.reversed ? segmentLength - offset : offset)) * scale
    return [segment.wall.id, { ...segment, mapOffset }]
  }))

  const openings = [...sources.values()].flatMap(({ wall, mapOffset }) => (wall.openings ?? []).map(opening => ({
    ...opening,
    center: mapOffset(opening.center),
  }))).sort((a, b) => a.center - b.center)
  const joined: Wall = { ...primary, id: newId, start, end, openings: openings.length ? openings : undefined }
  let inserted = false
  const walls = floor.walls.flatMap(wall => {
    if (!sources.has(wall.id)) return [wall]
    if (inserted) return []
    inserted = true
    return [joined]
  })
  const models = (floor.models ?? []).map(model => {
    const attachment = model.wallAttachment
    const source = attachment && sources.get(attachment.wallId)
    if (!attachment || !source) return model
    return { ...model, wallAttachment: {
      ...attachment,
      wallId: newId,
      offset: source.mapOffset(attachment.offset),
      side: source.reversed ? reverseSide(attachment.side ?? 1) : attachment.side,
    } }
  })
  return { floor: { ...floor, walls, models }, joined, chain, sources }
}

function reverseSide(side: -1 | 1): -1 | 1
function reverseSide(side: SurfaceWallSide): SurfaceWallSide
function reverseSide(side: SurfaceWallSide): SurfaceWallSide {
  return side === 'both' ? side : side === 1 ? -1 : 1
}

type WallJoin = ReturnType<typeof joinFloorWalls>

export function remapJoinedWallFinishes(assignments: SurfaceMaterialAssignment[], result: WallJoin, syncedFloor: FloorLevel) {
  const { joined, chain, sources } = result
  const nextOpenings = new Set(syncedFloor.walls.find(wall => wall.id === joined.id)?.openings?.map(opening => opening.id))
  const joinedStart = getCanonicalWallUvDistance(joined, joined.start)
  const joinedSign = Math.sign(getCanonicalWallUvDistance(joined, joined.end) - joinedStart)
  const primaryFinishes: SurfaceMaterialAssignment[] = []
  const remapped = assignments.flatMap(assignment => {
    const { target } = assignment
    const source = 'wallId' in target ? sources.get(target.wallId) : undefined
    if (!('wallId' in target) || !source) return [assignment]
    const { wall, reversed, mapOffset } = source
    const mapOpeningId = (id: string) => {
      const suffix = `:wall:${wall.id}`
      const base = id.endsWith(suffix) ? id.slice(0, -suffix.length) : id
      return [id, base, `${base}:wall:${joined.id}`].find(candidate => nextOpenings.has(candidate))
    }

    if (target.type === 'portal-floor') {
      const openingId = mapOpeningId(target.openingId)
      return openingId ? [{ ...assignment, target: { ...target, wallId: joined.id, openingId } }] : []
    }

    const side = reversed ? reverseSide(target.side) : target.side
    if (target.type === 'wall-face') {
      const updated: SurfaceMaterialAssignment = { ...assignment, target: { ...target, wallId: joined.id, side } }
      if (wall.id !== chain.primary.id) return [updated]
      primaryFinishes.push(updated)
      return []
    }

    let fragmentId: string | undefined
    const bounds = parseWallSideFragmentBounds(target.fragmentId)
    if (bounds) {
      const oldStart = getCanonicalWallUvDistance(wall, wall.start)
      const oldSign = Math.sign(getCanonicalWallUvDistance(wall, wall.end) - oldStart)
      const mapAlong = (along: number) => joinedStart + mapOffset((along - oldStart) * oldSign) * joinedSign
      const a = mapAlong(bounds.minAlong)
      const b = mapAlong(bounds.maxAlong)
      const [min, max, bottom, top] = [Math.min(a, b), Math.max(a, b), bounds.minY, bounds.maxY]
        .map(value => Number(value.toFixed(4)))
      const oldSide = target.fragmentId.split(':')[2]
      const faceSide = reversed ? reverseSide(oldSide === '-1' ? -1 : 1) : oldSide
      const roofRegion = bounds.roofRegion ? `:roof-region:${bounds.roofRegion}` : ''
      fragmentId = `perimeter-wall:${joined.id}:${faceSide}:side:${min}:${max}:${bottom}:${top}${roofRegion}`
    } else {
      const tail = target.fragmentId.startsWith(`${wall.id}:`) ? target.fragmentId.slice(wall.id.length + 1) : ''
      const cap = tail.match(/^(cap|join-side):(start|end)(?::(-1|1))?$/)
      if (cap) {
        const endpoint = reversed ? (cap[2] === 'start' ? 'end' : 'start') : cap[2]
        const outer = endpoint === 'start' ? chain.segments[0] : chain.segments.at(-1)
        const capSide = cap[3] && reversed ? reverseSide(cap[3] === '-1' ? -1 : 1) : cap[3]
        if (outer?.wall.id === wall.id) fragmentId = `${joined.id}:${cap[1]}:${endpoint}${capSide ? `:${capSide}` : ''}`
      }
      for (const opening of wall.openings ?? []) {
        const prefix = `opening:${opening.id}:`
        if (!tail.startsWith(prefix)) continue
        const openingId = mapOpeningId(opening.id)
        if (openingId) {
          let part = tail.slice(prefix.length)
          if (reversed) part = part.replace(/^(left|right)(?=:|$)/, edge => edge === 'left' ? 'right' : 'left')
          fragmentId = `${joined.id}:opening:${openingId}:${part}`
        }
        break
      }
    }

    return fragmentId ? [{ ...assignment, target: { ...target, wallId: joined.id, side, fragmentId } }] : []
  })
  const assignedFaces = new Set<string>()
  return [...remapped, ...primaryFinishes].reverse().filter(assignment => {
    const { target } = assignment
    if (target.type !== 'wall-face' || target.wallId !== joined.id) return true
    const key = `${target.side}:${assignment.coverageHeight ?? 'full'}`
    if (assignedFaces.has(key)) return false
    assignedFaces.add(key)
    return true
  }).reverse()
}

export function preserveJoinedWallRooms(before: FloorLevel, after: FloorLevel, assignments: SurfaceMaterialAssignment[]) {
  const oldRooms = buildWallTopology(before.walls, { floorFootprints: before.floorFootprints }).rooms
  const newRooms = buildWallTopology(after.walls, { floorFootprints: after.floorFootprints }).rooms
  const roomSignatures = matchChangedRoomSignatures(oldRooms, newRooms)
  if (!roomSignatures.size) return { floor: after, assignments }

  const rooms = remapRoomMetadata(after.rooms ?? [], roomSignatures)
  return {
    floor: { ...after, rooms },
    assignments: assignments.map(assignment => {
      const { target } = assignment
      if ((target.type !== 'room-floor' && target.type !== 'ceiling') || target.floorId !== after.id || !target.roomSignature) return assignment
      const roomSignature = roomSignatures.get(target.roomSignature)
      return roomSignature ? { ...assignment, target: { ...target, roomSignature } } : assignment
    }),
  }
}
