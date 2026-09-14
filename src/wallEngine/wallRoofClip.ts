import type { Point } from '../types.ts'
import type { WallMeshFace, WallMeshVertex } from './wallMesh.ts'
import { partitionWallFacesAtRoofs, type WallRoofSurfaceDivider } from './wallRoofSurfacePartitions.ts'

export type ClipPlane = (position: [number, number, number]) => number
export type WallRoofClipVolume = {
  surfacePlane?: ClipPlane
  planes: ClipPlane[]
  protectedFootprints: ClipPlane[][]
  // At a shared coverage edge, the higher adjacent panel owns coplanar walls.
  boundaryProtections?: { boundary: ClipPlane; planes: ClipPlane[] }[]
  excludedWallIds: ReadonlySet<string>
  clipSides: boolean
}
const EPSILON = 1e-8

export function footprintPlanes(polygon: Point[]): ClipPlane[] {
  const area = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    return sum + p.x * q.y - p.y * q.x
  }, 0)
  const sign = area < 0 ? -1 : 1
  return polygon.flatMap((p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (length < EPSILON) return []
    const plane: ClipPlane = ([x, , z]) => sign * ((q.x - p.x) * (z - p.y) - (q.y - p.y) * (x - p.x)) / length
    return [plane]
  })
}

export function roofFacePlanes(face: [number, number, number][]): ClipPlane[] {
  const a = face[0]
  if (!a) return []
  const b = face.find((v) => Math.hypot(v[0] - a[0], v[2] - a[2]) > EPSILON)
  if (!b) return []
  const c = face.find((v) => Math.abs((b[2] - a[2]) * (v[0] - a[0]) - (b[0] - a[0]) * (v[2] - a[2])) > EPSILON)
  if (!c) return []
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  if (Math.abs(ny) < EPSILON) return []
  return [
    ...footprintPlanes(face.map(([x, , z]) => ({ x, y: z }))),
    ([x, y, z]) => y - a[1] + (nx * (x - a[0]) + nz * (z - a[2])) / ny,
  ]
}

function interpolate(a: WallMeshVertex, b: WallMeshVertex, t: number): WallMeshVertex {
  return {
    position: a.position.map((v, i) => v + (b.position[i] - v) * t) as WallMeshVertex['position'],
    uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t) as WallMeshVertex['uv'],
  }
}

function split(polygon: WallMeshVertex[], plane: ClipPlane) {
  const inside: WallMeshVertex[] = []
  const outside: WallMeshVertex[] = []
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const a = plane(previous.position), b = plane(current.position)
    if ((a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON)) {
      const intersection = interpolate(previous, current, a / (a - b))
      inside.push(intersection)
      outside.push(intersection)
    }
    if (b >= -EPSILON) inside.push(current)
    if (b <= EPSILON) outside.push(current)
  })
  return { inside, outside }
}

function hasArea(polygon: WallMeshVertex[]) {
  if (polygon.length < 3) return false
  const a = polygon[0].position
  return polygon.slice(1, -1).some((vertex, index) => {
    const b = vertex.position, c = polygon[index + 2].position
    const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i])
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > EPSILON
  })
}

function partition(polygon: WallMeshVertex[], planes: ClipPlane[]) {
  // Reject disjoint cutters before splitting against their infinite planes.
  // Otherwise a distant wall can subdivide a cap even though the complete
  // cutter never touches it, multiplying fragments for every later cutter.
  if (!polygon.length) return { inside: [], outside: [] }
  if (planes.some((plane) => polygon.every((v) => plane(v.position) < -EPSILON))) {
    return { inside: [], outside: [polygon] }
  }
  let inside = polygon
  const outside: WallMeshVertex[][] = []
  for (const plane of planes) {
    // A coplanar roof boundary belongs to the clipping solid. Do not emit
    // it twice as an outside fragment (vertical gable faces sit here).
    if (inside.every((v) => plane(v.position) >= -EPSILON)) continue
    const parts = split(inside, plane)
    if (hasArea(parts.outside)) outside.push(parts.outside)
    inside = parts.inside
    if (!hasArea(inside)) return { inside: [], outside }
  }
  return { inside, outside }
}

