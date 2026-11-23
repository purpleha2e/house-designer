import { Box3, Vector3 } from 'three'
import { fastGIRoom } from './fastGI.ts'
import type { IndirectFloor } from './indirectLighting.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'

export const MODELLING_LIGHTING_OPTIONS = {
  enabled: true, hybrid: true, mode: 'fast' as const,
  viewsPerFrame: 1, bounces: 3, frameBudgetMs: 2,
}

/** Finish the current snapshot, then consume the newest edit. Continuous input
 * must neither restart every capture nor postpone the first update forever. */
export function createModellingLightingSchedule(quietMs = 80, maximumWaitMs = 350) {
  let desired = '', started = '', pendingSince = Infinity, changedAt = Infinity
  let running = false
  return {
    observe(key: string, now: number) {
      if (key === desired) return
      desired = key; changedAt = now
      if (!Number.isFinite(pendingSince)) pendingSince = now
      if (desired === started) pendingSince = Infinity
    },
    take(now: number, blocked: boolean) {
      if (blocked || running || desired === started || !desired) return undefined
      if (now - changedAt < quietMs && now - pendingSince < maximumWaitMs) return undefined
      started = desired; pendingSince = Infinity; running = true
      return started
    },
    finish() { running = false },
    reset() { desired = ''; started = ''; pendingSince = Infinity; changedAt = Infinity; running = false },
    get pending() { return desired !== started },
    get running() { return running },
  }
}

export type ModellingLightingVolume = {
  key: string; bounds: Box3; anchor: Vector3; polygon?: { x: number; y: number }[]
  additionalAnchors?: Vector3[]
}

/** Keep the field fixed throughout the storey so adjacent rooms get lighting
 * before the camera reaches them. Very large plans use bounded, snapped tiles. */
export function modellingLightingVolume(floors: IndirectFloor[], camera: Vector3,
  geometryBounds?: Box3): ModellingLightingVolume | null {
  const floor = floors.find(floor => camera.y >= floor.elevation && camera.y <= floor.elevation + floor.height &&
    floor.rooms.some(room => pointIsInsideRoomPolygon({ x: camera.x, y: camera.z }, room.polygon))) ??
    floors.reduce<IndirectFloor | undefined>((best, next) =>
    !best || Math.abs(next.elevation + next.height * .5 - camera.y) <
      Math.abs(best.elevation + best.height * .5 - camera.y) ? next : best, undefined)
  const bounds = geometryBounds?.clone() ?? new Box3()
  const polygons = [...(floor?.rooms.map(room => room.polygon) ?? []), ...(floor?.indoorPartitions ?? [])]
  for (const polygon of polygons) for (const point of polygon) {
    bounds.expandByPoint(new Vector3(point.x, floor!.elevation, point.y))
    bounds.expandByPoint(new Vector3(point.x, floor!.elevation + floor!.height, point.y))
  }
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return null
  if (floor) { bounds.min.y = floor.elevation; bounds.max.y = floor.elevation + Math.max(.5, floor.height) }
  bounds.expandByScalar(.3)
  if (floor?.rooms.length) {
    // Keep less than one cell outside the ceiling to avoid sampling the
    // adjacent storey's bright air at a wall/ceiling joint.
    const padding = Math.min(.015, floor.height / 128)
    bounds.min.y = floor.elevation - padding
    bounds.max.y = floor.elevation + floor.height + padding
  }
  const centre = bounds.getCenter(new Vector3())
  for (const axis of ['x', 'z'] as const) {
    if (bounds.max[axis] - bounds.min[axis] > 20) {
      // Quantised cells change only after substantial navigation in an open plan.
      centre[axis] = Math.max(bounds.min[axis] + 10, Math.min(bounds.max[axis] - 10, Math.round(camera[axis] / 8) * 8))
      bounds.min[axis] = centre[axis] - 10; bounds.max[axis] = centre[axis] + 10
    }
    if (bounds.max[axis] - bounds.min[axis] < 2) {
      bounds.min[axis] = centre[axis] - 1; bounds.max[axis] = centre[axis] + 1
    }
  }
  if (bounds.max.y - bounds.min.y > 8) bounds.max.y = bounds.min.y + 8
  const fallbackAnchor = bounds.getCenter(new Vector3())
  fallbackAnchor.y = Math.min(bounds.max.y - .2, bounds.min.y + 1.5)
  // One starting position per room, excluding that room's doorway patches.
  // The main capture gets the largest room's reverse views and all anchors
  // are selected from the plan, independent of where the camera is pointed.
  const seen = new Set<string>()
  const rooms = floor?.rooms.flatMap(room => {
    if (seen.has(room.signature)) return []
    seen.add(room.signature)
    const capture = fastGIRoom([{ ...floor, rooms: [room] }], fallbackAnchor)
    return capture && bounds.containsPoint(capture.anchor) ? [capture] : []
  }) ?? []
  const area = (room: typeof rooms[number]) => {
    const size = room.bounds.getSize(new Vector3())
    return size.x * size.z
  }
  rooms.sort((a, b) => area(b) - area(a) || a.key.localeCompare(b.key))
  const [primary, ...others] = rooms
  const scope = floor?.rooms.length ? 'storey' : 'open'
  const key = `${scope}:${floor?.id ?? 'scene'}:${[...bounds.min.toArray(), ...bounds.max.toArray()].join(',')}`
  return { key, bounds, anchor: primary?.anchor ?? fallbackAnchor, polygon: primary?.polygon,
    additionalAnchors: others.map(room => room.anchor) }
}

export function modellingLightingStatus(state: string, pending: boolean, published: boolean) {
  if (state === 'disabled') return 'Modelling lighting off'
  if (state === 'unavailable' || state === 'error') return 'Modelling GI unavailable · using cached/direct lighting'
  if (state === 'empty') return 'Modelling lighting ready · add walls to begin'
  if (state === 'ready' && !pending) return 'Modelling lighting · 3 diffuse bounces'
  if (state === 'paused') return 'Modelling GI · waiting for scene geometry'
  if (state === 'capture') return 'Modelling GI · capturing building surfaces'
  if (state === 'gather' || state === 'bounce') return 'Modelling GI · updating bounced light'
  return published ? 'Updating bounced lighting…' : 'Preparing bounced lighting…'
}
