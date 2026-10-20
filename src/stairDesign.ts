import { createStairLandingProfile } from './stairLandingProfile.ts'

/** Dimensions are metres. Local +Z is the first direction of ascent. */
export type StairPart = 'treads' | 'risers' | 'stringers' | 'spindles' | 'posts' | 'handrails' | 'underside'
export type StairFinish = { color: string; roughness: number; metalness: number; materialId?: string; textureScale?: number }
export type StairDesign = {
  version: 1
  layout: 'straight' | 'l' | 'u'
  turn: 'left' | 'right'
  turnType: 'landing' | 'winder'
  width: number
  totalRise: number
  riserCount: number
  going: number
  stepsBeforeTurn: number
  winderCount: number
  /** Internal rises across the landing. Absent in legacy layouts. */
  landingSteps?: 0 | 1 | 2 | 3
  landingDepth: number
  wellWidth: number
  treadThickness: number
  nosing: number
  /** Rounded nosing radius; absent/zero keeps square edges. */
  nosingRadius?: number
  closedRisers: boolean
  /** Absent in older varieties, which retain their open underside. */
  closedUnderside?: boolean
  stringers: boolean
  banisters: { left: boolean; right: boolean }
  handrails: { left: boolean; right: boolean }
  railHeight: number
  spindleWidth: number
  spindleSpacing: number
  postWidth: number
  handrailWidth: number
  finishes: Record<Exclude<StairPart, 'underside'>, StairFinish> & { underside?: StairFinish }
}
export type StairPoint = { x: number; z: number }
export type StairSurface = { polygon: StairPoint[]; front: [StairPoint, StairPoint]; top: number; landing: boolean; riser?: boolean; progression: number[] }
export type StairRailPoint = StairPoint & { y: number }
export const stairParts: StairPart[] = ['treads', 'risers', 'stringers', 'spindles', 'posts', 'handrails', 'underside']
export const stairPartLabels: Record<StairPart, string> = {
  treads: 'Treads & landings', risers: 'Risers', stringers: 'Supporting woodwork',
  spindles: 'Spindles', posts: 'Newel posts', handrails: 'Banister / handrails', underside: 'Underside & side panels',
}
/** Generated geometry always has these named regions, including saved varieties. */
export const parametricStairMaterialRegions = stairParts.map(part => ({
  id: `stairs_${part}`, label: stairPartLabels[part], sourceMaterialNames: [`stairs_${part}`],
}))
export function getStairFinish(design: StairDesign, part: StairPart): StairFinish {
  return design.finishes[part] ?? { color: '#eeeae1', roughness: .8, metalness: 0 }
}
export function createStairDesign(totalRise = 2.7): StairDesign {
  const wood = { color: '#a87948', roughness: .6, metalness: 0 }
  const paint = { color: '#eeeae1', roughness: .55, metalness: 0 }
  const riserCount = Math.max(4, Math.min(48, Math.round(totalRise / .18)))
  return { version: 1, layout: 'straight', turn: 'right', turnType: 'landing', width: .9,
    totalRise, riserCount, going: .25, stepsBeforeTurn: Math.floor(riserCount / 2), winderCount: 3, landingSteps: 0,
    landingDepth: .9, wellWidth: .1, treadThickness: .035, nosing: .02, closedRisers: true, closedUnderside: true,
    stringers: true, banisters: { left: true, right: true }, handrails: { left: true, right: true },
    railHeight: .95, spindleWidth: .04, spindleSpacing: .14, postWidth: .075, handrailWidth: .055,
    finishes: { treads: { ...wood }, risers: { ...paint }, stringers: { ...paint },
      spindles: { ...paint }, posts: { ...paint }, handrails: { ...wood }, underside: { ...paint, roughness: .8 } } }
}

