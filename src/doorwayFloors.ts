import type { Point, Wall } from './types.ts'
import { subtractPlanCutouts, type PlanCutout, type PlanFootprint } from './planarCutouts.ts'

type RoomFloor = { signature: string; polygon: Point[] }
export type DoorwayFloorPatch = PlanFootprint & { roomSignature: string; wallId: string; openingId: string }
export const doorwayFloorKey = (wallId: string, openingId: string) => `${wallId}:${openingId}`

function contains(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Extend each adjoining floor to the centre of an interior doorway, without overlapping existing floors. */
export function buildDoorwayFloorPatches(walls: Wall[], rooms: RoomFloor[], openings: PlanCutout[] = []) {
  const patches: DoorwayFloorPatch[] = []
  const replacedPortals = new Set<string>()
  const covered: PlanCutout[] = [...rooms.map(room => room.polygon), ...openings]
  for (const wall of walls) {
    if (wall.kind !== 'internal') continue
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    if (length < 1e-6) continue
    const dx = (wall.end.x - wall.start.x) / length, dy = (wall.end.y - wall.start.y) / length
    const point = (along: number, across: number): Point => ({
      x: wall.start.x + dx * along - dy * across,
      y: wall.start.y + dy * along + dx * across,
    })
    for (const opening of wall.openings ?? []) {
      if (opening.bottom > 0.05 || opening.height <= 0) continue
      const start = Math.max(0, opening.center - opening.width / 2)
      const end = Math.min(length, opening.center + opening.width / 2)
      if (end - start < 1e-6) continue
      const adjoining = [-1, 1].map(side => {
        for (const inset of [0.01, 0.04, 0.12]) {
          const probe = point((start + end) / 2, side * (wall.thickness / 2 + inset))
          const room = rooms.find(candidate => contains(probe, candidate.polygon))
          if (room) return room
        }
        return undefined
      })
      if (!adjoining[0] && !adjoining[1]) continue
      replacedPortals.add(doorwayFloorKey(wall.id, opening.id))
      for (const [index, side] of [-1, 1].entries()) {
        const room = adjoining[index] ?? adjoining[1 - index]!
        const half = [point(start, 0), point(end, 0),
          point(end, side * wall.thickness / 2), point(start, side * wall.thickness / 2)]
        const uncovered = subtractPlanCutouts(half, covered)
        covered.push(...uncovered)
        patches.push(...uncovered.map(patch => ({ ...patch, roomSignature: room.signature,
          wallId: wall.id, openingId: opening.id })))
      }
    }
  }
  return { patches, replacedPortals }
}
