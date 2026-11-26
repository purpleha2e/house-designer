import assert from 'node:assert/strict'
import test from 'node:test'
import type { FloorLevel, Point, SurfaceMaterialAssignment, Wall } from '../src/types.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { getWallJoinChain, joinFloorWalls, preserveJoinedWallRooms } from '../src/wallJoin.ts'

const wall = (id: string, start: Point, end: Point): Wall => ({ id, start, end, kind: 'external', thickness: .3, height: 2.4 })
const start = { x: 0, y: 0 }
const firstJoin = { x: 2, y: 0 }
const secondJoin = { x: 4, y: 1 }
const end = { x: 6, y: 0 }
const first = wall('first', start, firstJoin)
const middle = { ...wall('middle', secondJoin, firstJoin), thickness: .25 }
const last = wall('last', secondJoin, end)
const chainFor = (walls: Wall[], ids = walls.map(wall => wall.id)) => getWallJoinChain(walls, ids, buildWallTopology(walls))

test('join straightens an ordered chain and moves attachments off reversed segments', () => {
  const windows = [{ id: 'window', modelId: 'window', position: secondJoin, scale: 1, rotation: 0,
    wallAttachment: { wallId: middle.id, offset: .5, side: 1 as const } }]
  const floor: FloorLevel = { id: 'floor', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    walls: [first, middle, last], rooms: [], roofs: [], models: windows }
  const chain = chainFor(floor.walls, ['first', 'last', 'middle'])
  assert.ok(chain)
  const { joined, floor: result } = joinFloorWalls(floor, chain, 'joined')

  assert.deepEqual(result.walls, [joined])
  assert.deepEqual(joined.start, start)
  assert.deepEqual(joined.end, end)
  assert.equal(joined.thickness, first.thickness)
  const attachment = result.models[0].wallAttachment
  assert.ok(attachment)
  assert.equal(attachment.wallId, 'joined')
  assert.equal(attachment.side, -1)
  assert.ok(Math.abs(attachment.offset - (2 + Math.sqrt(5) - .5) * 6 / (2 + 2 * Math.sqrt(5))) < 1e-6)
})

test('join requires one connected chain with two free ends', () => {
  assert.ok(chainFor([first, middle]))
  assert.equal(chainFor([first, last]), null)
  assert.equal(chainFor([first, middle, last, wall('branch', secondJoin, { x: 4, y: 3 })]), null)
  assert.equal(chainFor([first, middle, last, wall('close-loop', end, start)]), null)
})

test('straightening a room wall keeps the room metadata and finish', () => {
  const topRight = { x: 6, y: 4 }
  const topLeft = { x: 0, y: 4 }
  const walls = [first, middle, last, wall('right', end, topRight), wall('top', topRight, topLeft), wall('left', topLeft, start)]
  const [detected] = buildWallTopology(walls).rooms
  const room = { id: 'room', name: 'Kitchen', signature: detected.signature, ceilingMode: 'open' as const }
  const floor: FloorLevel = { id: 'floor', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    walls, rooms: [room], roofs: [], models: [] }
  const chain = chainFor(walls, ['first', 'middle', 'last'])
  assert.ok(chain)
  const { floor: joined } = joinFloorWalls(floor, chain, 'joined')
  const [newRoom] = buildWallTopology(joined.walls).rooms
  assert.notEqual(newRoom.signature, room.signature)
  const assignment: SurfaceMaterialAssignment = { id: 'wood', materialId: 'oak',
    target: { type: 'room-floor', floorId: floor.id, roomSignature: room.signature } }

  const preserved = preserveJoinedWallRooms(floor, joined, [assignment])
  assert.deepEqual(preserved.floor.rooms, [{ ...room, signature: newRoom.signature }])
  assert.deepEqual(preserved.assignments, [{ ...assignment, target: { ...assignment.target, roomSignature: newRoom.signature } }])
})
