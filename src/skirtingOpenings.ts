import type { Point } from './types.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'

/** Stop wall skirting where its footprint overhangs a stair void. Test both
 * sides of the board, so a cutout touching the wall face is included too. */
export function clipSkirtingAtOpenings<T extends { start: Point; end: Point; chamferStart?: boolean; chamferEnd?: boolean }>(
  segments: T[], openings: Point[][], inward: Point, depth = .018,
): T[] {
  return segments.flatMap(segment => {
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y
    const cuts = [0, 1], length = Math.hypot(dx, dy)
    if (length < 1e-8) return []
    const offsets = [.0001, depth]
    for (const offset of offsets) for (const polygon of openings) {
      const origin = { x: segment.start.x + inward.x * offset, y: segment.start.y + inward.y * offset }
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], ex = b.x - a.x, ey = b.y - a.y
        const cross = dx * ey - dy * ex
        if (Math.abs(cross) < 1e-10) continue
        const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / cross
        const u = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / cross
        if (t > 0 && t < 1 && u >= -1e-8 && u <= 1 + 1e-8) cuts.push(t)
      }
    }
    cuts.sort((a, b) => a - b)
    const result: T[] = [], point = (t: number) => ({ x: segment.start.x + dx * t, y: segment.start.y + dy * t })
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i], mid = point((from + to) / 2)
      if ((to - from) * length < 1e-6 || offsets.some(offset => openings.some(polygon => pointIsInsideRoomPolygon(
        { x: mid.x + inward.x * offset, y: mid.y + inward.y * offset }, polygon)))) continue
      const previous = result.at(-1)
      if (previous && Math.hypot(previous.end.x - point(from).x, previous.end.y - point(from).y) < 1e-7) {
        previous.end = point(to); previous.chamferEnd = to < 1 || segment.chamferEnd
      } else result.push({ ...segment, start: point(from), end: point(to),
        chamferStart: from > 0 || segment.chamferStart, chamferEnd: to < 1 || segment.chamferEnd })
    }
    return result
  })
}
