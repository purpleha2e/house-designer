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
  const lining = solid.map(face => face.map(([x, y, z]): RoofVertex => [x, y - 0.004, z]))
  const neighbours = cuts.filter(cut => cut.roomVolume && cut.floorId === floorId)
  const returns: RoofVertex[][] = []
  // Close height steps where the roof footprint ends inside the room. Match
  // overlapping edge intervals, since room triangulation can split one side
  // of a junction into several edges. Room and stair boundaries without an
  // adjacent ceiling face remain open.
  for (const face of lining) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length]
    const dx = b[0] - a[0], dz = b[2] - a[2], lengthSq = dx * dx + dz * dz
    if (lengthSq < 1e-12) continue
    const side = (p: RoofVertex) => dx * (p[2] - a[2]) - dz * (p[0] - a[0])
    const insideSide = face.reduce((sum, p) => sum + side(p), 0)
    for (const neighbour of neighbours) {
      const other = neighbour.face
      const otherSide = other.reduce((sum, p) => sum + side(p), 0)
      if (insideSide * otherSide >= -1e-12) continue
      for (let j = 0; j < other.length; j++) {
        const c = other[j], d = other[(j + 1) % other.length]
        if (Math.max(Math.abs(side(c)), Math.abs(side(d))) > 1e-6 * Math.sqrt(lengthSq)) continue
        const tc = ((c[0] - a[0]) * dx + (c[2] - a[2]) * dz) / lengthSq
        const td = ((d[0] - a[0]) * dx + (d[2] - a[2]) * dz) / lengthSq
        const start = Math.max(0, Math.min(tc, td)), end = Math.min(1, Math.max(tc, td))
        if (end - start < 1e-7 || Math.abs(td - tc) < 1e-10) continue
        const lower = (t: number): RoofVertex => [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t]
        const upper = (t: number): RoofVertex => {
          const p = lower(t)
          p[1] = Math.min(ceilingY, c[1] + (d[1] - c[1]) * (t - tc) / (td - tc) - (neighbour.roofId ? 0.004 : 0))
          return p
        }
        const lowA = lower(start), lowB = lower(end), highA = upper(start), highB = upper(end)
        if (Math.max(highA[1] - lowA[1], highB[1] - lowB[1]) < 1e-5) continue
        // Cap faces do not cross along a shared envelope edge. Clamp the tiny
        // rounding difference at a triangular return's zero-height endpoint.
        if (Math.min(highA[1] - lowA[1], highB[1] - lowB[1]) < -1e-5) continue
        highA[1] = Math.max(highA[1], lowA[1]); highB[1] = Math.max(highB[1], lowB[1])
        const panel = [lowA, lowB, highB, highA]
        returns.push(otherSide > 0 ? panel : panel.reverse())
      }
    }
  }
  return [...lining, ...returns]
}