export function clipWallFacesToRoofUndersides(
  faces: WallMeshFace[],
  { floorElevation, volumes, surfaceDividers = [] }: {
    floorElevation: number; volumes: WallRoofClipVolume[]; surfaceDividers?: WallRoofSurfaceDivider[]
  },
): WallMeshFace[] {
  const clippedFaces = faces.flatMap((face) => {
    if (face.kind === 'bottom') return [face]
    const applicable = volumes.filter((volume) => face.kind === 'top' ||
      (volume.clipSides && !volume.excludedWallIds.has(face.wallId)))
    if (!applicable.length) return [face]
    let changed = false
    let polygons: WallMeshVertex[][] = [face.vertices.map((v) => ({
      ...v, position: [v.position[0], v.position[1] + floorElevation, v.position[2]],
    }))]
    for (const volume of applicable) {
      polygons = polygons.flatMap((polygon) => {
        const cut = partition(polygon, volume.planes)
        if (!hasArea(cut.inside)) return [polygon]
        let removed = [cut.inside]
        const kept = [...cut.outside]
        for (const protection of volume.boundaryProtections ?? []) {
          if (!polygon.every((v) => Math.abs(protection.boundary(v.position)) <= EPSILON)) continue
          removed = removed.flatMap((part) => {
            const protectedPart = partition(part, protection.planes)
            if (hasArea(protectedPart.inside)) kept.push(protectedPart.inside)
            return protectedPart.outside
          })
        }
        if (face.kind === 'top') {
          for (const footprint of volume.protectedFootprints) {
            removed = removed.flatMap((part) => {
              const protectedPart = partition(part, footprint)
              if (hasArea(protectedPart.inside)) kept.push(protectedPart.inside)
              return protectedPart.outside
            })
          }
        }
        if (!removed.some(hasArea)) return [polygon]
        changed = true
        return kept
      })
    }
    if (!changed) return [face]
    return polygons.flatMap((polygon) => polygon.slice(1, -1).flatMap((v, index) => {
      const triangle = [polygon[0], v, polygon[index + 2]]
      if (!hasArea(triangle)) return []
      const vertices = [...triangle, triangle[2]].map((vertex) => ({
        ...vertex,
        position: [vertex.position[0], vertex.position[1] - floorElevation, vertex.position[2]],
      })) as WallMeshFace['vertices']
      return [{ ...face, vertices }]
    }))
  })
  return partitionWallFacesAtRoofs([
    ...clippedFaces, ...buildRoofCutCaps(faces, floorElevation, volumes),
    ...buildVerticalRoofCutCaps(faces, floorElevation, volumes),
  ], surfaceDividers, floorElevation)
}

