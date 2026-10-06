import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Point } from './types.ts'
import { getBaySupportPolygon } from './bayRoof.ts'
import { getRoofRenderPosition } from './roofBuildingGeometry.ts'
import { getRoofAbutmentPlanes, type RoofAbuttingWall } from './roofAbutmentGeometry.ts'
import { clipRoofFace, conformRoofFaceEdges, roofBoundsPolygon, roofFaceHeight, roofToLocal, roofToWorld, type ResolvedRoof } from './roofJunctions.ts'
import { getPitchedRoofHeightAtX } from './roofProfile.ts'
import { getRoofThickness } from './roofThickness.ts'
import { weldJoinedRoofCells } from './roofSeamWelding.ts'
import { alignRoofEaveBases } from './roofEaveAlignment.ts'
import { cutRoofFacesAtDormerOpenings, splitRoofUndersideFaces, type RoofGeometries, type RoofVertex } from './roofSolidGeometry.ts'
import { getBayRoofTopUvs, getFlippedRoofFaceProjectedUvs, getPitchedRoofTopUvs, getRoofFaceProjectedUvs } from './roofUv.ts'
import type { RoomRoofCut } from './roofRoomCsg.ts'
import { footprintPlanes, roofFacePlanes, type ClipPlane } from './wallEngine/wallRoofClip.ts'
import { intersectSolid, planeDistance, prismSolid, solidBoundaryFaces, solidPolygonArea, subtractSolid, type ConvexSolid, type SolidFace, type SolidPlane } from './convexSolid.ts'

export type RoofAssemblyPart = 'top' | 'shell' | 'underside' | 'soffit' | 'eaves'
export type RoofAssembly = {
  /** Closed cells survive every cut; meshes are only the final presentation. */
  cells: ConvexSolid[]
  faces: SolidFace[]
  edges: { a: RoofVertex; b: RoofVertex; faces: number[] }[]
}
export type RoofAssemblyInput = {
  resolved: ResolvedRoof
  abuttingWalls?: RoofAbuttingWall[]
  dormerOpenings?: Point[][]
  roomCuts?: RoomRoofCut[]
}
const EPS = 1e-7

function coefficients(plane: ClipPlane): SolidPlane {
  const d = plane([0, 0, 0])
  const values: SolidPlane = [plane([1, 0, 0]) - d, plane([0, 1, 0]) - d, plane([0, 0, 1]) - d, d]
  const length = Math.hypot(...values.slice(0, 3))
  return values.map(value => value / length) as SolidPlane
}

/** A convex panel with independently sloping top and bottom, including caps. */
export function roofPanelSolid(points: RoofVertex[], bottom: (x: number, z: number) => number,
  topPart: RoofAssemblyPart, bottomPart: RoofAssemblyPart, edgePart: RoofAssemblyPart): ConvexSolid | null {
  const height = roofFaceHeight(points)
  if (!height || solidPolygonArea(points) < EPS * EPS) return null
  // Boolean operations can repeat or insert collinear footprint vertices.
  const polygon = points.filter((p, i) => Math.hypot(p[0] - points[(i + points.length - 1) % points.length][0],
    p[2] - points[(i + points.length - 1) % points.length][2]) > EPS).map(([x, , z]) => ({ x, y: z }))
  if (polygon.length < 3) return null
  const low = Math.min(...points.map(([x, , z]) => bottom(x, z))) - 1
  const high = Math.max(...points.map(p => p[1])) + 1
  let solid: ConvexSolid | null = prismSolid(polygon, low, high, edgePart)
  solid = intersectSolid(solid, coefficients(([x, y, z]) => height({ x, y: z }) - y), topPart)
  return solid && intersectSolid(solid, coefficients(([x, y, z]) => y - bottom(x, z)), bottomPart)
}

/** Shared, conformed boundary graph. Parts use these exact polygon edges. */
export function assembleRoofCells(cells: ConvexSolid[]): RoofAssembly {
  const boundary = solidBoundaryFaces(cells)
  const polygons = conformRoofFaceEdges(boundary.map(face => face.points))
  const vertices = new Map<string, RoofVertex>()
  const key = (p: RoofVertex) => p.map(value => Math.round(value / EPS)).join(':')
  const faces = boundary.map((face, i) => ({ ...face, points: polygons[i].map(p => {
    const id = key(p), existing = vertices.get(id)
    if (existing) return existing
    vertices.set(id, p)
    return p
  }) }))
  const edges = new Map<string, RoofAssembly['edges'][number]>()
  faces.forEach((face, i) => face.points.forEach((a, j) => {
    const b = face.points[(j + 1) % face.points.length]
    const id = [key(a), key(b)].sort().join('|')
    const edge = edges.get(id)
    if (edge) edge.faces.push(i)
    else edges.set(id, { a, b, faces: [i] })
  }))
  return { cells, faces, edges: [...edges.values()] }
}

