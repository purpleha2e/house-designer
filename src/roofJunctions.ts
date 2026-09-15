import type { Point, RoofEndConnection, RoofStructure } from './types.ts'
import { getBayRoofPolygon, getBaySupportPolygon } from './bayRoof.ts'
import { buildRoofProfileFaces, type RoofBounds, type RoofProfileVertex as Vertex } from './roofProfile.ts'
import { getRoofThickness } from './roofThickness.ts'
import { footprintPlanes, type ClipPlane } from './wallEngine/wallRoofClip.ts'

const EPS = 1e-7
export const RIDGE_HEIGHT_TOLERANCE = 0.025
export type RoofJunctionInput = {
  roof: RoofStructure
  floorId: string
  elevation: number
  support: RoofBounds
  extents: RoofBounds
  abutments?: { plane: ClipPlane; top: number; spanPlanes?: ClipPlane[]; floorId?: string }[]
}
export type RoofConnectionStatus = {
  end: 'ridgeStart' | 'ridgeEnd'
  state: 'exposed' | 'joined' | 'unresolved'
  targetRoofId?: string
  message?: string
}
export type ResolvedRoof = RoofJunctionInput & {
  faces: Vertex[][]
  structuralFaces: Vertex[][]
  coverageFaces: Vertex[][]
  coverageUndersideFaces?: Vertex[][]
  connections: RoofConnectionStatus[]
  resolvedExtents: RoofBounds
}

export function getRoofCoverageUndersideFaces(roof: ResolvedRoof): Vertex[][] {
  return roof.coverageUndersideFaces ?? roof.coverageFaces.map(face =>
    face.map(([x, y, z]): Vertex => [x, y - getRoofThickness(roof.roof), z]))
}

export function normalizeRoofEndConnection(value: unknown): RoofEndConnection | undefined {
  if (!value || typeof value !== 'object' || !('mode' in value)) return undefined
  if (value.mode === 'exposed' || value.mode === 'automatic') return { mode: value.mode }
  if (value.mode === 'join' && 'targetRoofId' in value && typeof value.targetRoofId === 'string') {
    return { mode: 'join', targetRoofId: value.targetRoofId }
  }
  return undefined
}

export function roofJunctionInput(roof: RoofStructure, floorId: string, elevation: number): RoofJunctionInput {
  if (roof.type === 'bay') {
    const bounds = (points: Point[]): RoofBounds => ({
      minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
    })
    return { roof, floorId, elevation, support: bounds(getBaySupportPolygon(roof)), extents: bounds(getBayRoofPolygon(roof)) }
  }
  const halfW = Math.max(roof.width, 0.3) / 2, halfD = Math.max(roof.depth, 0.3) / 2
  const negative = Math.max(0, roof.overhangSideNegative ?? roof.overhangSide ?? 0)
  const positive = Math.max(0, roof.overhangSidePositive ?? roof.overhangSide ?? 0)
  const end = Math.max(0, roof.overhangEnd ?? 0)
  const explicit = roof.supportPosition && roof.supportWidth && roof.supportDepth
  let support: RoofBounds = explicit ? {
    minX: -roof.supportWidth! / 2, maxX: roof.supportWidth! / 2,
    minY: -roof.supportDepth! / 2, maxY: roof.supportDepth! / 2,
  } : { minX: -halfW + Math.min(negative, halfW - 0.15), maxX: halfW - (roof.type === 'lean-to' ? 0 : Math.min(positive, halfW - 0.15)),
    minY: -halfD + Math.min(end, halfD - 0.15), maxY: halfD - Math.min(end, halfD - 0.15) }
  if (roof.type === 'hip' && explicit) {
    const c = Math.cos(roof.rotation), s = Math.sin(roof.rotation)
    const dx = roof.supportPosition!.x - roof.position.x, dz = roof.supportPosition!.y - roof.position.y
    support = { minX: support.minX + dx * c - dz * s, maxX: support.maxX + dx * c - dz * s,
      minY: support.minY + dx * s + dz * c, maxY: support.maxY + dx * s + dz * c }
  }
  const extents = roof.type === 'hip' ? { minX: -halfW, maxX: halfW, minY: -halfD, maxY: halfD }
    : { minX: support.minX - negative, maxX: support.maxX + (roof.type === 'lean-to' ? 0 : positive), minY: support.minY - end, maxY: support.maxY + end }
  return { roof, floorId, elevation, support, extents }
}

