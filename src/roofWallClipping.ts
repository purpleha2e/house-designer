import type { Point, Wall } from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'
import { createWallRoofSurfaceDividers } from './wallEngine/wallRoofSurfacePartitions.ts'

import { footprintPlanes, roofFacePlanes, type ClipPlane, type WallRoofClipVolume } from './wallEngine/wallRoofClip.ts'

export type WallClippingRoof = {
  roofId?: string
  surfaceFaces?: [number, number, number][][]
  floorId: string
  undersideFaces: [number, number, number][][]
  supportPolygon: Point[]
  abutmentPlanes?: ClipPlane[]
}

export function createWallRoofClipOptions({
  floorElevation, floorId, isInsideRoom, roofs, walls, wallFaces,
}: {
  floorElevation: number
  floorId: string
  isInsideRoom?: (point: Point) => boolean
  roofs: WallClippingRoof[]
  walls: Wall[]
  wallFaces?: WallMeshFace[]
}) {
  const wallBounds = new Map(walls.map(wall => [wall.id, { bottom: 0, top: wall.height }]))
  for (const face of wallFaces ?? []) {
    const bounds = wallBounds.get(face.wallId)
    if (!bounds) continue
    for (const vertex of face.vertices) {
      bounds.bottom = Math.min(bounds.bottom, vertex.position[1])
      bounds.top = Math.max(bounds.top, vertex.position[1])
    }
  }
  const volumes: WallRoofClipVolume[] = roofs.flatMap((roof) => {
    const abuttingWalls = walls.filter((wall) =>
      isRoofAbuttingWall({ isInsideRoom, supportPolygon: roof.supportPolygon, wall }))
    const excludedWallIds = new Set(abuttingWalls.map((wall) => wall.id))
    const protectedFootprints = abuttingWalls.map((wall) => {
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
      const ux = (wall.end.x - wall.start.x) / length
      const uy = (wall.end.y - wall.start.y) / length
      const half = wall.thickness / 2
      return footprintPlanes([
        { x: wall.start.x - ux * half - uy * half, y: wall.start.y - uy * half + ux * half },
        { x: wall.end.x + ux * half - uy * half, y: wall.end.y + uy * half + ux * half },
        { x: wall.end.x + ux * half + uy * half, y: wall.end.y + uy * half - ux * half },
        { x: wall.start.x - ux * half + uy * half, y: wall.start.y - uy * half - ux * half },
      ])
    })
    const coverage = roof.undersideFaces.map(roofFacePlanes).filter((planes) => planes.length)
    return coverage.map((coveragePlanes) => {
      const planes = [...coveragePlanes]
      const surfacePlane = planes.at(-1)!
      const boundaryProtections = coveragePlanes.slice(0, -1).flatMap((boundary) =>
        coverage.filter((other) => other !== coveragePlanes && other.slice(0, -1).some((edge) =>
          // Opposite half-planes identify adjacent coverage, including the seam
          // where an upper roof consumed the lower roof inside its support.
          [[0, 0, 0], [1, 0, 0], [0, 0, 1]].every((point) =>
            Math.abs(boundary(point as [number, number, number]) + edge(point as [number, number, number])) < 1e-8),
        )).map((other) => ({
          boundary,
          planes: [...other.slice(0, -1), (point: [number, number, number]) => -other.at(-1)!(point)],
        })),
      )
      if (planes.length) planes.push(...(roof.abutmentPlanes ?? []).map((plane): ClipPlane => (point) => -plane(point)))
      return { planes, surfacePlane, boundaryProtections, protectedFootprints, excludedWallIds, clipSides: roof.floorId !== floorId }
    })
  })
  const surfaceDividers = roofs.flatMap(roof => roof.floorId !== floorId && roof.roofId && roof.surfaceFaces
    ? createWallRoofSurfaceDividers(roof.roofId, roof.surfaceFaces,
      // Material boundaries follow actual contact segments. A long facade can
      // meet a roof on only part of its length, or at a slightly angled mount,
      // without qualifying for the whole-wall geometry clipping exemption.
      walls.filter(wall => wall.kind === 'external'),
      floorElevation, wallBounds, roof.supportPolygon)
    : [])
  return { floorElevation, volumes, surfaceDividers }
}

