import type { Point, RoofStructure } from './types.ts'

export type RoofBounds = { minX: number; maxX: number; minY: number; maxY: number }
export type RoofProfileVertex = [number, number, number]

export function getRoofSlope(degrees: number) {
  return Math.tan(Math.min(75, Math.max(0, degrees)) * Math.PI / 180)
}

export function getPitchedRoofHeightAtX(roof: RoofStructure, bounds: RoofBounds, x: number) {
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
    : [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX]
}

// Distance along the surface, keeping tile UVs continuous across the pitch break.
export function getPitchedRoofSurfaceDistance(roof: RoofStructure, bounds: RoofBounds, x: number) {
  const mainSlope = getRoofSlope(roof.pitchDegrees)
  const eaveSlope = getRoofSlope(roof.overhangPitchDegrees ?? roof.pitchDegrees)
  const ridgeX = (bounds.minX + bounds.maxX) / 2
  const distance = roof.type === 'lean-to' ? x - bounds.minX : Math.abs(x - ridgeX)
  const mainRun = roof.type === 'lean-to'
    ? Math.max(0, distance)
    : Math.min(distance, (bounds.maxX - bounds.minX) / 2)
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

export function buildHipRoofProfileFaces(roof: RoofStructure, extents: RoofBounds, support: RoofBounds): RoofProfileVertex[][] {
  const xs = [...new Set([extents.minX, support.minX, support.maxX, extents.maxX])].sort((a, b) => a - b)
  const ys = [...new Set([extents.minY, support.minY, support.maxY, extents.maxY])].sort((a, b) => a - b)
  const profiles = hipEdgeProfiles(roof, extents, support)
  const faces: RoofProfileVertex[][] = []
  xs.slice(1).forEach((maxX, xi) => ys.slice(1).forEach((maxY, yi) => {
    const rectangle = [{ x: xs[xi], y: ys[yi] }, { x: maxX, y: ys[yi] }, { x: maxX, y: maxY }, { x: xs[xi], y: maxY }]
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
  }))
  return faces
}