export function roofToWorld(roof: RoofStructure, elevation: number, [x, y, z]: Vertex): Vertex {
  const origin = roof.type === 'hip' ? roof.position : roof.supportPosition ?? roof.position
  const c = Math.cos(roof.rotation), s = Math.sin(roof.rotation)
  return [origin.x + x * c + z * s, elevation + (roof.heightOffset ?? 0) + y, origin.y - x * s + z * c]
}

export function roofToLocal(roof: RoofStructure, elevation: number, [x, y, z]: Vertex): Vertex {
  const origin = roof.type === 'hip' ? roof.position : roof.supportPosition ?? roof.position
  const c = Math.cos(roof.rotation), s = Math.sin(roof.rotation)
  return [(x - origin.x) * c - (z - origin.y) * s, y - elevation - (roof.heightOffset ?? 0), (x - origin.x) * s + (z - origin.y) * c]
}

export function roofBoundsPolygon(input: RoofJunctionInput, bounds = input.extents): Point[] {
  if (input.roof.type === 'bay') {
    const isSupport = (['minX', 'maxX', 'minY', 'maxY'] as const).every((key) => Math.abs(bounds[key] - input.support[key]) < EPS)
    return (isSupport ? getBaySupportPolygon(input.roof) : getBayRoofPolygon(input.roof))
      .map(({ x, y }) => roofToWorld(input.roof, input.elevation, [x, 0, y])).map(([x, , y]) => ({ x, y }))
  }
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]
    .map(([x, z]) => roofToWorld(input.roof, input.elevation, [x, 0, z]))
    .map(([x, , y]) => ({ x, y }))
}

function area(face: Vertex[]) {
  return Math.abs(face.reduce((sum, p, i) => {
    const q = face[(i + 1) % face.length]
    return sum + (p[0] - face[0][0]) * (q[2] - face[0][2]) - (q[0] - face[0][0]) * (p[2] - face[0][2])
  }, 0)) / 2
}

export function clipRoofFace(face: Vertex[], plane: ClipPlane): Vertex[] {
  const result: Vertex[] = []
  face.forEach((b, i) => {
    const a = face[(i + face.length - 1) % face.length]
    const da = plane(a), db = plane(b)
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db)
      result.push(a.map((v, axis) => v + (b[axis] - v) * t) as Vertex)
    }
    if (db >= 0) result.push(b)
  })
  const clean = result.filter((p, i) => Math.hypot(...p.map((v, axis) => v - result[(i + result.length - 1) % result.length][axis])) > EPS)
  return clean.length >= 3 && area(clean) > EPS * EPS ? clean : []
}

function intersect(face: Vertex[], planes: ClipPlane[]) {
  return planes.reduce(clipRoofFace, face)
}

export function subtractRoofVolume(face: Vertex[], planes: ClipPlane[]): Vertex[][] {
  if (!intersect(face, planes).length) return [face]
  let inside = face
  const outside: Vertex[][] = []
  for (const plane of planes) {
    if (!inside.length) break
    if (inside.every((p) => plane(p) >= -EPS)) continue
    const piece = clipRoofFace(inside, (p) => -plane(p))
    if (piece.length) outside.push(piece)
    inside = clipRoofFace(inside, plane)
  }
  return outside
}

export function roofFaceHeight(face: Vertex[]): ((point: Point) => number) | null {
  const a = face[0]
  for (let i = 1; i < face.length - 1; i++) {
    const b = face[i], c = face[i + 1]
    const determinant = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])
    if (Math.abs(determinant) < EPS * EPS) continue
    const dx = ((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / determinant
    const dz = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / determinant
    return (p) => a[1] + dx * (p.x - a[0]) + dz * (p.y - a[2])
  }
  return null
}

