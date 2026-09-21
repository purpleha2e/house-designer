import type { Box3, Frustum, Vector3 } from 'three'
import type { Wall } from './types.ts'

export const WALL_FADE_DISTANCE_METERS = 1.5

type WallViewQuery = {
  camera: { x: number; y: number; z: number }
  frustum: Frustum
  elevation: number
  walls: Wall[]
}

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

export function getNearbyVisibleBoundsOpacity({
  bounds,
  camera,
  frustum,
}: {
  bounds: Box3
  camera: Vector3
  frustum: Frustum
}) {
  if (bounds.isEmpty() || !frustum.intersectsBox(bounds)) return null
  const distance = bounds.distanceToPoint(camera)
  if (distance > WALL_FADE_DISTANCE_METERS) return null
  return smoothstep(distance / WALL_FADE_DISTANCE_METERS)
}

/** Proximity is measured in plan so a wall can fade and allow picking when the
 * camera is above it. Frustum planes still test the wall's real 3D bounds. */
export function getNearbyVisibleWallOpacities({ camera, frustum, elevation, walls }: WallViewQuery) {
  const result = new Map<string, number>()
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x
    const dz = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dz)
    if (length < 0.0001 || wall.height <= 0) continue
    const ux = dx / length, uz = dz / length
    const halfThickness = Math.max(0, wall.thickness) / 2
    const offsetX = camera.x - wall.start.x
    const offsetZ = camera.z - wall.start.y
    const along = offsetX * ux + offsetZ * uz
    const across = -offsetX * uz + offsetZ * ux
    const distanceAlong = Math.max(-along, along - length, 0)
    const distanceAcross = Math.max(Math.abs(across) - halfThickness, 0)
    const distanceSquared = distanceAlong ** 2 + distanceAcross ** 2
    if (distanceSquared > WALL_FADE_DISTANCE_METERS ** 2) continue

    const centerX = (wall.start.x + wall.end.x) / 2
    const centerY = elevation + wall.height / 2
    const centerZ = (wall.start.y + wall.end.y) / 2
    const visible = frustum.planes.every(({ normal, constant }) => {
      const radius = length / 2 * Math.abs(normal.x * ux + normal.z * uz) +
        halfThickness * Math.abs(-normal.x * uz + normal.z * ux) +
        wall.height / 2 * Math.abs(normal.y)
      return normal.x * centerX + normal.y * centerY + normal.z * centerZ + constant + radius >= 0
    })
    if (visible) {
      result.set(
        wall.id,
        smoothstep(Math.sqrt(distanceSquared) / WALL_FADE_DISTANCE_METERS),
      )
    }
  }
  return result
}

export function getNearbyVisibleWallIds(query: WallViewQuery): Set<string> {
  return new Set(getNearbyVisibleWallOpacities(query).keys())
}
