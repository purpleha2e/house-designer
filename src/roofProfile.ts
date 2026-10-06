import type { Point, RoofStructure } from './types.ts'
import { buildBayRoofFaces } from './bayRoof.ts'

export { DEFAULT_ROOF_THICKNESS_METERS as ROOF_TILE_THICKNESS_METERS } from './roofThickness.ts'

export type RoofBounds = { minX: number; maxX: number; minY: number; maxY: number }
export type RoofProfileVertex = [number, number, number]

export function buildRoofProfileFaces(roof: RoofStructure, extents: RoofBounds, support: RoofBounds): RoofProfileVertex[][] {
  if (roof.type === 'bay') return buildBayRoofFaces(roof)
  if (roof.type === 'hip') return buildHipRoofProfileFaces(roof, extents, support)
  const breaks = roof.type === 'flat' ? [] : getPitchedRoofBreaks(roof, support)
  const xs = [...new Set([extents.minX, ...breaks.filter((x) => x > extents.minX && x < extents.maxX), extents.maxX])].sort((a, b) => a - b)
  if (roof.type !== 'up-and-over' || (!roof.ridgeStartChamfer && !roof.ridgeEndChamfer)) {
    return xs.slice(1).map((maxX, i) => [
      [xs[i], extents.minY], [maxX, extents.minY], [maxX, extents.maxY], [xs[i], extents.maxY],
    ].map(([x, z]) => [x, roof.type === 'flat' ? 0 : getPitchedRoofHeightAtX(roof, support, x), z]))
  }

  return buildChamferedGableProfileFaces(roof, extents, support, xs)
}

export function getRoofSlope(degrees: number) {
  return Math.tan(Math.min(75, Math.max(0, degrees)) * Math.PI / 180)
}

export function getGableRidgeX(roof: RoofStructure, bounds: RoofBounds) {
  const centre = (bounds.minX + bounds.maxX) / 2
  const limit = Math.max(0, (bounds.maxX - bounds.minX) / 2 - 0.05)
  const offset = roof.asymmetricSides && Number.isFinite(roof.ridgeOffset) ? roof.ridgeOffset! : 0
  return centre + Math.max(-limit, Math.min(limit, offset))
}

export function getGableRidgeHeight(roof: RoofStructure, bounds: RoofBounds) {
  return roof.asymmetricSides && Number.isFinite(roof.ridgeHeight) ? roof.ridgeHeight!
    : (bounds.maxX - bounds.minX) / 2 * getRoofSlope(roof.pitchDegrees)
}

/** The ridge and one support height determine that side's pitch. The other
 * side retains the authored pitch and can descend below its wall tops. */
export function getPitchedRoofSideSlope(roof: RoofStructure, bounds: RoofBounds, x: number) {
  const authored = getRoofSlope(roof.pitchDegrees)
  if (roof.type !== 'up-and-over' || !roof.asymmetricSides || roof.mountSide === 'free') return authored
  const ridge = getGableRidgeX(roof, bounds), height = getGableRidgeHeight(roof, bounds)
  if (height < 0) return authored
  const side = roof.mountSide === 'side1' ? -1 : roof.mountSide === 'side2' ? 1
    : ridge <= (bounds.minX + bounds.maxX) / 2 ? -1 : 1
  if ((x <= ridge ? -1 : 1) !== side) return authored
  const run = side < 0 ? ridge - bounds.minX : bounds.maxX - ridge
  return height / Math.max(0.05, run)
}

export function getPitchedRoofHeightAtX(roof: RoofStructure, bounds: RoofBounds, x: number) {
  if (roof.type === 'up-and-over' && roof.asymmetricSides) {
    const ridgeX = getGableRidgeX(roof, bounds), height = getGableRidgeHeight(roof, bounds)
    const within = Math.max(bounds.minX, Math.min(bounds.maxX, x))
    const slope = getPitchedRoofSideSlope(roof, bounds, x)
    return height - Math.abs(within - ridgeX) * slope -
      Math.abs(x - within) * (roof.overhangPitchDegrees === undefined ? slope : getRoofSlope(roof.overhangPitchDegrees))
  }
  const run = roof.type === 'lean-to'
    ? x - bounds.minX
    : Math.min(x - bounds.minX, bounds.maxX - x)
  return run * getRoofSlope(run < 0
    ? roof.overhangPitchDegrees ?? roof.pitchDegrees
    : roof.pitchDegrees)
}