// Boolean fragments can introduce a vertex halfway along a neighbouring edge.
// Give both polygons the same edge segments so shell/soffit builders can tell
// interior seams from exposed edges and avoid internal vertical strips.
export function conformRoofFaceEdges(faces: Vertex[][]): Vertex[][] {
  const vertices = faces.flat()
  return faces.map((face) => face.flatMap((a, index) => {
    const b = face[(index + 1) % face.length]
    const d = b.map((v, axis) => v - a[axis]), lengthSquared = d.reduce((sum, v) => sum + v * v, 0)
    if (lengthSquared < EPS * EPS) return []
    const splits = vertices.flatMap((p) => {
      const t = p.reduce((sum, v, axis) => sum + (v - a[axis]) * d[axis], 0) / lengthSquared
      if (t <= EPS || t >= 1 - EPS || Math.hypot(...p.map((v, axis) => v - a[axis] - t * d[axis])) > EPS) return []
      return [t]
    }).sort((x, y) => x - y).filter((t, i, all) => i === 0 || t - all[i - 1] > EPS)
    return [a, ...splits.map((t) => a.map((v, axis) => v + d[axis] * t) as Vertex)]
  }))
}

function trimUnsupportedOverhangs(roof: ResolvedRoof, worldFaces: Vertex[][]) {
  if (roof.roof.type === 'bay') return worldFaces
  let faces = worldFaces.map((face) => face.map((p) => roofToLocal(roof.roof, roof.elevation, p)))
  const boundaries: { axis: 0 | 2; value: number; sign: number }[] = [
    { axis: 0, value: roof.support.minX, sign: -1 }, { axis: 0, value: roof.support.maxX, sign: 1 },
    ...(!roof.connections.some((c) => c.end === 'ridgeStart' && c.state === 'joined') ? [{ axis: 2 as const, value: roof.support.minY, sign: -1 }] : []),
    ...(!roof.connections.some((c) => c.end === 'ridgeEnd' && c.state === 'joined') ? [{ axis: 2 as const, value: roof.support.maxY, sign: 1 }] : []),
  ]
  if (roof.roof.type === 'hip') return worldFaces
  for (const { axis, value, sign } of boundaries) {
    const along = axis === 0 ? 2 : 0
    const intervals = faces.flatMap((face) => {
      // Only the main panel grants an overhang, never a disconnected eave strip.
      if (!face.some((p) => sign * (p[axis] - value) < -EPS)) return []
      const points: number[] = []
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length], da = a[axis] - value, db = b[axis] - value
        if (Math.abs(da) < EPS) points.push(a[along])
        if (da * db < 0) points.push(a[along] + (b[along] - a[along]) * da / (da - db))
      })
      return points.length >= 2 ? [{ min: Math.min(...points), max: Math.max(...points) }] : []
    }).sort((a, b) => a.min - b.min).reduce<{ min: number; max: number }[]>((merged, interval) => {
      const last = merged.at(-1)
      if (last && last.max >= interval.min - EPS) last.max = Math.max(last.max, interval.max)
      else merged.push({ ...interval })
      return merged
    }, [])
    faces = faces.flatMap((face) => {
      if (face.every((p) => sign * (p[axis] - value) <= EPS)) return [face]
      const inner = clipRoofFace(face, (p) => -sign * (p[axis] - value))
      const outer = clipRoofFace(face, (p) => sign * (p[axis] - value))
      return [inner, ...intervals.map(({ min, max }) => intersect(outer, [(p) => p[along] - min, (p) => max - p[along]]))].filter((p) => p.length)
    })
  }
  return faces.map((face) => face.map((p) => roofToWorld(roof.roof, roof.elevation, p)))
}

export function roofSurfaceHeights(faces: Vertex[][], point: Point): number[] {
  return faces.flatMap((face) => {
    if (!footprintPlanes(face.map(([x, , y]) => ({ x, y }))).every((p) => p([point.x, 0, point.y]) >= -EPS)) return []
    const height = roofFaceHeight(face)
    return height ? [height(point)] : []
  })
}

export function roofInfillFacesForFloor(roofs: ResolvedRoof[], floorId: string): Vertex[][] {
  // Infill extends this storey's walls to its roofs. A higher storey's eave
  // above the same plan point must not grow a lower wall through the gap.
  return roofs.filter((roof) => roof.floorId === floorId).flatMap((roof) => roof.faces)
}

