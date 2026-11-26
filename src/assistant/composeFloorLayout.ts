import type { Point, Wall, WallOpening } from '../types.ts'
import type { ToolArguments } from './architecturalTools.ts'
import { getRoomWindows } from './layoutValidation.ts'
import { distance, pointInPolygon, projection, transformedFrame } from './planGeometry.ts'
import type { Partition, RoomRedesign, WindowExclusion } from './proposal.ts'
import { createRedesignExteriorDoor, createRedesignWindow, detectRedesignSpaces, excludedFacadeWalls, findRedesignDoor, openingConnections, positionOnWall,
  rebuildRedesign, redesignScene, roomScheduleLabels, scheduledRoomEntrance, type RedesignOperation, type RedesignSpace } from './roomRedesign.ts'
import { ASSISTANT_WINDOW_MODEL, type SceneFloor, type SceneSource } from './scene.ts'

type Layout = ToolArguments<'compose_floor_layout'>
const fail = (error: string) => ({ error })
const point = ([x, y]: number[]): Point => ({ x, y })

export function isOpenFloor(floor: SceneFloor) {
  return floor.rooms.length === 1 && floor.footprint.length === 1 && floor.walls.length >= 3 && floor.walls.length <= 12 &&
    floor.walls.every(wall => wall.kind === 'external') && !floor.stairIds.length && !floor.stairsFromBelow.length
}

export function partitionSegments(walls: Layout['walls']) {
  const segments = walls.map(({ start, end }) => ({ start: point(start), end: point(end) }))
  return segments.flatMap(segment => {
    const frame = transformedFrame(Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x))
    const start = frame.local(segment.start), end = frame.local(segment.end)
    const cuts = new Set([start.x, end.x])
    for (const other of segments) {
      const a = frame.local(other.start), b = frame.local(other.end)
      if (Math.min(a.y, b.y) >= start.y - 0.002 || Math.max(a.y, b.y) <= start.y + 0.002) continue
      const x = a.x + (b.x - a.x) * (start.y - a.y) / (b.y - a.y)
      if (x > start.x + 0.002 && x < end.x - 0.002) cuts.add(x)
    }
    const interior = [...cuts].sort((a, b) => a - b).slice(1, -1).map(x => frame.world({ x, y: start.y }))
    const junctions = [segment.start, ...interior, segment.end]
    return junctions.slice(1).map((end, index) => ({ start: junctions[index], end }))
  })
}

export function windowForRoom(walls: Wall[], room: RedesignSpace, blocked: Set<string>, preferredWidth: number, nextId: () => string, focus?: Point) {
  let best: { wall: Wall; offset: number; width: number; height: number; gap: number } | undefined
  for (const wall of walls) {
    if (wall.kind !== 'external' || blocked.has(wall.id)) continue
    const length = distance(wall.start, wall.end)
    const offsets = room.polygon.map(vertex => projection(vertex, wall.start, wall.end).offset)
    const start = Math.max(0, Math.min(...offsets)), end = Math.min(length, Math.max(...offsets))
    const height = Math.min(1.15, wall.height - 0.95)
    const normal = { x: -(wall.end.y - wall.start.y) / length, y: (wall.end.x - wall.start.x) / length }
    const setback = wall.thickness / 2 + 0.035
    if (height < 0.35 || end - start < 0.75) continue
    for (const width of [Math.min(preferredWidth, end - start - 0.22), 0.65]) {
      for (const fraction of [0.5, 0.33, 0.67, 0.22, 0.78]) {
        const offset = start + (end - start) * fraction
        const margin = width / 2 + 0.1
        if (offset < start + margin || offset > end - margin ||
          wall.openings?.some(opening => Math.abs(opening.center - offset) < (opening.width + width) / 2 + 0.08)) continue
        const fits = [-setback, setback].some(side => [-margin, 0, margin].every(along => {
          const sample = positionOnWall(wall, offset + along)
          return pointInPolygon({ x: sample.x + normal.x * side, y: sample.y + normal.y * side }, room.polygon)
        }))
        if (!fits) continue
        if (!focus) return createRedesignWindow(wall, nextId(), offset, width, height, 0.9)
        const gap = distance(positionOnWall(wall, offset), focus)
        if (!best || gap < best.gap - 0.001 || Math.abs(gap - best.gap) <= 0.001 && width > best.width) {
          best = { wall, offset, width, height, gap }
        }
      }
    }
  }
  return best ? createRedesignWindow(best.wall, nextId(), best.offset, best.width, best.height, 0.9) : null
}