export function getPitchedRoofBreaks(roof: RoofStructure, bounds: RoofBounds) {
  return roof.type === 'lean-to'
    ? [bounds.minX]
    : [bounds.minX, getGableRidgeX(roof, bounds), bounds.maxX]
}

// Distance along the surface, keeping tile UVs continuous across the pitch break.
export function getPitchedRoofSurfaceDistance(roof: RoofStructure, bounds: RoofBounds, x: number) {
  const mainSlope = getPitchedRoofSideSlope(roof, bounds, x)
  const eaveSlope = roof.overhangPitchDegrees === undefined ? mainSlope : getRoofSlope(roof.overhangPitchDegrees)
  const ridgeX = getGableRidgeX(roof, bounds)
  const distance = roof.type === 'lean-to' ? x - bounds.minX : Math.abs(x - ridgeX)
  const mainRun = roof.type === 'lean-to'
    ? Math.max(0, distance)
    : Math.min(distance, x < ridgeX ? ridgeX - bounds.minX : bounds.maxX - ridgeX)
  return mainRun * Math.hypot(1, mainSlope) +
    (distance - mainRun) * Math.hypot(1, eaveSlope)
}

function hipEdgeProfiles(roof: RoofStructure, extents: RoofBounds, support: RoofBounds) {
  const slope = getRoofSlope(roof.pitchDegrees)
  const eaveSlope = getRoofSlope(roof.overhangPitchDegrees ?? roof.pitchDegrees)
  return [
    { distance: (p: Point) => p.x - extents.minX, overhang: support.minX - extents.minX },
    { distance: (p: Point) => extents.maxX - p.x, overhang: extents.maxX - support.maxX },
    { distance: (p: Point) => p.y - extents.minY, overhang: support.minY - extents.minY },
    { distance: (p: Point) => extents.maxY - p.y, overhang: extents.maxY - support.maxY },
  ].map(({ distance, overhang }) => (point: Point) => {
    const run = distance(point)
    return run >= overhang ? run * slope : overhang * slope + (run - overhang) * eaveSlope
  })
}

export function getHipRoofProfileHeight(roof: RoofStructure, extents: RoofBounds, support: RoofBounds, point: Point) {
  return Math.min(...hipEdgeProfiles(roof, extents, support).map((height) => height(point)))
}

function clipProfilePolygon(polygon: Point[], distance: (point: Point) => number) {
  const result: Point[] = []
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const a = distance(previous)
    const b = distance(current)
    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b)
      result.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t })
    }
    if (b >= 0) result.push(current)
  })
  return result
}

type HeightProfile = (point: Point) => number

/** Deep chamfers may lower the eaves. Opposing chamfers can meet, not overlap. */
export function getGableChamferLimits(roof: RoofStructure, extents: RoofBounds, support?: RoofBounds) {
  const depth = Math.max(0, extents.maxY - extents.minY)
  const ends = [roof.ridgeStartChamfer, roof.ridgeEndChamfer].map(chamfer => {
    let distance = chamfer?.distance ?? 0
    if (chamfer?.matchEave && support) {
      const slope = getRoofSlope(chamfer.angleDegrees)
      const height = getGableRidgeHeight(roof, support)
      const eave = Math.max(getPitchedRoofHeightAtX(roof, support, extents.minX),
        getPitchedRoofHeightAtX(roof, support, extents.maxX))
      if (slope > 0) distance = Math.max(0, height - eave) / slope
    }
    return { distance: Number.isFinite(distance) ? Math.min(depth, Math.max(0, distance)) : 0 }
  })
  const total = ends[0].distance + ends[1].distance
  if (total > depth) ends.forEach(end => { end.distance *= depth / total })
  return {
    ridgeStartChamfer: { distance: ends[0].distance, maximum: depth - ends[1].distance },
    ridgeEndChamfer: { distance: ends[1].distance, maximum: depth - ends[0].distance },
  }
}