function constructRoofCells({ resolved, abuttingWalls = [], dormerOpenings = [], roomCuts = [] }: RoofAssemblyInput): ConvexSolid[] {
  const { roof, elevation } = resolved
  const thickness = getRoofThickness(roof)
  const local = (p: RoofVertex) => roofToLocal(roof, elevation, p)
  const world = (p: RoofVertex) => roofToWorld(roof, elevation, p)
  const original = cutRoofFacesAtDormerOpenings(resolved.faces, dormerOpenings)
  const support = roof.type === 'bay' ? getBaySupportPolygon(roof) : roofBoundsPolygon(resolved, resolved.support).map(p => {
    const [x, , z] = local([p.x, elevation, p.y]); return { x, y: z }
  })
  const panels = conformRoofFaceEdges(original.map(face => face.map(local)))
  const { undersideFaces, soffitFaces } = splitRoofUndersideFaces(panels, support)
  let cells: ConvexSolid[] = []
  for (const [faces, part] of [[undersideFaces, 'underside'], [soffitFaces, 'soffit']] as const) {
    for (const face of faces) {
      const height = roofFaceHeight(face)!
      const cell = roofPanelSolid(face, (x, z) => height({ x, y: z }) - thickness, 'top', part, 'shell')
      if (cell) cells.push(cell)
    }
  }
  let eaves: ConvexSolid[] = []
  const addEave = (face: RoofVertex[], bottom: (x: number, z: number) => number) => {
    const top = face.map(([x, y, z]): RoofVertex => [x, y - thickness, z])
    const cell = roofPanelSolid(top, bottom, 'eaves', 'eaves', 'eaves')
    if (cell) {
      // Keep the original horizontal base identifiable through room/wall cuts.
      cell.faces.forEach(face => {
        if (Math.abs(face.plane[0]) < EPS && Math.abs(face.plane[2]) < EPS && face.plane[1] > 1 - EPS)
          face.tag = 'eave-base'
      })
      eaves.push(cell)
    }
  }
  if (roof.type === 'up-and-over') {
    for (const side of [-1, 1] as const) {
      const wallX = side === -1 ? resolved.support.minX : resolved.support.maxX
      const edgeX = side === -1 ? resolved.extents.minX : resolved.extents.maxX
      if (Math.abs(edgeX - wallX) < EPS) continue
      const bottom = getPitchedRoofHeightAtX(roof, resolved.support, edgeX) - thickness - 0.16
      for (const face of panels.map(face => clipRoofFace(face, ([x]) => side * (x - wallX))).filter(face => face.length)) {
        const height = roofFaceHeight(face)!
        // A cell must have planar skins. Split where an extended eave or
        // chamfer changes its bottom plane; never fit a plane through a min().
        for (const outside of [false, true]) {
          const region = clipRoofFace(face, ([x]) => (outside ? 1 : -1) * side * (x - edgeX))
          if (!region.length) continue
          const edgeHeight = (x: number, z: number) => height({ x: outside ? x : edgeX, y: z }) - thickness - 0.16
          if (region.every(([x, , z]) => Math.abs(edgeHeight(x, z) - bottom) <= EPS)) {
            addEave(region, () => bottom)
            continue
          }
          const flat = clipRoofFace(region, ([x, , z]) => edgeHeight(x, z) - bottom)
          const sloped = clipRoofFace(region, ([x, , z]) => bottom - edgeHeight(x, z))
          if (flat.length) addEave(flat, () => bottom)
          // Coincident planes belong to the flat cell only.
          if (sloped.length && sloped.some(([x, , z]) => edgeHeight(x, z) < bottom - EPS)) addEave(sloped, edgeHeight)
        }
      }
    }
    // A chamfer can turn the former gable end into an eave. It belongs to
    // the same boxed assembly as the side eaves, including their corners.
    for (const side of [-1, 1] as const) {
      if (!(side < 0 ? roof.ridgeStartChamfer : roof.ridgeEndChamfer)) continue
      const wallZ = side < 0 ? resolved.support.minY : resolved.support.maxY
      const edgeZ = side < 0 ? resolved.extents.minY : resolved.extents.maxY
      if (Math.abs(edgeZ - wallZ) < EPS) continue
      for (const face of panels.map(face => clipRoofFace(face, ([, , z]) => side * (z - wallZ))).filter(face => face.length)) {
        const height = roofFaceHeight(face)!
        if (Math.abs(height({ x: 0, y: 1 }) - height({ x: 0, y: 0 })) < EPS) continue
        addEave(face, (x) => height({ x, y: edgeZ }) - thickness - 0.16)
      }
    }
  } else if (roof.type === 'bay') {
    const overhangs = soffitFaces.filter(face => face.every(([, y]) => y <= EPS))
    const bottom = Math.min(...overhangs.flat().map(p => p[1])) - thickness - 0.16
    overhangs.forEach(face => addEave(face, () => bottom))
  }
  const cut = (source: ConvexSolid[], volumes: SolidPlane[][], tag: RoofAssemblyPart) => {
    for (const planes of volumes) source = source.flatMap(cell => subtractSolid(cell, planes, tag))
    return source
  }
  const abutments = getRoofAbutmentPlanes(abuttingWalls, getRoofRenderPosition(roof))
    .map(plane => [coefficients(p => plane(world(p)))])
  // Cut the constructed assembly, not each triangulated material surface.
  cells = cut(cells, abutments, 'shell')
  eaves = cut(eaves, abutments, 'eaves')
  const joinedVolumes = (resolved.joinedEaveCutFaces ?? []).flatMap(face => {
    const planes = roofFacePlanes(face)
    if (!planes.length) return []
    const above = planes.pop()!
    return [[...planes, (p: RoofVertex) => -above(p)].map(plane => coefficients(p => plane(world(p))))]
  })
  eaves = cut(eaves, joinedVolumes, 'eaves')
  const rooms = roomCuts.filter(c => !(c.roomVolume && c.floorId === resolved.floorId &&
    ((roof.fitSupportingWalls && roof.clipsGeometry === false) ||
      // A clipping roof owns its complete footprint, including overhangs.
      // The room's horizontal fallback must not carve that same roof away
      // after the walls below it have been trimmed to its underside.
      (roof.clipsGeometry !== false && !c.roofId))))
  const roomVolumes = rooms.flatMap(({ face, bottomY, thickness: depth }) => {
    const localFace = face.map(local), height = roofFaceHeight(localFace)
    if (!height) return []
    const bottom = local([face[0][0], bottomY, face[0][2]])[1]
    return [[...footprintPlanes(localFace.map(([x, , z]) => ({ x, y: z }))),
      ([x, y, z]: RoofVertex) => height({ x, y: z }) - depth - 0.001 - y,
      ([, y]: RoofVertex) => y - bottom].map(coefficients)]
  })
  cells = cut(cells, roomVolumes, 'shell')
  eaves = cut(eaves, roomVolumes, 'eaves')
  return [...cells, ...eaves]
}

