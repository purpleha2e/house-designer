import type { Point, Wall } from '../types.ts'
import type { WallMeshFace, WallMeshVertex } from './wallMesh.ts'

type Position = WallMeshVertex['position']

/** A new contact may subdivide a painted region without changing its finish. */
export function isRoofRegionSubdivision(faceId: string, parentId: string) {
  const marker = ':roof-region:'
  const [parentBase, parentRegion] = parentId.split(marker)
  const [faceBase, faceRegion] = faceId.split(marker)
  if (!parentRegion || !faceRegion || parentBase !== faceBase || parentRegion === 'outside') return false
  const parts = new Set(faceRegion.split('/').filter(Boolean))
  return parentRegion.split('/').filter(Boolean).every(part => parts.has(part))
}
const EPS = 1e-7
export type WallRoofSurfaceDivider = {
  id: string
  wallId: string
  normal: [number, number]
  start: Position
  end: Position
  /** Fractions of the contact backed by the lower building, excluding open overhangs. */
  enclosedSpans?: [number, number][]
}

/** Contact lines on the outside facade, including the profile hidden inside an adjoining roof shell. */
export function createWallRoofSurfaceDividers(
  roofId: string, roofFaces: Position[][], walls: Wall[], floorElevation: number,
  wallBounds?: ReadonlyMap<string, { bottom: number; top: number }>,
  supportPolygon?: Point[],
  enclosedFootprints?: Point[][],
) {
  return walls.flatMap((wall) => {
    const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dz)
    if (length < EPS) return []
    const nx = -dz / length, nz = dx / length
    const dividers: WallRoofSurfaceDivider[] = []
    for (const sign of [-1, 1]) {
      const distance = ([x, , z]: Position) =>
        (x - wall.start.x) * nx * sign + (z - wall.start.y) * nz * sign - wall.thickness / 2
      const along = ([x, , z]: Position) => (x - wall.start.x) * dx / length + (z - wall.start.y) * dz / length
      for (const face of roofFaces) {
        // Only panels on this side of the facade can divide its finish.
        if (!face.some(p => distance(p) > EPS)) continue
        const points: Position[] = []
        face.forEach((b, index) => {
          const a = face[(index + face.length - 1) % face.length]
          const da = distance(a), db = distance(b)
          if (Math.abs(db) <= EPS) points.push(b)
          if (da * db < -EPS * EPS) points.push(a.map((v, i) => v + (b[i] - v) * da / (da - db)) as Position)
        })
        points.sort((a, b) => along(a) - along(b))
        const start = points[0], end = points.at(-1)
        if (!start || !end || along(end) - along(start) < EPS) continue
        if (along(end) < -wall.thickness || along(start) > length + wall.thickness) continue
        const bounds = wallBounds?.get(wall.id) ?? { bottom: 0, top: wall.height }
        if (Math.max(start[1], end[1]) <= floorElevation + bounds.bottom + EPS ||
          Math.min(start[1], end[1]) >= floorElevation + bounds.top - EPS) continue
        dividers.push({ id: '', wallId: wall.id, normal: [nx * sign, nz * sign], start, end })
      }
    }
    // Roof order and unrelated roof edits must not change the saved region IDs.
    dividers.sort((a, b) => a.normal[0] - b.normal[0] || a.normal[1] - b.normal[1] ||
      a.start[0] - b.start[0] || a.start[2] - b.start[2] || a.start[1] - b.start[1])
    return dividers.filter((d, i) => !dividers.slice(0, i).some(other =>
      [...d.start, ...d.end].every((v, j) => Math.abs(v - [...other.start, ...other.end][j]) < EPS)))
      .map((d, index) => ({ ...d, id: `${roofId}:${index}` }))
      // Junction panels can extend through an abutting wall to meet another
      // roof. Only the side facing the roof's support footprint gets a finish
      // boundary. Filter after numbering to preserve saved exterior face IDs.
      .filter(d => !supportPolygon?.length || supportReachesSide(d, supportPolygon))
      .map(d => enclosedFootprints === undefined ? d : {
        ...d, enclosedSpans: enclosedContactSpans(d, enclosedFootprints),
      })
  })
}

