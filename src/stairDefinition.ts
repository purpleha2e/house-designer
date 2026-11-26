import type { ModelDefinition } from './models/modelLibrary.ts'
import { getStairLayout, parametricStairMaterialRegions, stairThumbnail, validateStairDesign, type StairDesign } from './stairDesign.ts'

export function stairDefinition(id: string, name: string, design: StairDesign): ModelDefinition {
  const error = validateStairDesign(design)
  if (error) throw new Error(error)
  const layout = getStairLayout(design), first = layout.flights[0].left, last = layout.flights.at(-1)!.left
  const direction = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / length, y: (b.z - a.z) / length }
  }
  return { id, name: name.trim() || 'Custom stairs', category: 'My stairs', objectType: 'stairs', shape: 'box',
    color: design.finishes.treads.color, width: layout.bounds.maxX - layout.bounds.minX,
    depth: layout.bounds.maxZ - layout.bounds.minZ, height: design.totalRise,
    stairDesign: structuredClone(design), localBounds: layout.bounds,
    materialRegions: parametricStairMaterialRegions,
    stairLandings: { lower: { x: layout.lower.x, y: layout.lower.z }, upper: { x: layout.upper.x, y: layout.upper.z } },
    stairLandingDirections: { lower: direction(first[0], first.at(-1)!), upper: direction(last.at(-1)!, last[0]) },
    stairFootprint: design.layout === 'l' ? layout.footprints.map(polygon => polygon.map(p => ({ x: p.x, y: p.z }))) : undefined,
    previewUrl: stairThumbnail(design) }
}