export function constructRoofAssembly(input: RoofAssemblyInput): RoofAssembly {
  return assembleRoofCells(alignRoofEaveBases(constructRoofCells(input)))
}

/** Resolve neighbouring closed assemblies together. Ownership remains attached
 * to each face for materials/picking, while intersecting fascia has one boundary. */
export function constructJoinedRoofAssembly(inputs: RoofAssemblyInput[]): RoofAssembly {
  const cells = [...inputs].sort((a, b) => a.resolved.roof.id.localeCompare(b.resolved.roof.id)).flatMap(input => {
    const { roof, elevation } = input.resolved
    const world = (p: RoofVertex) => roofToWorld(roof, elevation, p)
    const plane = (p: SolidPlane) => coefficients(v => planeDistance(p, roofToLocal(roof, elevation, v)))
    return constructRoofCells(input).map(cell => ({
      planes: cell.planes.map(plane),
      faces: cell.faces.map(face => ({ points: face.points.map(world), plane: plane(face.plane), tag: `${roof.id}/${face.tag}` })),
    }))
  })
  // On a joined outer edge a tile-shell cut may share the fascia's plane.
  // Give the boxed finish ownership of that overlap; a roof-ID tie-break
  // otherwise leaves brown triangular shell fragments in the white fascia.
  const joins = inputs.flatMap(({ resolved }) => resolved.connections.flatMap(connection =>
    connection.state === 'joined' && connection.targetRoofId
      ? [[resolved.roof.id, connection.targetRoofId] as [string, string]] : []))
  const sameFloorPairs = inputs.flatMap((a, i) => inputs.slice(i + 1)
    .filter(b => a.resolved.floorId === b.resolved.floorId)
    .map(b => [a.resolved.roof.id, b.resolved.roof.id] as [string, string]))
  const aligned = alignRoofEaveBases(cells, sameFloorPairs)
  aligned.sort((a, b) => Number(b.faces.every(face => face.tag.endsWith('/eaves'))) -
    Number(a.faces.every(face => face.tag.endsWith('/eaves'))))
  return assembleRoofCells(weldJoinedRoofCells(aligned, joins))
}

