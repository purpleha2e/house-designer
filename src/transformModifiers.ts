import type { Point } from './types.ts'

export type TransformModifiers = { ctrlKey: boolean; shiftKey: boolean }
export const TRANSFORM_ANGLE_STEP = Math.PI / 4

/** Shift constrains direction independently of Ctrl's snapping override. */
export function getTransformDragDelta(delta: Point, modifiers: TransformModifiers, step = 0): Point {
  let constrained = delta
  if (modifiers.shiftKey) {
    const direction = Math.round(Math.atan2(delta.y, delta.x) / TRANSFORM_ANGLE_STEP)
    const x = Math.round(Math.cos(direction * TRANSFORM_ANGLE_STEP))
    const y = Math.round(Math.sin(direction * TRANSFORM_ANGLE_STEP))
    const amount = (delta.x * x + delta.y * y) / (x * x + y * y)
    constrained = { x: x ? x * amount : 0, y: y ? y * amount : 0 }
  }
  return modifiers.ctrlKey || step <= 0 ? constrained : {
    x: Math.round(constrained.x / step) * step,
    y: Math.round(constrained.y / step) * step,
  }
}

export function getTransformRotation(angle: number, modifiers: TransformModifiers) {
  return modifiers.shiftKey ? Math.round(angle / TRANSFORM_ANGLE_STEP) * TRANSFORM_ANGLE_STEP : angle
}

export function getSpatialDragDelta(delta: { x: number; y: number; z: number }, modifiers: TransformModifiers) {
  if (!modifiers.shiftKey) return delta
  // Axes and face diagonals, so the same constraint works on every 3D gizmo plane.
  let best = { x: 0, y: 0, z: 0 }, bestDistance = Infinity
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const lengthSquared = x * x + y * y + z * z
    if (!lengthSquared || lengthSquared === 3) continue
    const amount = (delta.x * x + delta.y * y + delta.z * z) / lengthSquared
    const candidate = { x: x ? x * amount : 0, y: y ? y * amount : 0, z: z ? z * amount : 0 }
    const distance = (delta.x - candidate.x) ** 2 + (delta.y - candidate.y) ** 2 + (delta.z - candidate.z) ** 2
    if (distance < bestDistance) { best = candidate; bestDistance = distance }
  }
  return best
}
