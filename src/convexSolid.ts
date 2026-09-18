/** Convex half-space solids used for roof closures. Plane interiors are >= 0.
 * Keeping the cells (not just their visible triangles) lets wall ownership,
 * openings and adjoining roof voids use exactly the same geometry. */
export type SolidPoint = [number, number, number]
export type SolidPlane = [number, number, number, number]
export type SolidFace = { points: SolidPoint[]; plane: SolidPlane; tag: string }
export type ConvexSolid = { faces: SolidFace[]; planes: SolidPlane[] }
const EPS = 1e-8

export function planeDistance(plane: SolidPlane, point: SolidPoint) {
  return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3]
}
export function oppositePlane(plane: SolidPlane): SolidPlane {
  return plane.map(value => -value) as SolidPlane
}
function cross(a: SolidPoint, b: SolidPoint): SolidPoint {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function delta(a: SolidPoint, b: SolidPoint): SolidPoint {
  return a.map((value, index) => value - b[index]) as SolidPoint
}
export function solidPolygonArea(points: SolidPoint[]) {
  let area = 0
  for (let i = 1; i + 1 < points.length; i++) {
    area += Math.hypot(...cross(delta(points[i], points[0]), delta(points[i + 1], points[0]))) / 2
  }
  return area
}
export function clipSolidPolygon(points: SolidPoint[], plane: SolidPlane) {
  const result: SolidPoint[] = []
  points.forEach((b, index) => {
    const a = points[(index + points.length - 1) % points.length]
    const da = planeDistance(plane, a), db = planeDistance(plane, b)
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db)
      result.push(a.map((value, axis) => value + (b[axis] - value) * t) as SolidPoint)
    }
    if (db >= -EPS) result.push(b)
  })
  const clean = result.filter((p, i) => Math.hypot(...delta(p, result[(i + result.length - 1) % result.length])) > EPS)
  return solidPolygonArea(clean) > EPS * EPS ? clean : []
}

function orderedCap(points: SolidPoint[], plane: SolidPlane) {
  const unique = points.filter((point, index) => !points.slice(0, index).some(other => Math.hypot(...delta(point, other)) < EPS))
  if (unique.length < 3) return []
  const center = [0, 1, 2].map(axis => unique.reduce((sum, point) => sum + point[axis], 0) / unique.length) as SolidPoint
  const n = plane.slice(0, 3).map(value => -value) as SolidPoint
  const u = delta(unique[0], center), v = cross(n, u)
  const dot = (a: SolidPoint, b: SolidPoint) => a.reduce((sum, value, axis) => sum + value * b[axis], 0)
  const ul = Math.hypot(...u), vl = Math.hypot(...v)
  unique.sort((a, b) => Math.atan2(dot(delta(a, center), v) / vl, dot(delta(a, center), u) / ul) -
    Math.atan2(dot(delta(b, center), v) / vl, dot(delta(b, center), u) / ul))
  return unique
}

export function intersectSolid(solid: ConvexSolid, plane: SolidPlane, tag: string): ConvexSolid | null {
  const distances = solid.faces.flatMap(face => face.points.map(point => planeDistance(plane, point)))
  if (distances.every(distance => distance >= -EPS)) return solid
  if (!distances.some(distance => distance > EPS)) return null
  const faces = solid.faces.map(face => ({ ...face, points: clipSolidPolygon(face.points, plane) }))
    .filter(face => face.points.length)
  const cap = orderedCap(faces.flatMap(face => face.points.filter(point => Math.abs(planeDistance(plane, point)) < EPS * 10)), plane)
  if (solidPolygonArea(cap) > EPS * EPS) faces.push({ points: cap, plane, tag })
  return { faces, planes: [...solid.planes, plane] }
}

export function subtractSolid(solid: ConvexSolid, planes: SolidPlane[], tag: string): ConvexSolid[] {
  // Reject before splitting: a remote cutter must not subdivide this solid.
  let intersection: ConvexSolid | null = solid
  for (const plane of planes) {
    intersection = intersectSolid(intersection, plane, tag)
    if (!intersection) return [solid]
  }
  const outside: ConvexSolid[] = []
  let remaining: ConvexSolid | null = solid
  for (const plane of planes) {
    const part = intersectSolid(remaining, oppositePlane(plane), tag)
    if (part) outside.push(part)
    remaining = intersectSolid(remaining, plane, tag)
    if (!remaining) break
  }
  return outside
}

export function prismSolid(polygon: { x: number; y: number }[], bottom: number, top: number, tag: string): ConvexSolid {
  const signedArea = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    return sum + p.x * q.y - q.x * p.y
  }, 0)
  const ring = signedArea > 0 ? polygon : [...polygon].reverse()
  const low = ring.map((p): SolidPoint => [p.x, bottom, p.y])
  const high = ring.map((p): SolidPoint => [p.x, top, p.y])
  const faces: SolidFace[] = [
    { points: low, plane: [0, 1, 0, -bottom], tag },
    { points: [...high].reverse(), plane: [0, -1, 0, top], tag },
    ...ring.map((p, i): SolidFace => {
      const j = (i + 1) % ring.length, q = ring[j]
      const length = Math.hypot(q.x - p.x, q.y - p.y)
      const nx = -(q.y - p.y) / length, nz = (q.x - p.x) / length
      return { points: [low[i], high[i], high[j], low[j]], plane: [nx, 0, nz, -nx * p.x - nz * p.y], tag }
    }),
  ]
  return { faces, planes: faces.map(face => face.plane) }
}

/** Remove internal cell boundaries. Same-facing coincident faces have one
 * owner; opposite faces on a shared partition are internal on both sides. */
export function solidBoundaryFaces(solids: ConvexSolid[]): SolidFace[] {
  return solids.flatMap((solid, index) => solid.faces.flatMap(face => {
    let pieces = [face.points]
    for (let j = 0; j < solids.length && pieces.length; j++) {
      if (j === index) continue
      const other = solids[j]
      const sameFacing = other.faces.some(otherFace => otherFace.plane.every((v, axis) => Math.abs(v - face.plane[axis]) < EPS))
      if (sameFacing && j > index) continue
      pieces = pieces.flatMap(piece => subtractSolidPolygon(piece, other.planes))
    }
    return pieces.map(points => ({ ...face, points }))
  }))
}

export function subtractSolidPolygon(points: SolidPoint[], planes: SolidPlane[]): SolidPoint[][] {
  if (planes.some(plane => points.every(point => planeDistance(plane, point) < -EPS))) return [points]
  let inside = points
  for (const plane of planes) inside = clipSolidPolygon(inside, plane)
  if (!inside.length) return [points]
  const outside: SolidPoint[][] = []
  inside = points
  for (const plane of planes) {
    if (inside.every(point => planeDistance(plane, point) >= -EPS)) continue
    const part = clipSolidPolygon(inside, oppositePlane(plane))
    if (part.length) outside.push(part)
    inside = clipSolidPolygon(inside, plane)
    if (!inside.length) break
  }
  return outside
}