export function stairTurnSteps(design: StairDesign) {
  return design.layout === 'straight' ? 0 : design.turnType === 'winder' ? design.winderCount : design.landingSteps ?? 0
}
export function validateStairDesign(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'The stair design is missing.'
  const d = value as StairDesign
  if (d.version !== 1 || !['straight', 'l', 'u'].includes(d.layout) || !['left', 'right'].includes(d.turn) ||
    !['landing', 'winder'].includes(d.turnType)) return 'The stair layout is invalid.'
  const ranges: [keyof StairDesign, number, number][] = [
    ['width', .4, 3], ['totalRise', .3, 8], ['going', .1, .6], ['landingDepth', .4, 4], ['wellWidth', .04, 2],
    ['treadThickness', .01, .12], ['nosing', 0, .06], ['railHeight', .4, 1.5], ['spindleWidth', .01, .1],
    ['spindleSpacing', .06, .4], ['postWidth', .03, .2], ['handrailWidth', .025, .15],
  ]
  if (ranges.some(([key, min, max]) => typeof d[key] !== 'number' || !Number.isFinite(d[key]) || (d[key] as number) < min || (d[key] as number) > max))
    return 'One or more dimensions are outside their allowed range.'
  if (d.nosingRadius !== undefined && (!Number.isFinite(d.nosingRadius) || d.nosingRadius < 0 || d.nosingRadius > .06))
    return 'Choose a tread-edge radius between 0 and 60 mm.'
  if (!Number.isInteger(d.riserCount) || d.riserCount < 2 || d.riserCount > 48) return 'Choose between 2 and 48 risers.'
  const rise = d.totalRise / d.riserCount
  if (rise < .06 || rise > .35) return 'Adjust the rise or riser count: each riser must be between 60 and 350 mm.'
  if (d.treadThickness >= rise) return 'Tread thickness must be less than the riser height.'
  if (!Number.isInteger(d.winderCount) || d.winderCount < 2 || d.winderCount > 12) return 'Choose between 2 and 12 winding treads.'
  if (d.landingSteps !== undefined && (!Number.isInteger(d.landingSteps) || d.landingSteps < 0 || d.landingSteps > 3))
    return 'Choose a flat landing or between 1 and 3 landing steps.'
  if (d.layout !== 'straight' && (!Number.isInteger(d.stepsBeforeTurn) || d.stepsBeforeTurn < 1 || d.stepsBeforeTurn >= d.riserCount - stairTurnSteps(d)))
    return 'Leave at least one straight step before and after the turn.'
  if (d.layout !== 'straight' && d.turnType === 'landing' && d.landingDepth < d.width) return 'Landing depth must be at least the stair width.'
  if (d.layout !== 'straight' && d.turnType === 'landing' && d.landingSteps !== undefined &&
    (d.stepsBeforeTurn < 2 || d.riserCount - d.stepsBeforeTurn - stairTurnSteps(d) < 2))
    return 'Leave at least two risers in each flight, including the rise onto its landing or floor.'
  if (typeof d.closedRisers !== 'boolean' || (d.closedUnderside !== undefined && typeof d.closedUnderside !== 'boolean') || typeof d.stringers !== 'boolean' ||
    [d.banisters?.left, d.banisters?.right, d.handrails?.left, d.handrails?.right].some(v => typeof v !== 'boolean')) return 'The railing settings are invalid.'
  if (d.spindleSpacing < d.spindleWidth || d.postWidth >= d.width || d.handrailWidth >= d.width) return 'Railing widths and spacing must fit the staircase.'
  for (const part of stairParts) {
    const f = d.finishes?.[part]
    if (part === 'underside' && f === undefined) continue
    if (!f || !/^#[0-9a-f]{6}$/i.test(f.color) || !Number.isFinite(f.roughness) || f.roughness < 0 || f.roughness > 1 ||
      !Number.isFinite(f.metalness) || f.metalness < 0 || f.metalness > 1 ||
      (f.materialId !== undefined && typeof f.materialId !== 'string') ||
      (f.textureScale !== undefined && (!Number.isFinite(f.textureScale) || f.textureScale < .01 || f.textureScale > 100)))
      return 'Choose valid colours and finishes for each part (texture scale 0.01–100).'
  }
  return null
}

