import type { FloorLevel, Point } from './types.ts'
import type { WallMeshFace, WallMeshVertex } from './wallEngine/wallMesh.ts'
import { splitSlabFacadeEdge } from './slabFacadeSegments.ts'
import { ShapeUtils, Vector2 } from 'three'
import { resolvedRoofWallSegments } from './roofJunctions.ts'

type RoofFacadeContact = { floorId: string; wallId: string; faces: [number, number, number][][] }

export type FloorAssemblyEdge = {
  point: Point
  nextPoint: Point
  wallFloorId?: string
  wallFace?: WallMeshFace
  /** Keep the upper finish even when the lower wall owns the floor band. */
  upperWallFace?: WallMeshFace
}

export type FloorAssembly = {
  bottom: number
  top: number
  footprints: Point[][]
  edges: FloorAssemblyEdge[]
}

export type StoreyGeometry = {
  wallFaces: WallMeshFace[]
  footprints: Point[][]
  assembly?: FloorAssembly
}

type PreparedStorey = { floor: FloorLevel; faces: WallMeshFace[]; footprints: Point[][] }

function pointInOrOnPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared > 1e-12) {
      const t = Math.max(0, Math.min(1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
      if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) < 1e-6) return true
    }
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Continue a facade in its existing plane and UV frame. Keeping the source
 * face identity makes the floor zone part of the same paint/pick surface.
 * Roof partitioning runs AFTER this, so it also divides the continuation. */
function continueWallFace(face: WallMeshFace, point: Point, next: Point,
  bottom: number, top: number, elevation: number): WallMeshFace {
  const a = face.vertices[0]
  const b = face.vertices.find(v => Math.hypot(v.position[0] - a.position[0], v.position[2] - a.position[2]) > 1e-6)!
  const dx = b.position[0] - a.position[0], dz = b.position[2] - a.position[2]
  const uvAt = (p: Point) => a.uv[0] + (b.uv[0] - a.uv[0]) *
    ((p.x - a.position[0]) * dx + (p.y - a.position[2]) * dz) / (dx * dx + dz * dz)
  const vertex = (p: Point, y: number): WallMeshVertex => ({
    position: [p.x, y - elevation, p.y],
    uv: [uvAt(p), a.uv[1] + y - elevation - a.position[1]],
  })
  return { ...face, storeyBoundary: true,
    vertices: [vertex(point, bottom), vertex(next, bottom), vertex(next, top), vertex(point, top)] }
}

/** One owner for every storey boundary: walls own facade continuations;
 * horizontal assemblies own caps, openings and genuinely unsupported edges.
 * No upper storey means no intermediate floor, regardless of the saved depth.
 */
