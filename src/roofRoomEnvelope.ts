import type { Point } from './types.ts'
import type { RoofVertex } from './roofSolidGeometry.ts'
import { partitionRoofFacesByRooms } from './roofSolidGeometry.ts'
import { roofFaceHeight, subtractRoofVolume } from './roofJunctions.ts'
import { footprintPlanes } from './wallEngine/wallRoofClip.ts'

export type RoomCeilingFace = { roofId: string; face: RoofVertex[] }
export type RoomRoofSurface = {
  roofId: string
  faces: RoofVertex[][]
  thickness: number
}

/** The room ceiling is the highest inner roof surface at each plan point.
 * Roof connection settings and draw order do not affect this geometry. */
export function buildRoomCeilingEnvelope(
  roofs: RoomRoofSurface[], roomPolygons: Point[][],
): RoomCeilingFace[] {
  const source = roofs.flatMap(roof => roof.faces.flatMap(face => {
    const inner = face.map(([x, y, z]): RoofVertex => [x, y - roof.thickness, z])
    return partitionRoofFacesByRooms([inner], roomPolygons).inside.map(piece => ({
      roofId: roof.roofId, face: piece,
    }))
  }))
  const heights = source.map(item => roofFaceHeight(item.face))
  const footprints = source.map(item => footprintPlanes(item.face.map(([x, , z]) => ({ x, y: z }))))
  return source.flatMap((target, targetIndex) => {
    let pieces = [target.face]
    const targetHeight = heights[targetIndex]
    if (!targetHeight) return []
    for (let index = 0; index < source.length; index++) {
      if (index === targetIndex || !pieces.length) continue
      const otherHeight = heights[index]
      if (!otherHeight) continue
      const coplanar = target.face.every(([x, y, z]) =>
        Math.abs(otherHeight({ x, y: z }) - y) < 1e-7)
      if (coplanar && index > targetIndex) continue
      pieces = pieces.flatMap(piece => subtractRoofVolume(piece, [
        ...footprints[index],
        coplanar ? () => 1 : ([x, y, z]) => otherHeight({ x, y: z }) - y,
      ]))
    }
    return pieces.map(face => ({ roofId: target.roofId, face }))
  })
}
