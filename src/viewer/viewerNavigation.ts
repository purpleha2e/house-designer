import type { FloorLevel, Point, ThreeDViewCameraState } from '../types.ts'
import type { ModelDefinition } from '../models/modelLibrary.ts'
import { getModelHorizontalBounds, getStairOpeningPolygon } from '../stairSlabOpenings.ts'

export type ViewerNavigationMode = 'walk' | 'fly'
export const VIEWER_HEAD_HEIGHT = 1.8

/** Walking follows yaw; flying follows the full direction of the camera. */
export function getViewerMovement(
  mode: ViewerNavigationMode, keys: ReadonlySet<string>,
  forward: readonly number[], right: readonly number[],
) {
  const flatten = (v: readonly number[]) => {
    const y = mode === 'walk' ? 0 : v[1]
    const length = Math.hypot(v[0], y, v[2]) || 1
    return [v[0] / length, y / length, v[2] / length]
  }
  const f = flatten(forward), r = flatten(right)
  const longitudinal = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  const lateral = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const vertical = mode === 'fly' ? Number(keys.has('KeyE')) - Number(keys.has('KeyQ')) : 0
  const movement = [f[0] * longitudinal + r[0] * lateral,
    f[1] * longitudinal + r[1] * lateral + vertical,
    f[2] * longitudinal + r[2] * lateral]
  const length = Math.hypot(...movement) || 1
  return movement.map(value => value / length)
}

export function getViewerStartCamera(floor: FloorLevel): ThreeDViewCameraState {
  const points = floor.walls.flatMap(wall => [wall.start, wall.end])
  const x = points.length ? (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2 : 0
  const z = points.length ? Math.max(...points.map(p => p.y)) + 2 : 4
  return { position: { x, y: floor.elevation + VIEWER_HEAD_HEIGHT, z },
    quaternion: { x: 0, y: 0, z: 0, w: 1 } }
}

export type ViewerStairTransition = {
  id: string
  label: string
  from: Point
  to: Point
  targetFloorId: string
}

/** Both ends use the same rotated/scaled footprint as the rendered stair opening. */
export function getViewerStairTransitions(
  floor: FloorLevel, floors: FloorLevel[], definitions: ReadonlyMap<string, ModelDefinition>,
): ViewerStairTransition[] {
  const sorted = [...floors].sort((a, b) => a.elevation - b.elevation)
  const below = sorted.filter(candidate => candidate.elevation < floor.elevation).at(-1)
  const above = sorted.find(candidate => candidate.elevation > floor.elevation)
  const transitions: ViewerStairTransition[] = []
  for (const [source, target, direction] of [[floor, above, 'up'], [below, floor, 'down']] as const) {
    if (!source || !target) continue
    for (const model of source.models) {
      const definition = definitions.get(model.modelId)
      if (definition?.objectType !== 'stairs') continue
      const polygon = getStairOpeningPolygon(model.position, model.rotation,
        definition.width, definition.depth, model.scale ?? 1,
        getModelHorizontalBounds(definition), model.widthScale ?? 1, model.depthScale ?? 1,
        model.mirrored === true)
      const landing = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const lower = landing(polygon[0], polygon[1]), upper = landing(polygon[2], polygon[3])
      const destination = direction === 'up' ? target : source
      transitions.push({ id: `${direction}:${model.id}`, label: `${direction === 'up' ? 'Upstairs' : 'Downstairs'} · ${destination.name}`,
        from: direction === 'up' ? lower : upper, to: direction === 'up' ? upper : lower,
        targetFloorId: destination.id })
    }
  }
  return transitions
}
