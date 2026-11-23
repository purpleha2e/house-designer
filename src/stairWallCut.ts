import type { FloorLevel } from './types.ts'
import type { ModelDefinition } from './models/modelLibrary.ts'
import { getStairLayout } from './stairDesign.ts'
import { getStairSoffitPanels } from './stairUnderside.ts'

export type StairWallCutFace = [number, number, number][]

/** World-space soffits from stairs on this storey. A wall can run under the flight until it reaches this surface. */
export function getStairWallCutFaces(floor: FloorLevel, models: ReadonlyMap<string, ModelDefinition>): StairWallCutFace[] {
  return floor.models.flatMap(model => {
    const design = models.get(model.modelId)?.stairDesign
    if (!design) return []
    const layout = getStairLayout(design)
    const scale = model.scale || 1
    const widthScale = scale * (model.widthScale || 1) * (model.mirrored ? -1 : 1)
    const depthScale = scale * (model.depthScale || 1)
    const angle = model.rotation + (model.flipped ? Math.PI : 0)
    const cosine = Math.cos(angle), sine = Math.sin(angle)
    // Open flights with no stringers need clearance only to the pitch below their treads.
    const depth = design.closedUnderside || design.stringers ? undefined : design.treadThickness
    return getStairSoffitPanels(design, layout, depth).flatMap(({ ring, triangles }) => {
      const vertices = ring.map(({ x, y, z }): [number, number, number] => [
        model.position.x + x * widthScale * cosine - z * depthScale * sine,
        floor.elevation + y * scale,
        model.position.y + x * widthScale * sine + z * depthScale * cosine,
      ])
      return triangles.map(triangle => triangle.map(index => vertices[index]))
    })
  })
}