// Sample just outside the facade so its own wall body cannot turn an open
// canopy into an interior. The filled floor footprint includes the actual
// enclosing wall thickness, unlike the roof support rectangle or its overhang.
function enclosedContactSpans(d: WallRoofSurfaceDivider, footprints: Point[][]): [number, number][] {
  const start = { x: d.start[0] + d.normal[0] * 0.002, y: d.start[2] + d.normal[1] * 0.002 }
  const dx = d.end[0] - d.start[0], dz = d.end[2] - d.start[2], length2 = dx * dx + dz * dz
  const cuts = [0, 1]
  for (const polygon of footprints) polygon.forEach((b, i) => {
    const a = polygon[(i + polygon.length - 1) % polygon.length]
    const da = (a.x - start.x) * dz - (a.y - start.y) * dx
    const db = (b.x - start.x) * dz - (b.y - start.y) * dx
    if ((da > 0) === (db > 0)) return
    const fraction = da / (da - db)
    const t = ((a.x + fraction * (b.x - a.x) - start.x) * dx +
      (a.y + fraction * (b.y - a.y) - start.y) * dz) / length2
    if (t > EPS && t < 1 - EPS) cuts.push(t)
  })
  cuts.sort((a, b) => a - b)
  const contains = (polygon: Point[], t: number) => {
    const x = start.x + t * dx, z = start.y + t * dz
    let inside = false
    polygon.forEach((b, i) => {
      const a = polygon[(i + polygon.length - 1) % polygon.length]
      if ((a.y > z) !== (b.y > z) && x < (b.x - a.x) * (z - a.y) / (b.y - a.y) + a.x) inside = !inside
    })
    return inside
  }
  const spans: [number, number][] = []
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i]
    if (b - a <= EPS || !footprints.some(polygon => contains(polygon, (a + b) / 2))) continue
    if (spans.length && Math.abs(spans.at(-1)![1] - a) < EPS) spans.at(-1)![1] = b
    else spans.push([a, b])
  }
  return spans
}

function supportReachesSide(divider: WallRoofSurfaceDivider, polygon: Point[]) {
  const dx = divider.end[0] - divider.start[0], dz = divider.end[2] - divider.start[2]
  const length2 = dx * dx + dz * dz
  const along = ([x, , z]: Position) =>
    ((x - divider.start[0]) * dx + (z - divider.start[2]) * dz) / length2
  const vertices: WallMeshVertex[] = polygon.map(p => ({ position: [p.x, 0, p.y], uv: [0, 0] }))
  const localSupport = clip(clip(vertices, along), p => 1 - along(p))
  return hasArea(localSupport) && localSupport.some(({ position: [x, , z] }) =>
    (x - divider.start[0]) * divider.normal[0] +
    (z - divider.start[2]) * divider.normal[1] > EPS)
}

function clip(vertices: WallMeshVertex[], plane: (p: Position) => number) {
  const result: WallMeshVertex[] = []
  vertices.forEach((b, index) => {
    const a = vertices[(index + vertices.length - 1) % vertices.length]
    const da = plane(a.position), db = plane(b.position)
    if (da * db < -EPS * EPS) {
      const t = da / (da - db)
      result.push({ position: a.position.map((v, i) => v + (b.position[i] - v) * t) as Position,
        uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t) as [number, number] })
    }
    if (db >= -EPS) result.push(b)
  })
  return result
}

function hasArea(vertices: WallMeshVertex[]) {
  if (vertices.length < 3) return false
  const a = vertices[0].position
  return vertices.slice(1, -1).some((b, i) => {
    const c = vertices[i + 2].position
    const u = b.position.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j])
    return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) > EPS
  })
}