// A roof footprint can cut through a wall junction before its sloping surface
// reaches the wall top. Close that vertical step too, using horizontal solid
// boundaries to preserve the wall thickness and any door/window voids.
function buildVerticalRoofCutCaps(faces: WallMeshFace[], floorElevation: number, volumes: WallRoofClipVolume[]) {
  const worldFaces = new Map(faces.map((face) => [face, face.vertices.map((v): WallMeshVertex => ({
    ...v, position: [v.position[0], v.position[1] + floorElevation, v.position[2]],
  }))]))
  const world = (face: WallMeshFace) => worldFaces.get(face)!
  const section = (face: WallMeshFace, plane: ClipPlane) => {
    const vertices = world(face)
    const points: WallMeshVertex[] = []
    vertices.forEach((b, i) => {
      const a = vertices[(i + vertices.length - 1) % vertices.length]
      const da = plane(a.position), db = plane(b.position)
      if (Math.abs(db) <= EPSILON) points.push(b)
      if (da * db < -EPSILON * EPSILON) points.push(interpolate(a, b, da / (da - db)))
    })
    if (points.length < 2) return []
    const origin = plane([0, 0, 0])
    const nx = plane([1, 0, 0]) - origin, nz = plane([0, 0, 1]) - origin
    points.sort((a, b) => (a.position[0] - b.position[0]) * -nz + (a.position[2] - b.position[2]) * nx)
    const a = points[0], b = points.at(-1)!
    if (Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) <= EPSILON) return []
    return [a, b, { ...b, position: [b.position[0], floorElevation, b.position[2]] as [number, number, number] },
      { ...a, position: [a.position[0], floorElevation, a.position[2]] as [number, number, number] }]
  }
  const upward = faces.filter((face) => face.normal[1] > 0.99)
  const downward = faces.filter((face) => face.normal[1] < -0.99).map((face) => ({
    height: face.vertices[0].position[1],
    planes: [...footprintPlanes(face.vertices.map(({ position: [x, , y] }) => ({ x, y }))),
      ([, y]: [number, number, number]) => face.vertices[0].position[1] + floorElevation - y],
  }))
  return volumes.flatMap((volume, volumeIndex) => {
    if (!volume.surfacePlane || !volume.clipSides) return []
    return volume.planes.filter((plane) => plane !== volume.surfacePlane).flatMap((boundary, boundaryIndex) => {
      const origin = boundary([0, 0, 0])
      if (Math.abs(boundary([0, 1, 0]) - origin) > EPSILON) return []
      const nx = boundary([1, 0, 0]) - origin, nz = boundary([0, 0, 1]) - origin
      const length = Math.hypot(nx, nz)
      if (length <= EPSILON) return []
      const normal: WallMeshFace['normal'] = [nx / length, 0, nz / length]
      const sections = upward.flatMap((face) => {
        const distances = world(face).map((v) => boundary(v.position))
        const min = Math.min(...distances), max = Math.max(...distances)
        if (min > EPSILON || max < -EPSILON) return []
        const strip = section(face, boundary)
        return hasArea(strip) ? [{ face, strip, min, max }] : []
      })
      const retained = sections.filter(({ face, min }) => min < -EPSILON && !volume.excludedWallIds.has(face.wallId))
      if (!retained.length) return []
      const acrossSections = sections.filter(({ max }) => max > EPSILON).map(({ strip }) => {
          const distances = strip.map((v) => -normal[2] * v.position[0] + normal[0] * v.position[2])
          const min = Math.min(...distances), max = Math.max(...distances)
          const top = Math.max(...strip.map((v) => v.position[1]))
          return [(p: [number, number, number]) => -normal[2] * p[0] + normal[0] * p[2] - min,
            (p: [number, number, number]) => max + normal[2] * p[0] - normal[0] * p[2],
            ([, y]: [number, number, number]) => top - y]
        })
      if (!acrossSections.length) return []
      return retained.flatMap(({ face, strip }) => {
        let polygons = [partition(strip, volume.planes).inside].filter(hasArea)
        // The wall top may already be triangulated at this boundary. Require
        // solid on both sides across the combined mesh, not within one triangle.
        let unmatched = polygons
        polygons = []
        for (const planes of acrossSections) unmatched = unmatched.flatMap((polygon) => {
          const parts = partition(polygon, planes)
          if (hasArea(parts.inside)) polygons.push(parts.inside)
          return parts.outside
        })
        for (const footprint of volume.protectedFootprints) polygons = polygons.flatMap((p) => partition(p, footprint).outside)
        for (const lower of downward) {
          if (!polygons.length) break
          if (lower.height > face.vertices[0].position[1] + EPSILON) continue
          polygons = polygons.flatMap((p) => partition(p, lower.planes).outside)
        }
        for (const [otherIndex, other] of volumes.entries()) {
          if (other === volume || !other.clipSides || other.excludedWallIds.has(face.wallId)) continue
          // Coplanar duplicate cutters have one owner. Opposite boundaries cut
          // the back of this cap normally, leaving only the height difference.
          const sameBoundary = other.planes.some((plane) => [[0, 0, 0], [1, 0, 0], [0, 0, 1]].every((p) =>
            Math.abs(plane(p as [number, number, number]) - boundary(p as [number, number, number])) < EPSILON))
          if (sameBoundary && otherIndex > volumeIndex) continue
          polygons = polygons.flatMap((p) => partition(p, other.planes).outside)
        }
        return polygons.flatMap((polygon, polygonIndex) => polygon.slice(1, -1).flatMap((v, index) => {
          const triangle = [polygon[0], v, polygon[index + 2]]
          if (!hasArea(triangle)) return []
          const vertices = [...triangle, triangle[2]].map(({ position: [x, y, z] }) => ({
            position: [x, y - floorElevation, z], uv: [-normal[2] * x + normal[0] * z, y],
          })) as WallMeshFace['vertices']
          return [{ ...face, kind: 'side' as const, normal, vertices,
            faceId: `${face.faceId}:roof-boundary-cap:${volumeIndex}:${boundaryIndex}:${polygonIndex}:${index}`,
            materialSource: { ...face.materialSource, role: 'cap' as const },
          }]
        }))
      })
    })
  })
}

