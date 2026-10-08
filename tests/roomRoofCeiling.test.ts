import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoomRoofCeilingFaces } from '../src/roomRoofCeiling.ts'
import { roofSurfaceHeights } from '../src/roofJunctions.ts'
import type { RoomRoofCut } from '../src/roofRoomCsg.ts'

test('a sloping ceiling finishes only its room and storey, leaving stair openings clear', () => {
  const cuts: RoomRoofCut[] = [{ roomVolume: true, floorId: 'hall', roofId: 'porch',
    thickness: 0, bottomY: -1, face: [[0, -0.5, 0], [4, 3.5, 0], [4, 3.5, 4], [0, -0.5, 4]] }]
  const room = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]
  const stair = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]
  const faces = getRoomRoofCeilingFaces(cuts, 'hall', room, 2.4, 0, [stair])
  const heights = (x: number, y: number) => roofSurfaceHeights(faces, { x, y })
  assert.ok(Math.abs(heights(2.5, 2.5)[0] - 1.996) < 1e-7, 'lining sits below the roof skin')
  for (const point of [[0.2, 0.5], [2.99, 0.5], [2, 3.5], [1.5, 1.5]]) {
    assert.equal(heights(point[0], point[1]).length, 0, `no finish at ${point}`)
  }
  assert.deepEqual(getRoomRoofCeilingFaces(cuts, 'upstairs', room, 5.1, 2.7), [])
})