function selectionRegion(region: string) {
  // Panels of one roof meet at a ridge, but do not divide the wall beneath
  // them into different finishes. Keep panel-specific paths in faceId for
  // saved assignments; group connected covered faces by their owning roofs.
  const coveredRoofs = region.split('/').filter(part => part.endsWith(':below'))
    .map(part => part.slice(0, -':below'.length))
    .map(dividerId => dividerId.slice(0, dividerId.lastIndexOf(':')))
  return coveredRoofs.length
    ? [...new Set(coveredRoofs)].sort().map(id => `${id}:below`).join('/')
    : 'roof-exposed'
}

/** Partition materials without removing the weatherproof wall behind a roof. */
export function partitionWallFacesAtRoofs(
  faces: WallMeshFace[], dividers: WallRoofSurfaceDivider[], floorElevation: number,
): WallMeshFace[] {
  if (!dividers.length) return faces
  return faces.flatMap(face => {
    if (face.kind !== 'side' || face.roomSignature) return [face]
    const applicable = dividers.filter(d => d.wallId === face.wallId &&
      d.normal[0] * face.normal[0] + d.normal[1] * face.normal[2] > 0.99)
      .sort((a, b) => a.id.localeCompare(b.id))
    if (!applicable.length) return [face]
    let parts = [{ vertices: [...face.vertices], region: '' }]
    for (const d of applicable) {
      const dx = d.end[0] - d.start[0], dz = d.end[2] - d.start[2], length2 = dx*dx + dz*dz
      const t = ([x, , z]: Position) => ((x-d.start[0])*dx + (z-d.start[2])*dz) / length2
      const above = (p: Position) => p[1] + floorElevation - d.start[1] - t(p)*(d.end[1]-d.start[1])
      parts = parts.flatMap(part => {
        const inside = clip(clip(part.vertices, t), p => 1-t(p))
        if (!hasArea(inside)) return [part]
        const outside = [clip(part.vertices, p => -t(p)), clip(part.vertices, p => t(p)-1)]
        const below = clip(inside, p => -above(p))
        const covered: WallMeshVertex[][] = []
        let exposed = d.enclosedSpans === undefined ? [] : [below]
        if (d.enclosedSpans === undefined) covered.push(below)
        else for (const [start, end] of d.enclosedSpans) {
          exposed = exposed.flatMap(vertices => {
            covered.push(clip(clip(vertices, p => t(p) - start), p => end - t(p)))
            return [clip(vertices, p => start - t(p)), clip(vertices, p => t(p) - end)].filter(hasArea)
          })
        }
        return [
          ...outside.map((vertices, index) => ({ vertices,
            region: `${part.region}/${d.id}:${index === 0 ? 'before' : 'after'}` })),
          { vertices: clip(inside, above), region: `${part.region}/${d.id}:above` },
          ...covered.map(vertices => ({ vertices, region: `${part.region}/${d.id}:below` })),
          // Keep the saved exterior identity: these pieces connect to the
          // exposed facade above the contact, not to the room below the roof.
          ...exposed.map(vertices => ({ vertices, region: `${part.region}/${d.id}:above` })),
        ].filter(p => hasArea(p.vertices))
      })
    }
    return parts.flatMap(part => part.vertices.slice(1, -1).flatMap((v, index) => {
      const triangle = [part.vertices[0], v, part.vertices[index + 2]]
      if (!hasArea(triangle)) return []
      const region = part.region || 'outside'
      // Exposed pieces may join around an eave, but can never join the wall
      // behind the roof. Disconnected A regions remain separate components.
      return [{ ...face, roofSurfaceRegion: selectionRegion(region),
        faceId: `${face.faceId}:roof-region:${region}`,
        // A junction cap inherits the facade fragment in this roof region,
        // not the independently painted interior below the roof contact.
        materialSource: face.materialSource.fragmentId
          ? { ...face.materialSource, fragmentId: `${face.materialSource.fragmentId}:roof-region:${region}` }
          : face.materialSource,
        vertices: [...triangle, triangle[2]] as WallMeshFace['vertices'] }]
    }))
  })
}
