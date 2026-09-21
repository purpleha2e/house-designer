import type { Point, Wall } from './types'

export type ClosestWallFace = {
  side: 1 | -1
  wallId: string
}

export function findClosestWallFace(point: Point, walls: Wall[]): ClosestWallFace | null {
  let closest: { distanceSquared: number; side: 1 | -1; wallId: string } | null = null

  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 0.0000001) continue

    const amount = Math.max(0, Math.min(1,
      ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
        lengthSquared,
    ))
    const closestX = wall.start.x + dx * amount
    const closestY = wall.start.y + dy * amount
    const pointDx = point.x - closestX
    const pointDy = point.y - closestY
    const distanceSquared = pointDx * pointDx + pointDy * pointDy
    const cross = dx * (point.y - wall.start.y) - dy * (point.x - wall.start.x)
    const side = cross >= 0 ? 1 : -1

    if (!closest || distanceSquared < closest.distanceSquared) {
      closest = { distanceSquared, side, wallId: wall.id }
    }
  }

  return closest ? { side: closest.side, wallId: closest.wallId } : null
}
