import type { RoofStructure } from './types.ts'
import { buildRoofProfileFaces, getGableRidgeHeight, getRoofSlope } from './roofProfile.ts'
import { roofToWorld, roofToLocal, type RoofJunctionInput } from './roofJunctions.ts'

export type RoofHeightAlignmentStatus = {
  state: 'linked' | 'unresolved'; targetRoofId: string; message?: string
}

export function normalizeRoofHeightAlignment(value: unknown): RoofStructure['heightAlignment'] {
  if (!value || typeof value !== 'object' || !('targetRoofId' in value) ||
    typeof value.targetRoofId !== 'string' || !value.targetRoofId || !('mode' in value)) return undefined
  if (value.mode === 'slope') return { mode: 'slope', targetRoofId: value.targetRoofId }
  if (value.mode === 'eave' && 'side' in value && (value.side === 'side1' || value.side === 'side2'))
    return { mode: 'eave', targetRoofId: value.targetRoofId, side: value.side }
  return undefined
}

type Vertex = [number, number, number]
function heightPlane(points: Vertex[]) {
  const a = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const b = points[i], c = points[i + 1]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (Math.abs(ny) < 1e-10) continue
    const x = -nx / ny, z = -nz / ny
    return { x, z, height: a[1] - x * a[0] - z * a[2] }
  }
}

function worldFaces(input: RoofJunctionInput) {
  return buildRoofProfileFaces(input.roof, input.extents, input.support)
    .map(face => face.map(p => roofToWorld(input.roof, input.elevation, p)))
}

function boundsGap(a: Vertex[], b: Vertex[]) {
  return [0, 2].reduce((sum, axis) => {
    const gap = Math.max(0, Math.min(...a.map(p => p[axis])) - Math.max(...b.map(p => p[axis])),
      Math.min(...b.map(p => p[axis])) - Math.max(...a.map(p => p[axis])))
    return sum + gap * gap
  }, 0)
}

/** Solve authored constraints before geometry is cut. Never change saved data. */
export function alignRoofHeight(source: RoofJunctionInput, target: RoofJunctionInput):
  { roof?: RoofStructure; message?: string } {
  const alignment = source.roof.heightAlignment!
  if (alignment.mode === 'slope') {
    const candidates: { delta: number; score: number }[] = []
    for (const a of worldFaces(source)) for (const b of worldFaces(target)) {
      const pa = heightPlane(a), pb = heightPlane(b)
      if (!pa || !pb || Math.hypot(pa.x - pb.x, pa.z - pb.z) > 1e-6) continue
      const gap = boundsGap(a, b)
      if (gap > 0.5 * 0.5) continue
      const delta = pb.height - pa.height
      candidates.push({ delta, score: gap + Math.abs(delta) * 1e-6 })
    }
    candidates.sort((a, b) => a.score - b.score)
    if (!candidates.length) return { message: 'No adjoining slope has the same pitch and direction. Match their pitches or use eave alignment.' }
    // Translating a roof with a fixed world ridge would also change its slopes.
    if (source.roof.asymmetricSides && source.roof.ridgeHeightTargetRoofId)
      return { message: 'This roof already has a shared ridge height. Use eave alignment to keep that ridge fixed.' }
    return { roof: { ...source.roof, heightOffset: (source.roof.heightOffset ?? 0) + candidates[0].delta } }
  }
  if (!source.roof.asymmetricSides || source.roof.type !== 'up-and-over' || source.roof.mountSide !== 'free')
    return { message: 'Eave alignment needs asymmetric sides with both side pitches kept.' }
  const x = alignment.side === 'side1' ? source.extents.minX : source.extents.maxX
  const point = roofToWorld(source.roof, source.elevation, [x, 0, (source.support.minY + source.support.maxY) / 2])
  const local = roofToLocal(target.roof, target.elevation, point)
  const options: { height: number; distance: number }[] = []
  for (const face of buildRoofProfileFaces(target.roof, target.extents, target.support)) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length]
      // Outer edges on pitched sides are eaves; gable/rake edges are excluded.
      if (Math.abs(a[0] - b[0]) > 1e-7 ||
        ![target.extents.minX, target.extents.maxX].some(edge => Math.abs(a[0] - edge) < 1e-7)) continue
      if (Math.abs(a[2] - b[2]) < 1e-7) continue
      const t = Math.max(0, Math.min(1, (local[2] - a[2]) / (b[2] - a[2])))
      const edge = roofToWorld(target.roof, target.elevation,
        [a[0], a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
      options.push({ height: edge[1], distance: Math.hypot(point[0] - edge[0], point[2] - edge[2]) })
    }
  }
  options.sort((a, b) => a.distance - b.distance)
  const slope = getRoofSlope(source.roof.pitchDegrees)
  if (!options.length || slope < 1e-7) return { message: 'The target has no suitable eave to match.' }
  const supportX = alignment.side === 'side1' ? source.support.minX : source.support.maxX
  const eaveFall = Math.abs(x - supportX) * getRoofSlope(source.roof.overhangPitchDegrees ?? source.roof.pitchDegrees)
  const ridgeHeight = source.elevation + (source.roof.heightOffset ?? 0) + getGableRidgeHeight(source.roof, source.support)
  const run = (ridgeHeight - options[0].height - eaveFall) / slope
  const ridgeX = alignment.side === 'side1' ? supportX + run : supportX - run
  if (ridgeX < source.support.minX + 0.05 || ridgeX > source.support.maxX - 0.05)
    return { message: 'Matching this eave would put the ridge outside the roof. Choose the other side or change the ridge height.' }
  return { roof: { ...source.roof, ridgeOffset: ridgeX - (source.support.minX + source.support.maxX) / 2 } }
}