function addLowestProfileFaces(
  faces: RoofProfileVertex[][],
  rectangle: Point[],
  profiles: HeightProfile[],
) {
  profiles.forEach((height, index) => {
    let polygon = rectangle
    profiles.forEach((otherHeight, otherIndex) => {
      if (otherIndex < index && rectangle.every((p) => Math.abs(otherHeight(p) - height(p)) < 0.000000001)) {
        polygon = []
      }
      if (index !== otherIndex) polygon = clipProfilePolygon(polygon, (p) => otherHeight(p) - height(p))
    })
    const area = Math.abs(polygon.reduce((sum, p, i) => {
      const next = polygon[(i + 1) % polygon.length]
      return sum + p.x * next.y - next.x * p.y
    }, 0)) / 2
    if (area > 0.000001) faces.push(polygon.map((p) => [p.x, height(p), p.y]))
  })
}

function buildChamferedGableProfileFaces(
  roof: RoofStructure,
  extents: RoofBounds,
  support: RoofBounds,
  xs: number[],
) {
  const limits = getGableChamferLimits(roof, extents, support)
  const startDistance = limits.ridgeStartChamfer.distance
  const endDistance = limits.ridgeEndChamfer.distance
  const startInnerY = extents.minY + startDistance
  const endInnerY = extents.maxY - endDistance
  const ys = [...new Set([
    extents.minY,
    ...(startDistance > 0 ? [startInnerY] : []),
    ...(endDistance > 0 ? [endInnerY] : []),
    extents.maxY,
  ])].sort((a, b) => a - b)
  const ridgeX = getGableRidgeX(roof, support)
  const ridgeHeight = getPitchedRoofHeightAtX(roof, support, ridgeX)
  const faces: RoofProfileVertex[][] = []

  xs.slice(1).forEach((maxX, xi) => ys.slice(1).forEach((maxY, yi) => {
    const minX = xs[xi]
    const minY = ys[yi]
    const rectangle = [
      { x: minX, y: minY }, { x: maxX, y: minY },
      { x: maxX, y: maxY }, { x: minX, y: maxY },
    ]
    const middleY = (minY + maxY) / 2
    const profiles: HeightProfile[] = [(point) => getPitchedRoofHeightAtX(roof, support, point.x)]

    if (roof.ridgeStartChamfer && startDistance > 0 && middleY <= startInnerY) {
      const slope = getRoofSlope(roof.ridgeStartChamfer.angleDegrees)
      profiles.push((point) => ridgeHeight - (startInnerY - point.y) * slope)
    }
    if (roof.ridgeEndChamfer && endDistance > 0 && middleY >= endInnerY) {
      const slope = getRoofSlope(roof.ridgeEndChamfer.angleDegrees)
      profiles.push((point) => ridgeHeight - (point.y - endInnerY) * slope)
    }

    addLowestProfileFaces(faces, rectangle, profiles)
  }))

  return faces
}

export function buildHipRoofProfileFaces(roof: RoofStructure, extents: RoofBounds, support: RoofBounds): RoofProfileVertex[][] {
  const xs = [...new Set([extents.minX, support.minX, support.maxX, extents.maxX])].sort((a, b) => a - b)
  const ys = [...new Set([extents.minY, support.minY, support.maxY, extents.maxY])].sort((a, b) => a - b)
  const profiles = hipEdgeProfiles(roof, extents, support)
  const faces: RoofProfileVertex[][] = []
  xs.slice(1).forEach((maxX, xi) => ys.slice(1).forEach((maxY, yi) => {
    const rectangle = [{ x: xs[xi], y: ys[yi] }, { x: maxX, y: ys[yi] }, { x: maxX, y: maxY }, { x: xs[xi], y: maxY }]
    addLowestProfileFaces(faces, rectangle, profiles)
  }))
  return faces
}