function renderAssemblyFaces(input: RoofAssemblyInput, faces: SolidFace[], sharedUv?: Map<SolidFace, number[][]>): RoofGeometries {
  const { roof, support } = input.resolved
  const buffers = Object.fromEntries(['top', 'shell', 'underside', 'soffit', 'eaves'].map(part =>
    [part, { positions: [] as number[], normals: [] as number[], uvs: [] as number[] }])) as Record<RoofAssemblyPart, { positions: number[]; normals: number[]; uvs: number[] }>
  for (const face of faces) {
    const part = face.tag as RoofAssemblyPart, buffer = buffers[part]
    const normal = face.plane.slice(0, 3).map(v => -v)
    const project = part === 'top'
      ? roof.type === 'up-and-over' || roof.type === 'lean-to' ? (p: RoofVertex[]) => getPitchedRoofTopUvs(roof, support, p)
        : roof.type === 'bay' ? (p: RoofVertex[]) => getBayRoofTopUvs(roof, p)
        : roof.type === 'hip' ? getFlippedRoofFaceProjectedUvs : (p: RoofVertex[]) => p.map(([x, , z]) => [x, z])
      : getRoofFaceProjectedUvs
    const center = [0, 1, 2].map(axis => face.points.reduce((sum, p) => sum + p[axis] / face.points.length, 0)) as RoofVertex
    const uvs = sharedUv?.get(face) ?? project(face.points)
    const centerUv = [0, 1].map(axis => uvs.reduce((sum, uv) => sum + uv[axis] / uvs.length, 0))
    face.points.forEach((a, i) => {
      const j = (i + 1) % face.points.length, b = face.points[j]
      const da = a.map((v, axis) => v - center[axis]), db = b.map((v, axis) => v - center[axis])
      const cross = [da[1] * db[2] - da[2] * db[1], da[2] * db[0] - da[0] * db[2], da[0] * db[1] - da[1] * db[0]]
      if (Math.hypot(...cross) < 1e-12) return
      const flip = cross.reduce((sum, v, axis) => sum + v * normal[axis], 0) < 0
      buffer.positions.push(...center, ...(flip ? b : a), ...(flip ? a : b))
      buffer.normals.push(...normal, ...normal, ...normal)
      buffer.uvs.push(...centerUv, ...uvs[flip ? j : i], ...uvs[flip ? i : j])
    })
  }
  return Object.fromEntries(Object.entries(buffers).map(([part, data]) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2))
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    return [part, geometry]
  })) as RoofGeometries
}

export function createRoofAssemblyGeometries(input: RoofAssemblyInput): RoofGeometries {
  return renderAssemblyFaces(input, constructRoofAssembly(input).faces)
}

export function createJoinedRoofAssemblyGeometries(inputs: RoofAssemblyInput[]): Map<string, RoofGeometries> {
  const assembly = constructJoinedRoofAssembly(inputs)
  const planes: { plane: SolidPlane; owners: Set<string> }[] = []
  const groups = new Map<SolidFace, typeof planes[number]>()
  for (const face of assembly.faces) {
    const [id, part] = face.tag.split('/')
    if (part !== 'top') continue
    // A sub-millimetre mount discrepancy should not restart the tile pattern.
    // This tolerance affects UVs only; authored heights remain unchanged.
    let group = planes.find(p => p.plane.slice(0, 3).every((v, axis) => Math.abs(v - face.plane[axis]) < 1e-7) &&
      Math.abs(p.plane[3] - face.plane[3]) < 0.001)
    if (!group) { group = { plane: face.plane, owners: new Set() }; planes.push(group) }
    group.owners.add(id); groups.set(face, group)
  }
  return new Map(inputs.map(input => {
    const { roof, elevation } = input.resolved
    const sharedUv = new Map<SolidFace, number[][]>()
    const faces = assembly.faces.filter(face => face.tag.startsWith(`${roof.id}/`)).map(face => {
      const localFace = { tag: face.tag.slice(roof.id.length + 1),
        points: face.points.map(p => roofToLocal(roof, elevation, p)),
        plane: coefficients(p => planeDistance(face.plane, roofToWorld(roof, elevation, p))) }
      // Coplanar roofs share a metre-based world frame, so tile courses do not
      // restart at an otherwise invisible ownership seam.
      if (localFace.tag === 'top' && (groups.get(face)?.owners.size ?? 0) > 1) {
        const [nx, ny, nz] = face.plane.map(v => -v), h = Math.hypot(nx, nz)
        if (h > EPS) sharedUv.set(localFace, face.points.map(([x, y, z]) =>
          [(x * nz - z * nx) / h, (x * nx + z * nz) * ny / h - y * h]))
      }
      return localFace
    })
    return [roof.id, renderAssemblyFaces(input, faces, sharedUv)]
  }))
}
