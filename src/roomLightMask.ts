import type { Point } from './types.ts'

export const ROOM_LIGHT_MASK_SIZE = 512
export const MAX_ROOM_LIGHT_MASK_ID = 254

export type RoomLightMaskRoom = {
  polygon: Point[]
  signature: string
}

export type RoomLightMaskBounds = {
  minX: number
  minZ: number
  size: number
}

export type RoomLightMask = {
  bounds: RoomLightMaskBounds
  data: Uint8Array
  height: number
  roomIdsBySignature: Map<string, number>
  width: number
}

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared < 1e-12) {
    return Math.hypot(point.x - start.x, point.y - start.y) < 1e-6
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  if (t < 0 || t > 1) return false
  const projectedX = start.x + dx * t
  const projectedY = start.y + dy * t
  return Math.hypot(point.x - projectedX, point.y - projectedY) < 1e-6
}

export function pointIsInsideRoomPolygon(point: Point, polygon: Point[]) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length;
    previous = index, index += 1) {
    const start = polygon[previous]
    const end = polygon[index]
    if (pointIsOnSegment(point, start, end)) return true
    if ((end.y > point.y) !== (start.y > point.y) &&
      point.x < ((start.x - end.x) * (point.y - end.y)) / (start.y - end.y) + end.x) {
      inside = !inside
    }
  }

  return inside
}

function polygonAreaMagnitude(polygon: Point[]) {
  return Math.abs(polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return area + point.x * next.y - next.x * point.y
  }, 0))
}

export function createRoomLightMask(
  rooms: RoomLightMaskRoom[],
  bounds: RoomLightMaskBounds,
  size = ROOM_LIGHT_MASK_SIZE,
): RoomLightMask {
  const width = Math.max(1, Math.floor(size))
  const height = width
  const data = new Uint8Array(width * height)
  const roomIdsBySignature = new Map<string, number>()
  const maskRooms = rooms
    .slice(0, MAX_ROOM_LIGHT_MASK_ID)
    .map((room, index) => {
      const id = index + 1
      roomIdsBySignature.set(room.signature, id)
      return { area: polygonAreaMagnitude(room.polygon), id, room }
    })
    .sort((first, second) => first.area - second.area)

  for (let y = 0; y < height; y += 1) {
    const worldZ = bounds.minZ + ((y + 0.5) / height) * bounds.size
    for (let x = 0; x < width; x += 1) {
      const worldX = bounds.minX + ((x + 0.5) / width) * bounds.size
      // Small nested rooms win, matching the room-picking behavior.
      const containing = maskRooms.find(({ room }) =>
        pointIsInsideRoomPolygon({ x: worldX, y: worldZ }, room.polygon),
      )
      data[y * width + x] = containing?.id ?? 0
    }
  }

  return { bounds, data, height, roomIdsBySignature, width }
}

export function getRoomLightMaskIdAtPoint(mask: RoomLightMask, point: Point) {
  const u = (point.x - mask.bounds.minX) / mask.bounds.size
  const v = (point.y - mask.bounds.minZ) / mask.bounds.size
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width))
  const y = Math.min(mask.height - 1, Math.floor(v * mask.height))
  return mask.data[y * mask.width + x]
}