export function composeFloorLayout(source: SceneSource, floor: SceneFloor, args: Layout, nextId: () => string, exclusion?: WindowExclusion) {
  if (!isOpenFloor(floor)) return fail('Use this operation on an undivided floor with a closed exterior shell and no modeled stairs.')
  const walls = partitionSegments(args.walls).map(({ start, end }): Partition => ({
    type: 'create-partition', id: nextId(), start, end, thickness: source.partitionThickness, height: floor.roomHeight,
  }))
  const initial = rebuildRedesign(source, floor, walls)
  if (!initial.value) return fail(initial.error)
  const rooms = detectRedesignSpaces(floor, initial.value, [], nextId)
  const roomAt = (location: number[]) => rooms.find(room => pointInPolygon(point(location), room.polygon))?.id ?? ''
  const bedroomIds = args.bedrooms.map(roomAt)
  const kitchenId = args.kitchenDiner && roomAt(args.kitchenDiner)
  const utilityId = args.utility && roomAt(args.utility)
  const utilityAccess = args.design?.utilityAccess
  if (utilityAccess === 'kitchen' && (!kitchenId || !utilityId)) return fail('Provide both a kitchen/diner and a utility to connect them.')
  const schedule: RoomRedesign = {
    landingId: roomAt(args.hallway), bedroomIds,
    sharedBathroomId: args.familyBathroom && roomAt(args.familyBathroom),
    ensuites: args.ensuites.map(({ bedroom, bathroom }) => ({ bedroomId: bedroomIds[bedroom - 1] ?? '', bathroomId: roomAt(bathroom) })),
    home: { kitchenDinerId: kitchenId, utilityId, ...(utilityAccess && { utilityAccess }) },
  }
  const labels = roomScheduleLabels(schedule)
  if (rooms.length !== labels.length || new Set(labels.map(label => label.roomId)).size !== rooms.length ||
    labels.some(label => !label.roomId) || schedule.sharedBathroomId === '' || kitchenId === '' || utilityId === '' ||
    new Set(schedule.ensuites.map(suite => suite.bedroomId)).size !== schedule.ensuites.length || schedule.ensuites.some(suite => !suite.bedroomId)) {
    return fail(`The partitions formed ${rooms.length} rooms. Give each detected room one interior point and link each en suite to a different bedroom.`)
  }
  const ids = new Map(rooms.map(room => [room.id, room]))
  const suites = new Set(schedule.ensuites.map(suite => suite.bathroomId))
  const links = openingConnections(initial.value.walls, rooms)
  const workingWalls = initial.value.walls.slice()
  const operations: RedesignOperation[] = [...walls]
  const reserveOpening = (wallId: string, opening: WallOpening) => {
    const index = workingWalls.findIndex(wall => wall.id === wallId)
    const wall = workingWalls[index]
    workingWalls[index] = { ...wall, openings: [...(wall.openings ?? []), opening] }
  }
  for (const label of labels) {
    const id = label.roomId, entryId = scheduledRoomEntrance(schedule, id)
    if (id === entryId || links.some(link => (link.from === id && link.to === entryId) || (link.to === id && link.from === entryId))) continue
    const entry = ids.get(entryId)!, room = ids.get(id)!
    const door = findRedesignDoor(source, floor, workingWalls, rooms, entry, room, nextId) ??
      (suites.has(id) ? findRedesignDoor(source, floor, workingWalls, rooms, room, entry, nextId) : null)
    if (!door) {
      return fail(`${label.name} needs a doorway on a clear wall shared with ${labels.find(item => item.roomId === entryId)!.name.toLowerCase()}.`)
    }
    operations.push(door)
    const { id: openingId, offset: center, width, height } = door
    reserveOpening(door.wallId, { id: openingId, modelId: '', center, width, height, bottom: 0 })
  }
  for (const { kind, at } of args.exteriorDoors ?? []) {
    const location = point(at)
    const wall = workingWalls.find(item => item.kind === 'external' && projection(location, item.start, item.end).gap <= 0.04)
    const door = wall && createRedesignExteriorDoor(wall, rooms, projection(location, wall.start, wall.end).offset, kind, nextId(), source)
    if (!door || (kind === 'front' && door.roomId !== schedule.landingId)) {
      return fail(kind === 'front' ? 'Place the front door on a clear exterior wall of the hallway.' :
        'Place the patio door centre on a clear exterior wall of the room it serves.')
    }
    operations.push(door)
    reserveOpening(door.wallId, { id: door.id, modelId: '', center: door.offset, width: door.width, height: door.height, bottom: 0 })
  }
  const blocked = new Set(exclusion ? excludedFacadeWalls(floor, exclusion) : [])
  const focus = new Map(args.design?.windowFocus.map(({ room, at }) => [room, point(at)]))
  const focusFor = (id: string) => id === schedule.landingId ? focus.get('hallway') : id === kitchenId ? focus.get('kitchenDiner') : undefined
  const shouldHaveWindow = (id: string) => args.daylight.bedrooms && bedroomIds.includes(id) ||
    args.daylight.hallway && id === schedule.landingId || args.daylight.kitchenDiner && id === kitchenId || !!focusFor(id)
  for (const label of labels.filter(label => shouldHaveWindow(label.roomId))) {
    const room = ids.get(label.roomId)!
    if (getRoomWindows(room.polygon, floor).length) continue
    const preferredWidth = label.function === 'kitchen-diner' ? 1.85 : label.function === 'landing' ? 1.2 : 1.5
    const window = windowForRoom(workingWalls, room, blocked, preferredWidth, nextId, focusFor(room.id))
    if (!window) return fail(`${label.name} needs enough clear space against an allowed exterior wall for a window.`)
    operations.push(window)
    const { id, offset: center, width, height, bottom } = window
    reserveOpening(window.wallId, { id, modelId: ASSISTANT_WINDOW_MODEL, center, width, height, bottom })
  }
  const rebuilt = rebuildRedesign(source, floor, operations)
  if (!rebuilt.value) return fail(rebuilt.error)
  const editedFloor = redesignScene(floor, rebuilt.value)
  const unlit = labels.find(label => shouldHaveWindow(label.roomId) && !getRoomWindows(ids.get(label.roomId)!.polygon, editedFloor).length)
  if (unlit) return fail(`The editor could not confirm daylight for ${unlit.name.toLowerCase()}. Give it a clear exterior wall.`)
  return { geometry: rebuilt.value, rooms, schedule, operations }
}