// Intersect a wall line with the resolved panels. Breaks come from geometry,
// including narrow valleys, rather than a fixed sampling interval.
export function resolvedRoofWallSegments(faces: Vertex[][], start: Point, end: Point, bottomY: number, thickness: number) {
  const pointAt = (t: number): Point => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t })
  const intervals = faces.flatMap((face) => {
    const height = roofFaceHeight(face)
    if (!height) return []
    let min = 0, max = 1
    for (const plane of footprintPlanes(face.map(([x, , y]) => ({ x, y })))) {
      const a = plane([start.x, 0, start.y]), b = plane([end.x, 0, end.y]), slope = b - a
      if (Math.abs(slope) < EPS) { if (a < -EPS) return []; continue }
      if (slope > 0) min = Math.max(min, -a / slope)
      else max = Math.min(max, -a / slope)
    }
    return min < max - EPS ? [{ min, max, height: (t: number) => height(pointAt(t)) - thickness + 0.005 }] : []
  })
  const breaks = [0, 1, ...intervals.flatMap(({ min, max, height }) => {
    const a = height(min) - bottomY, b = height(max) - bottomY
    return a * b < 0 ? [min, max, min + (max - min) * a / (a - b)] : [min, max]
  })].sort((a, b) => a - b).filter((t, index, all) => index === 0 || t - all[index - 1] > EPS)
  return breaks.slice(1).flatMap((b, i) => {
    const a = breaks[i], middle = (a + b) / 2
    const panel = intervals.filter(({ min, max }) => min <= middle && max >= middle)
      .sort((first, second) => second.height(middle) - first.height(middle))[0]
    if (!panel || panel.height(middle) <= bottomY + EPS) return []
    return [[{ planPoint: pointAt(a), topY: Math.max(bottomY, panel.height(a)) },
      { planPoint: pointAt(b), topY: Math.max(bottomY, panel.height(b)) }]]
  })
}

// Find the interval where the source ridge ray crosses the target footprint.
// This bounds extensions by an actual building, never by an infinite roof plane.
function targetInterval(source: RoofJunctionInput, target: RoofJunctionInput, direction: number) {
  const x = (source.support.minX + source.support.maxX) / 2
  const z = direction < 0 ? source.support.minY : source.support.maxY
  const origin = roofToWorld(source.roof, source.elevation, [x, 0, z])
  const ahead = roofToWorld(source.roof, source.elevation, [x, 0, z + direction])
  let min = -Infinity, max = Infinity
  for (const plane of footprintPlanes(roofBoundsPolygon(target, target.support))) {
    const a = plane(origin), slope = plane(ahead) - a
    if (Math.abs(slope) < EPS) { if (a < -EPS) return null; continue }
    const t = -a / slope
    if (slope > 0) min = Math.max(min, t)
    else max = Math.min(max, t)
  }
  if (min > max + EPS || max <= EPS) return null
  return { min, max }
}

