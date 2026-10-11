import type { ModelDefinition } from './models/modelLibrary.ts'
import type { PlacedModel, Point } from './types.ts'
import { getModelHorizontalBounds, getStairOpeningPolygon } from './stairSlabOpenings.ts'

/** Explicit landings support returning/curved stairs; older stairs use the
 * opposite edges of their aperture. Inset is measured in world metres. */
export function getStairLandingPosition(
  model: PlacedModel, definition: ModelDefinition, landing: 'lower' | 'upper', inset = 0,
): Point {
  const scale = model.scale || 1
  const widthScale = model.widthScale || 1, depthScale = model.depthScale || 1
  const bounds = getModelHorizontalBounds(definition)
  const polygon = getStairOpeningPolygon(model.position, model.rotation,
    definition.width, definition.depth, scale, bounds, widthScale, depthScale, model.mirrored === true)
  const local = definition.stairLandings?.[landing]
  let point: Point
  if (local) {
    const x = local.x * scale * widthScale * (model.mirrored ? -1 : 1)
    const z = local.y * scale * depthScale
    point = {
      x: model.position.x + x * Math.cos(model.rotation) - z * Math.sin(model.rotation),
      y: model.position.y + x * Math.sin(model.rotation) + z * Math.cos(model.rotation),
    }
  } else {
    const [a, b] = landing === 'lower' ? [polygon[0], polygon[1]] : [polygon[2], polygon[3]]
    point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  if (!inset) return point
  const center = polygon.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 })
  // Returning stairs land on the same edge. Keep the inset on that flight
  // rather than steering a landing button toward the central well.
  const localDz = local ? ((bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0) - local.y) : 0
  const direction = local
    ? { x: -localDz * Math.sin(model.rotation), y: localDz * Math.cos(model.rotation) }
    : { x: center.x - point.x, y: center.y - point.y }
  const length = Math.hypot(direction.x, direction.y) || 1
  return { x: point.x + inset * direction.x / length, y: point.y + inset * direction.y / length }
}
