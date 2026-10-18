import assert from 'node:assert/strict'
import test from 'node:test'
import { getSurfaceSelectionFloorId } from '../src/surfaceSelection.ts'
import { replaceRoofMaterialAssignment } from '../src/roofMaterialAssignments.ts'
import type { FloorLevel, SelectableSurface } from '../src/types.ts'

const floors: Pick<FloorLevel, 'id' | 'elevation' | 'roofs'>[] = [
  { id: 'ground', elevation: 0, roofs: [] },
  { id: 'upper', elevation: 3, roofs: [{ id: 'roof', type: 'up-and-over', position: { x: 0, y: 0 }, rotation: 0, width: 6, depth: 6, pitchDegrees: 35 }] },
  { id: 'loft', elevation: 6, roofs: [] },
]
const owner = floors[1], loft = floors[2]
const ceiling: SelectableSurface = { type: 'roof', part: 'underside', floorId: owner.id, roofId: owner.roofs![0].id }

test('editing a stairwell slab edge preserves the upper floor while retaining the slab material owner', () => {
  const edge: SelectableSurface = { type: 'floor-slab-edge', floorId: owner.id }
  assert.equal(getSurfaceSelectionFloorId(edge, loft.id, floors), loft.id)
  assert.equal(edge.floorId, owner.id)
  assert.equal(getSurfaceSelectionFloorId(edge, owner.id, floors), owner.id)
  assert.equal(getSurfaceSelectionFloorId(edge, floors[0].id, floors), owner.id)
})

test('selecting an inherited roof ceiling retains the loft editing floor and roof material owner', () => {
  assert.equal(getSurfaceSelectionFloorId(ceiling, loft.id, floors), loft.id)
  const [assignment] = replaceRoofMaterialAssignment([], ceiling, { id: 'finish', materialId: 'paint' })
  assert.equal(assignment.target.floorId, owner.id)
  assert.deepEqual(assignment.target, ceiling)
})

test('roof exterior and ordinary room surfaces still select their owning floor', () => {
  assert.equal(getSurfaceSelectionFloorId({ ...ceiling, part: undefined }, loft.id, floors), owner.id)
  assert.equal(getSurfaceSelectionFloorId({ type: 'room-floor', floorId: owner.id, roomSignature: 'room' }, loft.id, floors), owner.id)
  assert.equal(getSurfaceSelectionFloorId({ type: 'wall-face', floorId: owner.id, wallId: 'wall', side: 1 }, loft.id, floors), owner.id)
})

test('own-floor, higher-floor and unknown roof selections do not retain an unrelated floor', () => {
  assert.equal(getSurfaceSelectionFloorId(ceiling, owner.id, floors), owner.id)
  assert.equal(getSurfaceSelectionFloorId(ceiling, floors[0].id, floors), owner.id)
  assert.equal(getSurfaceSelectionFloorId({ ...ceiling, roofId: 'missing' }, loft.id, floors), owner.id)
})
