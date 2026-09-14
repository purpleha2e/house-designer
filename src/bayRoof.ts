import type { Point, RoofStructure, Wall } from './types.ts'

const EPS = 1e-8
type Vertex = [number, number, number]
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export function getBayOutline(points: Point[]): Point[] {
  const sorted = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > EPS)
  if (sorted.length < 3) return []
  const half = (input: Point[]) => {
    const result: Point[] = []
    for (const p of input) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, p) <= EPS) result.pop()
      result.push(p)
    }
    return result.slice(0, -1)
  }
  const outline = [...half(sorted), ...half([...sorted].reverse())]
  return outline.length >= 3 ? outline : []
}

export function createBayRoofLayout(points: Point[]) {
  const outline = getBayOutline(points)
  if (points.length < 3 || outline.length < 3 || outline.length > 64) return null
  const matches = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < EPS
  const rearEdge = outline.findIndex((a, i) => {
    const b = outline[(i + 1) % outline.length]
    return (matches(a, points[0]) && matches(b, points[1])) || (matches(a, points[1]) && matches(b, points[0]))
  })
  if (rearEdge < 0) return null
  const ordered = [...outline.slice(rearEdge), ...outline.slice(0, rearEdge)]
  const [a, b] = ordered
  const rotation = -Math.atan2(b.y - a.y, b.x - a.x)
  const c = Math.cos(rotation), s = Math.sin(rotation)
  const local = ordered.map((p) => ({ x: (p.x - a.x) * c - (p.y - a.y) * s, y: (p.x - a.x) * s + (p.y - a.y) * c }))
  const minX = Math.min(...local.map((p) => p.x)), maxX = Math.max(...local.map((p) => p.x))
  const minY = Math.min(...local.map((p) => p.y)), maxY = Math.max(...local.map((p) => p.y))
  const width = maxX - minX, depth = maxY - minY
  if (width < 0.3 || depth < 0.3) return null
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2
  const position = { x: a.x + x * c + y * s, y: a.y - x * s + y * c }
  return { position, supportPosition: position, width, depth, supportWidth: width, supportDepth: depth, rotation,
    bayOutline: local.map((p) => ({ x: (p.x - x) / width, y: (p.y - y) / depth })),
  }
}

export function normalizeBayOutline(value: unknown): Point[] | undefined {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64 ||
    !value.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 0.500001 && Math.abs(p.y) <= 0.500001)) return undefined
  if (Math.abs(value[0].y - value[1].y) > EPS || value[1].x <= value[0].x) return undefined
  // Every other vertex must lie strictly inside each directed edge. This also
  // rejects self-intersecting outlines, which a turn-only check would accept.
  if (value.some((p, i) => value.some((q, j) => j !== i && j !== (i + 1) % value.length &&
    cross(p, value[(i + 1) % value.length], q) <= EPS))) return undefined
  return value.map(({ x, y }) => ({ x, y }))
}

function getBayMountPolygon(roof: RoofStructure): Point[] {
  const outline = normalizeBayOutline(roof.bayOutline) ?? [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]
  return outline.map((p) => ({ x: p.x * (roof.supportWidth ?? roof.width), y: p.y * (roof.supportDepth ?? roof.depth) }))
}

export function getBaySupportPolygon(roof: RoofStructure): Point[] {
  const points = getBayMountPolygon(roof)
  return roof.baySupportOffsets?.length === points.length
    ? offsetBayPolygon(points, roof.baySupportOffsets) : points
}

export function getBayRoofWithWallSupport(roof: RoofStructure, walls: Wall[]): RoofStructure {
  const points = getBayMountPolygon(roof), origin = roof.supportPosition ?? roof.position
  const c = Math.cos(roof.rotation), s = Math.sin(roof.rotation)
  const local = (p: Point) => ({ x: (p.x - origin.x) * c - (p.y - origin.y) * s,
    y: (p.x - origin.x) * s + (p.y - origin.y) * c })
  const offsets = points.map((a, i) => {
    if (i === 0) return 0 // Keep the mounting line against the house.
    const b = points[(i + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
    let offset = 0
    for (const wall of walls) {
      if (wall.kind !== 'external') continue
      const start = local(wall.start), end = local(wall.end)
      const distance = (p: Point) => (p.x - a.x) * uy - (p.y - a.y) * ux
      const d1 = distance(start), d2 = distance(end)
      if (Math.abs(d1 - d2) > 0.001 || Math.abs(d1) > wall.thickness / 2 + 0.001) continue
      const t1 = (start.x - a.x) * ux + (start.y - a.y) * uy
      const t2 = (end.x - a.x) * ux + (end.y - a.y) * uy
      if (Math.min(length, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) <= 0.01) continue
      offset = Math.max(offset, d1 + wall.thickness / 2)
    }
    return offset
  })
  return { ...roof, baySupportOffsets: offsets }
}

// Offset convex edges independently, keeping the attachment edge flush.
export function offsetBayPolygon(points: Point[], distances: number[]): Point[] {
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % points.length], length = Math.hypot(q.x - p.x, q.y - p.y)
    const nx = -(q.y - p.y) / length, ny = (q.x - p.x) / length
    return { nx, ny, d: nx * p.x + ny * p.y - distances[i] }
  })
  return lines.map((b, i) => {
    const a = lines[(i + lines.length - 1) % lines.length], det = a.nx * b.ny - a.ny * b.nx
    return { x: (a.d * b.ny - a.ny * b.d) / det, y: (a.nx * b.d - a.d * b.nx) / det }
  })
}

export function getBayRoofPolygon(roof: RoofStructure) {
  const support = getBaySupportPolygon(roof)
  return offsetBayPolygon(support, support.map((_, i) => i === 0 ? 0 : Math.max(0, roof.overhangSide ?? 0)))
}

export function buildBayRoofFaces(roof: RoofStructure): Vertex[][] {
  const support = getBaySupportPolygon(roof), outer = getBayRoofPolygon(roof)
  const slope = Math.tan(Math.max(1, Math.min(75, roof.pitchDegrees)) * Math.PI / 180)
  const eaveSlope = Math.tan(Math.max(0, Math.min(75, roof.overhangPitchDegrees ?? roof.pitchDegrees)) * Math.PI / 180)
  const mounts = getBayMountPolygon(roof)
  const apex = { x: (mounts[0].x + mounts[1].x) / 2, y: (mounts[0].y + mounts[1].y) / 2 }
  const distances = support.slice(1).map((a, i) => {
    const b = support[(i + 2) % support.length]
    return Math.abs(cross(a, b, apex)) / Math.hypot(b.x - a.x, b.y - a.y)
  })
  const height = Math.min(...distances) * slope
  return support.slice(1).flatMap((a, i): Vertex[][] => {
    const index = i + 1, next = (index + 1) % support.length, b = support[next]
    const overhang = Math.max(0, roof.overhangSide ?? 0)
    const outerHeight = -overhang * eaveSlope
    return [
      [[apex.x, height, apex.y], [a.x, 0, a.y], [b.x, 0, b.y]],
      ...(overhang > 0 ? [[[a.x, 0, a.y], [outer[index].x, outerHeight, outer[index].y],
        [outer[next].x, outerHeight, outer[next].y], [b.x, 0, b.y]] as Vertex[]] : []),
    ]
  })
}
