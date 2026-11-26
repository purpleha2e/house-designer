import { exitClearance, getRoomWindows, minimumRoomArea } from './layoutValidation.ts'
import { covers, polygon } from './planGeometry.ts'
import { findRedesignDoor, excludedFacadeWalls, openingConnections, type RedesignGeometry, type RedesignOperation, type RedesignSpace } from './roomRedesign.ts'
import type { SceneFloor, SceneSource } from './scene.ts'
import type { Requirements } from './intent.ts'
import type { RoomRedesign } from './proposal.ts'

export type ExistingRoomBrief = { bedrooms: number; ensuites: number; leftBathroomWindows: boolean }
type Suite = { bedroomId: string; bathroomId: string; operations: RedesignOperation[] }

function* choose<T>(items: T[], count: number, start = 0): Generator<T[]> {
  if (count === 0) { yield []; return }
  for (let index = start; index <= items.length - count; index++) {
    for (const rest of choose(items, count - 1, index + 1)) yield [items[index], ...rest]
  }
}

/** Consider existing enclosed rooms first. Every candidate is checked again by the native proposal validator. */
export function* existingRoomPlans(source: SceneSource, floor: SceneFloor, geometry: RedesignGeometry, rooms: RedesignSpace[],
  brief: ExistingRoomBrief, nextId: () => string): Generator<{ schedule: RoomRedesign; operations: RedesignOperation[] }> {
  const minimumRooms = brief.bedrooms + brief.ensuites + (brief.bedrooms > brief.ensuites ? 2 : 1)
  if (brief.ensuites > brief.bedrooms || rooms.length < minimumRooms || rooms.length > 12 || floor.stairsFromBelow.length !== 1) return
  const [stair] = floor.stairsFromBelow
  const stairAreas = [...stair.openings, exitClearance(stair)].map(polygon)
  const landing = rooms.find(room => stairAreas.every(region => covers(polygon(room.polygon), region, 0.018)))
  if (!landing) return
  const requirements: Requirements = { bedrooms: brief.bedrooms, bathrooms: 1, landing: 'standard', bathroom: 'standard',
    primaryBedroom: 'standard', oppositeBedroom: null }
  const links = openingConnections(geometry.walls, rooms)
  const linksFor = (roomId: string) => links.flatMap(link => link.from === roomId ? [{ link, other: link.to }] :
    link.to === roomId ? [{ link, other: link.from }] : [])
  const direct = (roomId: string) => linksFor(roomId).some(entry => entry.other === landing.id)
  const windows = new Map(rooms.map(room => [room.id, getRoomWindows(room.polygon, floor)]))
  const leftWalls = brief.leftBathroomWindows ? new Set(excludedFacadeWalls(floor, 'left')) : new Set<string>()
  const leftWindows = floor.openings.filter(opening => opening.kind === 'window' && leftWalls.has(opening.wallId))
  const candidates = rooms.filter(room => room.id !== landing.id)
  const bedrooms = candidates.filter(room => direct(room.id) && !!windows.get(room.id)?.length &&
    room.area >= minimumRoomArea('bedroom', requirements)).sort((left, right) => right.area - left.area)
  const bathrooms = candidates.filter(room => room.area >= minimumRoomArea('bathroom', requirements)).sort((left, right) => left.area - right.area)
  const pairs = new Map<string, Suite[]>()
  for (const bedroom of bedrooms) {
    const options: Suite[] = []
    for (const bathroom of bathrooms) {
      if (bathroom.id === bedroom.id) continue
      const entrances = linksFor(bathroom.id)
      if (entrances.some(entry => entry.other !== bedroom.id && entry.other !== landing.id)) continue
      const operations: RedesignOperation[] = entrances.filter(entry => entry.other === landing.id)
        .map(({ link }) => ({ type: 'remove-opening', openingId: link.openingId }))
      if (!entrances.some(entry => entry.other === bedroom.id)) {
        const door = findRedesignDoor(source, floor, geometry.walls, rooms, bedroom, bathroom, nextId)
        if (!door) continue
        operations.push(door)
      }
      options.push({ bedroomId: bedroom.id, bathroomId: bathroom.id, operations })
    }
    pairs.set(bedroom.id, options.sort((left, right) => left.operations.length - right.operations.length))
  }
  for (const selected of choose(bedrooms, brief.bedrooms)) {
    const bedroomIds = selected.map(room => room.id)
    const available = bedroomIds.flatMap(id => pairs.get(id) ?? []).filter(pair => !bedroomIds.includes(pair.bathroomId))
    for (const suites of choose(available, brief.ensuites)) {
      const suiteIds = suites.map(pair => pair.bathroomId)
      if (new Set(suites.map(pair => pair.bedroomId)).size !== suites.length || new Set(suiteIds).size !== suites.length) continue
      const sharedRooms = brief.bedrooms > brief.ensuites
        ? bathrooms.filter(room => direct(room.id) && !bedroomIds.includes(room.id) && !suiteIds.includes(room.id)).map(room => room.id) : [null]
      for (const sharedBathroomId of sharedRooms) {
        const bathroomWindows = new Set([...suiteIds, sharedBathroomId].flatMap(id => id ? (windows.get(id) ?? []) : []))
        if (leftWindows.some(opening => !bathroomWindows.has(opening.id))) continue
        yield { schedule: { landingId: landing.id, bedroomIds, sharedBathroomId, ensuites: suites.map(({ bedroomId, bathroomId }) => ({ bedroomId, bathroomId })) },
          operations: suites.flatMap(pair => pair.operations) }
      }
    }
  }
}
