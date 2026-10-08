import type { RoomRoofCut } from './roofRoomCsg.ts'
import type { Point } from './types.ts'
import { clipRoofFace } from './roofJunctions.ts'
import { partitionRoofFacesByRooms, type RoofVertex } from './roofSolidGeometry.ts'

/** Finish the part of a pitched enclosure below a room's horizontal ceiling. */
export function getRoomRoofCeilingFaces(cuts: RoomRoofCut[], floorId: string,
  polygon: Point[], ceilingY: number, floorY: number, openings: Point[][] = []): RoofVertex[][] {
  const faces = cuts.filter(cut => cut.roomVolume && cut.floorId === floorId && cut.roofId)
    .map(cut => clipRoofFace(cut.face, ([, y]) => ceilingY + 0.004 - y))
    .map(face => clipRoofFace(face, ([, y]) => y - floorY - 0.004))
    .filter(face => face.length >= 3)
  const inside = partitionRoofFacesByRooms(faces, [polygon]).inside
  const solid = openings.length ? partitionRoofFacesByRooms(inside, openings).outside : inside
  return solid.map(face => face.map(([x, y, z]) => [x, y - 0.004, z]))
}
