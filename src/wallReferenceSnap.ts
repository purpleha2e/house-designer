import type { Point, Wall } from './types.ts'

/** Align a translated wall's centre line without changing its length or its
 * position along the reference wall. All connected endpoints use this delta. */
export function snapWallTranslationToReferences(moving: Pick<Wall, 'start' | 'end'>[], delta: Point,
  references: Wall[], tolerance: number) {
  let best: { delta: Point; reference: Wall; point: Point; distance: number } | null = null
  for (const wall of moving) {
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy)
    if (length < 1e-6) continue
    for (const reference of references) {
      const rx = reference.end.x - reference.start.x, ry = reference.end.y - reference.start.y, rl = Math.hypot(rx, ry)
      if (rl < 1e-6 || Math.abs(dx * ry - dy * rx) / (length * rl) > 1e-5) continue
      const ux = rx / rl, uy = ry / rl
      const a = { x: wall.start.x + delta.x - reference.start.x, y: wall.start.y + delta.y - reference.start.y }
      const b = { x: wall.end.x + delta.x - reference.start.x, y: wall.end.y + delta.y - reference.start.y }
      const aa = a.x * ux + a.y * uy, bb = b.x * ux + b.y * uy
      if (Math.min(Math.max(aa, bb), rl) - Math.max(Math.min(aa, bb), 0) < .01) continue
      const offset = -a.x * uy + a.y * ux, distance = Math.abs(offset)
      if (distance > tolerance || (best && distance >= best.distance)) continue
      const corrected = { x: delta.x + uy * offset, y: delta.y - ux * offset }
      best = { delta: corrected, reference, distance,
        point: { x: (wall.start.x + wall.end.x) / 2 + corrected.x, y: (wall.start.y + wall.end.y) / 2 + corrected.y } }
    }
  }
  return best
}