// Project horizontal solid boundaries onto the cutting plane. Downward-facing
// boundaries subtract opening voids, so cuts through windows stay open. This
// closes the full wall thickness without inventing a cap across an empty room.
function buildRoofCutCaps(faces: WallMeshFace[], floorElevation: number, volumes: WallRoofClipVolume[]) {
  const world = (face: WallMeshFace) => face.vertices.map((v): WallMeshVertex => ({
    ...v, position: [v.position[0], v.position[1] + floorElevation, v.position[2]],
  }))
  const downward = faces.filter((face) => face.normal[1] < -0.99).map((face) => {
    const height = face.vertices[0].position[1] + floorElevation
    return { height, planes: [...footprintPlanes(face.vertices.map(({ position: [x, , y] }) => ({ x, y }))),
      ([, y]: [number, number, number]) => height - y] }
  })
  return volumes.flatMap((volume, volumeIndex) => {
    const surface = volume.surfacePlane
    if (!surface || !volume.clipSides) return []
    const dy = surface([0, 1, 0]) - surface([0, 0, 0])
    if (Math.abs(dy) < EPSILON) return []
    return faces.filter((face) => face.normal[1] > 0.99 && !volume.excludedWallIds.has(face.wallId)).flatMap((face) => {
      let removed = partition(world(face), volume.planes).inside
      if (!hasArea(removed)) return []
      const ceiling = Math.max(...removed.map((v) => v.position[1]))
      removed = removed.map((v) => ({ ...v, position: [v.position[0], v.position[1] - surface(v.position) / dy, v.position[2]] }))
      removed = partition(removed, [([, y]) => y - floorElevation - EPSILON]).inside
      if (!hasArea(removed)) return []
      let polygons = [removed]
      for (const footprint of volume.protectedFootprints) polygons = polygons.flatMap((p) => partition(p, footprint).outside)
      for (const boundary of downward) {
        if (!polygons.length) break
        if (boundary.height > ceiling + EPSILON) continue
        polygons = polygons.flatMap((p) => partition(p, boundary.planes).outside)
      }
      // Other roof panels may further trim a cap. Its own plane is excluded,
      // since the new face lies exactly on that boundary.
      for (const other of volumes) if (other !== volume && other.clipSides && !other.excludedWallIds.has(face.wallId)) {
        if (other.surfacePlane && removed.every((v) => Math.abs(other.surfacePlane!(v.position)) < EPSILON) && volumes.indexOf(other) > volumeIndex) continue
        polygons = polygons.flatMap((p) => partition(p, other.planes).outside)
      }
      const dx = (surface([1, 0, 0]) - surface([0, 0, 0])) / dy
      const dz = (surface([0, 0, 1]) - surface([0, 0, 0])) / dy
      const length = Math.hypot(dx, 1, dz)
      const normal: WallMeshFace['normal'] = [dx / length, 1 / length, dz / length]
      return polygons.flatMap((polygon, polygonIndex) => polygon.slice(1, -1).flatMap((v, index) => {
        const triangle = [polygon[0], v, polygon[index + 2]]
        if (!hasArea(triangle)) return []
        // Original top faces already have upward winding; projection preserves it.
        const vertices = [...triangle, triangle[2]].map((vertex) => ({ ...vertex,
          position: [vertex.position[0], vertex.position[1] - floorElevation, vertex.position[2]],
        })) as WallMeshFace['vertices']
        return [{ ...face, faceId: `${face.faceId}:roof-cap:${volumeIndex}:${polygonIndex}:${index}`, normal, vertices }]
      }))
    })
  })
}