export function buildStoreyGeometry(storeys: PreparedStorey[], assemblyFloorIds?: ReadonlySet<string>, roofContacts: RoofFacadeContact[] = []): Map<string, StoreyGeometry> {
  const ordered = [...storeys].sort((a, b) => a.floor.elevation - b.floor.elevation)
  const result = new Map(ordered.map(s => [s.floor.id, { wallFaces: [...s.faces], footprints: s.footprints } as StoreyGeometry]))
  for (let i = 0; i < ordered.length - 1; i++) {
    const lower = ordered[i], upper = ordered[i + 1]
    if (assemblyFloorIds && !assemblyFloorIds.has(lower.floor.id)) continue
    const bottom = lower.floor.elevation + lower.floor.roomHeight
    const top = upper.floor.elevation
    if (top <= bottom + 1e-6) continue
    const capCover = upper.footprints.flatMap(polygon =>
      ShapeUtils.triangulateShape(polygon.map(p => new Vector2(p.x, p.y)), [])
        .map(triangle => triangle.map(index => polygon[index])))
    // The inter-storey assembly owns horizontal caps within the upper
    // footprint. Leaving the lower wall's top cap there creates a visible
    // ledge when a roof cutout removes part of the slab above it.
    result.get(lower.floor.id)!.wallFaces = result.get(lower.floor.id)!.wallFaces.map(face => {
      if (face.normal[1] < 0.99 ||
        !face.vertices.every(vertex => Math.abs(vertex.position[1] - lower.floor.roomHeight) < 1e-6)) return face
      // Roof cuts still need a closed source solid to construct their reveals.
      // Keep that source, then subtract the exact upper footprint at render
      // time. A cap triangle can straddle the footprint at a stepped corner.
      return { ...face, storeyCapCover: capCover }
    })
    // The same assembly also covers the underside of the upper walls. Wall
    // body perimeter meshes can otherwise emit one large horizontal bottom
    // cap across the whole storey; where a roof crosses this level that cap
    // becomes a visible strip through the roof junction.
    result.get(upper.floor.id)!.wallFaces = result.get(upper.floor.id)!.wallFaces.filter(face => {
      if (face.normal[1] > -0.99 ||
        !face.vertices.every(vertex => Math.abs(vertex.position[1]) < 1e-6)) return true
      return !upper.footprints.some(polygon => face.vertices.every(vertex =>
        pointInOrOnPolygon({ x: vertex.position[0], y: vertex.position[2] }, polygon)))
    })
    const edges = upper.footprints.flatMap(ring => ring.flatMap((point, j) =>
      splitSlabFacadeEdge({ point, nextPoint: ring[(j + 1) % ring.length],
        lowerFaces: lower.faces, lowerHeight: lower.floor.roomHeight - 0.0001,
        upperFaces: upper.faces, upperHeight: 0.0001,
        lowerFootprints: lower.footprints, upperFootprints: upper.footprints,
      }).map(({ point, nextPoint, lowerFace, upperFace }): FloorAssemblyEdge => {
        const face = lowerFace ?? upperFace
        const owner = lowerFace ? lower : upper
        // A custom-height wall may already occupy some or all of this zone.
        // Continue only beyond its actual top; never overlay an existing face.
        const continuationBottom = lowerFace
          ? Math.max(bottom, lower.floor.elevation + Math.max(...lowerFace.vertices.map(v => v.position[1])))
          : bottom
        if (face && top > continuationBottom + 1e-6) result.get(owner.floor.id)!.wallFaces.push(
          continueWallFace(face, point, nextPoint, continuationBottom, top, owner.floor.elevation))
        // An overhang can meet an upper facade below the floor assembly.
        // Close that short gap in the facade's own plane; otherwise a low
        // camera angle sees the interior behind the roof's abutment cut.
        if (!lowerFace && upperFace) {
          const inverted = roofContacts.filter(contact => contact.floorId === lower.floor.id && contact.wallId === upperFace.wallId)
            .flatMap(contact => contact.faces.map(panel => panel.map(([x,y,z]): [number,number,number] => [x,-y,z])))
          for (const [a,b] of resolvedRoofWallSegments(inverted, point, nextPoint, -bottom, 0)) {
            const continuation = continueWallFace(upperFace, a.planPoint, b.planPoint, bottom, bottom, upper.floor.elevation)
            continuation.vertices = continuation.vertices.map((v,index) => {
              if (index > 1) return v
              const y = -(index === 0 ? a : b).topY - upper.floor.elevation
              return { position:[v.position[0],y,v.position[2]], uv:[v.uv[0],v.uv[1]+y-v.position[1]] }
            }) as WallMeshFace['vertices']
            result.get(upper.floor.id)!.wallFaces.push(continuation)
          }
        }
        return { point, nextPoint, wallFace: face, wallFloorId: face ? owner.floor.id : undefined, upperWallFace: upperFace }
      })))
    result.get(lower.floor.id)!.assembly = { bottom, top, footprints: upper.footprints, edges }
  }
  return result
}

/** Intersect original unsupported perimeter edges with the cut horizontal
 * outline. Roof cut boundaries are internal to the roof, not new slab fascias. */
export function getExposedAssemblyEdges(assembly: FloorAssembly, outline: Point[]): FloorAssemblyEdge[] {
  return outline.flatMap((p, i) => {
    const q = outline[(i + 1) % outline.length]
    const dx = q.x - p.x, dz = q.y - p.y, length = Math.hypot(dx, dz)
    if (length < 1e-6) return []
    return assembly.edges.filter(e => !e.wallFace).flatMap(edge => {
      const distance = (v: Point) => Math.abs((v.x - p.x) * dz - (v.y - p.y) * dx) / length
      if (distance(edge.point) > 1e-5 || distance(edge.nextPoint) > 1e-5) return []
      const at = (v: Point) => ((v.x - p.x) * dx + (v.y - p.y) * dz) / (length * length)
      const a = at(edge.point), b = at(edge.nextPoint)
      const start = Math.max(0, Math.min(a, b)), end = Math.min(1, Math.max(a, b))
      return (end - start) * length > 1e-6
        ? [{ point: { x: p.x + start * dx, y: p.y + start * dz },
          nextPoint: { x: p.x + end * dx, y: p.y + end * dz } }] : []
    })
  })
}