export function getStairLayout(d: StairDesign) {
  const error = validateStairDesign(d)
  if (error) throw new Error(error)
  const surfaces: StairSurface[] = [], left: StairRailPoint[] = [], right: StairRailPoint[] = []
  const flights: { left: StairRailPoint[]; right: StairRailPoint[] }[] = []
  const footprints: StairPoint[][] = []
  const r = d.totalRise / d.riserCount, w = d.width
  const compactLanding = d.layout !== 'straight' && d.turnType === 'landing' && d.landingSteps !== undefined
  function flight(count: number, start: StairPoint, angle: number, step: number) {
    const forward = { x: Math.sin(angle), z: Math.cos(angle) }, side = { x: Math.cos(angle), z: -Math.sin(angle) }
    const point = (along: number, across: number): StairPoint => ({
      x: start.x + along * forward.x + across * side.x, z: start.z + along * forward.z + across * side.z })
    const paths = { left: [] as StairRailPoint[], right: [] as StairRailPoint[] }
    const treadCount = compactLanding ? count - 1 : count
    for (let i = 0; i < treadCount; i++) {
      const near = i * d.going, far = near + d.going
      const polygon = [point(near, -w / 2), point(near, w / 2), point(far, w / 2), point(far, -w / 2)]
      surfaces.push({ polygon, front: [polygon[0], polygon[1]], top: (step + i + 1) * r, landing: false, progression: [0, 0, 1, 1] })
    }
    for (const [name, across] of [['left', -w / 2], ['right', w / 2]] as const) {
      // The rail follows the pitch line; individual spindles start on the treads.
      for (let i = 0; i <= treadCount; i++) paths[name].push({ ...point(i * d.going, across), y: (step + i + (compactLanding ? 1 : 0)) * r })
      ;(name === 'left' ? left : right).push(...paths[name])
    }
    footprints.push([point(0, -w / 2), point(0, w / 2), point(treadCount * d.going, w / 2), point(treadCount * d.going, -w / 2)])
    flights.push(paths)
    return point(treadCount * d.going, 0)
  }
  const lower: StairPoint = { x: 0, z: 0 }
  let upper: StairPoint
  if (d.layout === 'straight') upper = flight(d.riserCount, lower, 0, 0)
  else {
    const k = d.stepsBeforeTurn, turns = stairTurnSteps(d), start = flight(k, lower, 0, 0)
    let exit: StairPoint
    if (compactLanding) {
      const landing = createStairLandingProfile(d, start, k, r)
      surfaces.push(...landing.surfaces); footprints.push(landing.footprint)
      left.push(...landing.outer); right.push(...landing.inner)
      exit = landing.exit
    } else if (d.turnType === 'landing') {
      const maxX = d.layout === 'u' ? 1.5 * w + d.wellWidth : w / 2
      const polygon = [{ x: -w / 2, z: start.z }, { x: maxX, z: start.z },
        { x: maxX, z: start.z + d.landingDepth }, { x: -w / 2, z: start.z + d.landingDepth }]
      surfaces.push({ polygon, front: [polygon[0], polygon[1]], top: k * r, landing: true, progression: polygon.map(() => 0) }); footprints.push(polygon)
      left.push({ x: -w / 2, z: start.z + d.landingDepth, y: k * r }, { x: maxX, z: start.z + d.landingDepth, y: k * r })
      if (d.layout === 'u') {
        exit = { x: w + d.wellWidth, z: start.z }
        left.push({ x: maxX, z: start.z, y: k * r })
        right.push({ x: w / 2 + d.wellWidth, z: start.z, y: k * r })
      } else {
        exit = { x: w / 2, z: start.z + d.landingDepth - w / 2 }
        right.push({ x: w / 2, z: start.z + d.landingDepth - w, y: k * r })
      }
    } else {
      const angle = d.layout === 'u' ? Math.PI : Math.PI / 2
      const inner = d.layout === 'u' ? d.wellWidth / 2 : 0
      const outer = w + inner, pivot = w / 2 + inner
      const square = (a: number, radius: number): StairPoint => {
        const distance = radius / Math.max(Math.abs(Math.cos(a)), Math.sin(a))
        return { x: pivot - Math.cos(a) * distance, z: start.z + Math.sin(a) * distance }
      }
      for (let j = 0; j < turns; j++) {
        const a = j * angle / turns, b = (j + 1) * angle / turns
        const angles = [a, ...[Math.PI / 4, 3 * Math.PI / 4].filter(v => v > a + 1e-8 && v < b - 1e-8), b]
        const polygon = [...angles.map(v => square(v, outer)), ...angles.toReversed().map(v => square(v, inner))]
        surfaces.push({ polygon, front: [polygon.at(-1)!, polygon[0]], top: (k + j + 1) * r, landing: false,
          progression: [...angles, ...angles.toReversed()].map(v => (v - a) / (b - a)) })
        for (const v of angles.slice(1)) {
          const y = (k + (j + (v - a) / (b - a))) * r
          left.push({ ...square(v, outer), y }); right.push({ ...square(v, inner), y })
        }
      }
      footprints.push([square(0, outer), square(angle / 2, outer), square(angle, outer), square(angle, inner), square(0, inner)])
      exit = d.layout === 'u' ? { x: w + d.wellWidth, z: start.z } : { x: w / 2, z: start.z + w / 2 }
    }
    upper = flight(d.riserCount - k - turns, exit, d.layout === 'u' ? Math.PI : Math.PI / 2, k + turns)
  }
  // Left and right refer to the side while ascending; mirroring swaps them.
  const mirror = d.layout !== 'straight' && d.turn === 'left' ? -1 : 1
  for (const point of new Set([...surfaces.flatMap(s => [...s.polygon, ...s.front]), ...left, ...right, lower, upper, ...footprints.flat()])) point.x *= mirror
  if (mirror < 0) { const copy = [...left]; left.splice(0, left.length, ...right); right.splice(0, right.length, ...copy) }
  const points = surfaces.flatMap(s => s.polygon)
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z))
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  // Some layout vertices are shared between lists: transform each reference once.
  const all = new Set([...points, ...surfaces.flatMap(s => s.front), ...left, ...right, lower, upper, ...footprints.flat(), ...flights.flatMap(f => [...f.left, ...f.right])])
  for (const point of all) { point.x -= cx; point.z -= cz }
  return { surfaces, left, right, flights, footprints, lower, upper, compactLanding,
    bounds: { minX: minX - cx, maxX: maxX - cx, minZ: minZ - cz, maxZ: maxZ - cz }, riserHeight: r }
}

export function stairThumbnail(design: StairDesign) {
  const layout = getStairLayout(design), b = layout.bounds, pad = .12
  const paths = layout.surfaces.map(s => `<polygon points="${s.polygon.map(p => `${p.x},${-p.z}`).join(' ')}" fill="${design.finishes.treads.color}" stroke="#405368" stroke-width=".012"/>`).join('')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX-pad} ${-b.maxZ-pad} ${b.maxX-b.minX+2*pad} ${b.maxZ-b.minZ+2*pad}">${paths}</svg>`)}`
}