export function resolveRoofJunctions(inputs: RoofJunctionInput[]): ResolvedRoof[] {
  const sorted = [...inputs].sort((a, b) => a.roof.id.localeCompare(b.roof.id))
  const original = new Map(sorted.map((input) => [input.roof.id, buildRoofProfileFaces(input.roof, input.extents, input.support)
    .map((face) => face.map((p) => roofToWorld(input.roof, input.elevation, p)))]))
  const peaks = new Map(sorted.map((input) => [input.roof.id, Math.max(...original.get(input.roof.id)!.flat().map((p) => p[1]))]))
  const resolved = sorted.map((input): ResolvedRoof => {
    const resolvedExtents = { ...input.extents }
    const terminationPlanes: ClipPlane[] = []
    const connections: RoofConnectionStatus[] = []
    if (input.roof.type === 'up-and-over') for (const end of ['ridgeStart', 'ridgeEnd'] as const) {
      const direction = end === 'ridgeStart' ? -1 : 1
      const setting = input.roof[end] ?? { mode: 'automatic' }
      if (setting.mode === 'exposed') { connections.push({ end, state: 'exposed' }); continue }
      const candidates = sorted.flatMap((target) => {
        if (target.roof.id === input.roof.id) return []
        if (setting.mode === 'join' && target.roof.id !== setting.targetRoofId) return []
        const interval = targetInterval(input, target, direction)
        if (!interval) return []
        // Automatic joins are limited to touching buildings and transverse ridges.
        // Distant or parallel targets require an explicit choice.
        if (setting.mode === 'automatic' && (target.roof.type !== 'up-and-over' || interval.min > 0.35 || Math.abs(Math.sin(input.roof.rotation - target.roof.rotation)) < 0.5)) return []
        return [{ target, interval }]
      }).sort((a, b) => Math.max(0, a.interval.min) - Math.max(0, b.interval.min) || a.target.roof.id.localeCompare(b.target.roof.id))
      if (!candidates.length || (setting.mode === 'automatic' && candidates.length > 1 && Math.abs(Math.max(0, candidates[0].interval.min) - Math.max(0, candidates[1].interval.min)) < 0.025)) {
        connections.push({ end, state: setting.mode === 'join' || candidates.length ? 'unresolved' : 'exposed',
          ...(setting.mode === 'join' ? { targetRoofId: setting.targetRoofId } : {}),
          message: candidates.length ? 'Several roofs meet this end. Choose a target.' : setting.mode === 'join' ? 'The target is missing or does not intersect this ridge direction.' : undefined })
        continue
      }
      const { target } = candidates[0]
      // Extend through the full transverse target footprint, then trim at the
      // real surface intersection. Pitch and original wall coverage stay fixed.
      const targetZ = [target.extents.minY, target.extents.maxY].map((z) =>
        roofToLocal(input.roof, input.elevation, roofToWorld(target.roof, target.elevation,
          [(target.support.minX + target.support.maxX) / 2, 0, z]))[2])
      if (peaks.get(input.roof.id)! <= peaks.get(target.roof.id)! + RIDGE_HEIGHT_TOLERANCE) {
        if (direction < 0) resolvedExtents.minY = Math.min(resolvedExtents.minY, ...targetZ)
        else resolvedExtents.maxY = Math.max(resolvedExtents.maxY, ...targetZ)
        if (target.roof.type === 'up-and-over') {
          const ridgeX = (target.support.minX + target.support.maxX) / 2
          const sourceCenter = roofToWorld(input.roof, input.elevation,
            [(input.support.minX + input.support.maxX) / 2, 0, (input.support.minY + input.support.maxY) / 2])
          const side = Math.sign(roofToLocal(target.roof, target.elevation, sourceCenter)[0] - ridgeX)
          if (side) terminationPlanes.push((point) => side * (roofToLocal(target.roof, target.elevation, point)[0] - ridgeX))
        }
      }
      connections.push({ end, state: 'joined', targetRoofId: target.roof.id })
    }
    let faces = buildRoofProfileFaces(input.roof, resolvedExtents, input.support)
      .map((face) => face.map((p) => roofToWorld(input.roof, input.elevation, p)))
    faces = faces.map((face) => intersect(face, terminationPlanes)).filter((face) => face.length)
    for (const abutment of input.abutments ?? []) {
      // A connection can pass above the receiving wall to reach its roof.
      // Below the wall top it must still abut the outside wall face.
      const joinsAcrossWall = connections.some((connection) => connection.state === 'joined' &&
        original.get(connection.targetRoofId!)!.some((face) => face.some((p) => abutment.plane(p) > EPS)))
      faces = faces.flatMap((face) => subtractRoofVolume(face, [abutment.plane, ...(abutment.spanPlanes ?? []),
        ...(joinsAcrossWall ? [(p: Vertex) => abutment.top - p[1]] : [])]))
    }
    return {
      ...input,
      faces,
      structuralFaces: faces,
      coverageFaces: [],
      connections,
      resolvedExtents,
    }
  })
  const raw = new Map(
    resolved.map((roof) => [roof.roof.id, roof.structuralFaces]),
  )
  const buildingFootprints = new Map(resolved.map((roof) => {
    const bounds = { ...roof.support }
    if (roof.resolvedExtents.minY < roof.extents.minY - EPS) bounds.minY = roof.resolvedExtents.minY
    if (roof.resolvedExtents.maxY > roof.extents.maxY + EPS) bounds.maxY = roof.resolvedExtents.maxY
    return [roof.roof.id, footprintPlanes(roofBoundsPolygon(roof, bounds))]
  }))
  const clippingFootprint = (target: ResolvedRoof, source: ResolvedRoof) => {
    const connected = source.connections.some((connection) => connection.state === 'joined' && connection.targetRoofId === target.roof.id)
    if (!connected || target.roof.type !== 'up-and-over') return buildingFootprints.get(target.roof.id)!
    // A connected branch terminates at the receiving facade, including below
    // its gable-end overhang. Otherwise a small difference in the two eave
    // positions can carry a low tile/soffit strip past that facade.
    return footprintPlanes(roofBoundsPolygon(target, {
      ...target.support,
      minY: Math.min(target.resolvedExtents.minY, target.support.minY),
      maxY: Math.max(target.resolvedExtents.maxY, target.support.maxY),
    }))
  }
  for (const roof of resolved) {
    let faces = roof.faces
    for (const target of resolved) {
      if (target === roof) continue
      const peakDifference = peaks.get(target.roof.id)! - peaks.get(roof.roof.id)!
      const incoming = roof.connections.some((c) => c.state === 'joined' && c.targetRoofId === target.roof.id)
      const outgoing = target.connections.some((c) => c.state === 'joined' && c.targetRoofId === roof.roof.id)
      // An abutting roof already stops at this storey's actual facade. Its
      // rectangular roof support can extend past a stepped wall; treating that
      // strip as building interior would cut a second gap below the overhang.
      const abutsBuilding = !incoming && roof.abutments?.some(abutment => abutment.floorId === target.floorId)
      const targetWins = Math.abs(peakDifference) > RIDGE_HEIGHT_TOLERANCE ? peakDifference > 0 : incoming !== outgoing ? incoming : target.roof.id < roof.roof.id
      const buildingPlanes = clippingFootprint(target, roof)
      for (const targetFace of raw.get(target.roof.id)!) {
        const height = roofFaceHeight(targetFace)
        if (!height) continue
        const planes = footprintPlanes(targetFace.map(([x, , y]) => ({ x, y })))
        faces = faces.flatMap((face) => {
          // Coincident panels have one deterministic owner. Otherwise only the
          // part below the other surface is internal to the combined roof.
          if (face.every(([x, y, z]) => Math.abs(height({ x, y: z }) - y) < EPS)) return targetWins ? subtractRoofVolume(face, planes) : [face]
          const below: ClipPlane = ([x, y, z]) => height({ x, y: z }) - y
          // Only the supported building region (plus deliberate connections)
          // encloses the space below a roof. An exposed overhang has air below
          // it; clip another panel there only if it enters the roof shell.
          const outsideBuilding = abutsBuilding ? [face] : subtractRoofVolume(face, [...planes, ...buildingPlanes, below])
          return outsideBuilding.flatMap((piece) => subtractRoofVolume(piece, [...planes, below,
            (point) => getRoofThickness(target.roof) - below(point)]))
        })
      }
    }
    roof.faces = conformRoofFaceEdges(trimUnsupportedOverhangs(roof, faces))
  }
  // Walls use the final envelope inside the ORIGINAL roof coverage. An extension
  // may reach across the house but acquires no authority to cut its walls.
  for (const roof of resolved) {
    const planes = footprintPlanes(roofBoundsPolygon(roof))
    planes.push(...(roof.abutments ?? []).map(({ plane }): ClipPlane => (p) => -plane(p)))
    roof.coverageUndersideFaces = []
    roof.coverageFaces = resolved.flatMap((candidate) => {
      const retain = (faces: Vertex[][]) => {
        roof.coverageUndersideFaces!.push(...faces.map(face => face.map(([x, y, z]): Vertex =>
          [x, y - getRoofThickness(candidate.roof), z])))
        return faces
      }
      const faces = candidate.faces.map((face) => intersect(face, planes)).filter((face) => face.length)
      if (candidate === roof) return retain(faces)
      // Another roof replaces this wall envelope only where it consumed the
      // original panel. Vertically separated overhangs keep separate coverage.
      const buildingPlanes = clippingFootprint(candidate, roof)
      return retain(original.get(roof.roof.id)!.flatMap((source) => {
        const height = roofFaceHeight(source)
        if (!height) return []
        const sourcePlanes = footprintPlanes(source.map(([x, , y]) => ({ x, y })))
        const above: ClipPlane = ([x, y, z]) => y - height({ x, y: z })
        return faces.flatMap((face) => {
          const replacement = intersect(face, [...sourcePlanes, above])
          const supported = intersect(replacement, buildingPlanes)
          const shell = subtractRoofVolume(replacement, buildingPlanes).map((piece) =>
            clipRoofFace(piece, (point) => getRoofThickness(candidate.roof) - above(point)))
          return [supported, ...shell].filter((piece) => piece.length)
        })
      }))
    })
  }
  return inputs.map((input) => resolved.find((roof) => roof.roof.id === input.roof.id)!)
}