// A roof along the outside of a facade terminates against that wall. A gable
// bounding the room under the roof still needs trimming, even at a roof edge.
export function isRoofAbuttingWall({
  isInsideRoom,
  supportPolygon,
  wall,
}: {
  isInsideRoom?: (point: Point) => boolean
  supportPolygon: Point[]
  wall: Wall
}) {
  if (wall.kind !== 'external' || supportPolygon.length < 3) return false
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.000001) return false
  const normal = { x: -dy / length, y: dx / length }
  const center = {
    x: supportPolygon.reduce((sum, point) => sum + point.x, 0) / supportPolygon.length,
    y: supportPolygon.reduce((sum, point) => sum + point.y, 0) / supportPolygon.length,
  }

  return supportPolygon.some((start, index) => {
    const end = supportPolygon[(index + 1) % supportPolygon.length]
    const edgeLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (edgeLength < 0.000001) return false
    const unit = { x: (end.x - start.x) / edgeLength, y: (end.y - start.y) / edgeLength }
    const distance = (point: Point) =>
      (point.x - start.x) * -unit.y + (point.y - start.y) * unit.x
    const startDistance = distance(wall.start)
    const endDistance = distance(wall.end)
    const tolerance = wall.thickness / 2 + 0.001
    if (Math.abs(startDistance) > tolerance || Math.abs(endDistance) > tolerance ||
      Math.abs(startDistance - endDistance) > 0.01) return false

    const project = (point: Point) =>
      (point.x - start.x) * unit.x + (point.y - start.y) * unit.y
    const min = Math.min(project(wall.start), project(wall.end))
    const max = Math.max(project(wall.start), project(wall.end))
    const overlap = Math.min(edgeLength, max) - Math.max(0, min)
    if (overlap <= tolerance) return false

    if (isInsideRoom) {
      const midpoint = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
      const sampleDistance = wall.thickness / 2 + 0.08
      const positiveRoom = isInsideRoom({ x: midpoint.x + normal.x * sampleDistance, y: midpoint.y + normal.y * sampleDistance })
      const negativeRoom = isInsideRoom({ x: midpoint.x - normal.x * sampleDistance, y: midpoint.y - normal.y * sampleDistance })
      // A wall with occupied space on both sides lies inside the building
      // envelope even when it is still tagged external. The roof continues
      // across it and the wall is clipped to the roof underside.
      if (positiveRoom && negativeRoom) return false
      if (positiveRoom !== negativeRoom) {
        const roofOnPositiveSide = (center.x - midpoint.x) * normal.x + (center.y - midpoint.y) * normal.y > 0
        return roofOnPositiveSide ? !positiveRoom : !negativeRoom
      }
    }

    // Open plans may not have a detected room yet. A facade continuing beyond
    // a parallel roof edge is an abutment; a contained gable is roof-trimmed.
    return min < -tolerance || max > edgeLength + tolerance
  })
}

export type RoofClippedWallSample = {
  planPoint: Point
  topY: number
}

export function buildRoofClippedWallSamples({
  bottomY,
  end,
  getRoofSurfaceHeights,
  maxStep = 0.08,
  roofOverlap = 0.005,
  roofThickness,
  start,
}: {
  bottomY: number
  end: Point
  getRoofSurfaceHeights: (point: Point) => number[]
  maxStep?: number
  roofOverlap?: number
  roofThickness: number
  start: Point
}): RoofClippedWallSample[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  const sampleCount = Math.max(
    1,
    Math.min(512, Math.ceil(length / Math.max(0.01, maxStep))),
  )

  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = index / sampleCount
    const planPoint = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    }
    const roofSurfaceHeights = getRoofSurfaceHeights(planPoint)
    // Intersecting roofs cover the union of their volumes. The lower panel
    // is hidden by the higher one; its eave must not cut a hole in the gable.
    const roofUnderside = roofSurfaceHeights.length > 0
      ? Math.max(...roofSurfaceHeights) - roofThickness + roofOverlap
      : bottomY

    return {
      planPoint,
      topY: Math.max(bottomY, roofUnderside),
    }
  })
}
