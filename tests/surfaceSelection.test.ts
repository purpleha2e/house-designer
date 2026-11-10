import assert from 'node:assert/strict'
import test from 'node:test'
import { getSelectionContextFloor, getSurfaceSelectionFloorId } from '../src/surfaceSelection.ts'
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

test('cross-floor object properties follow their owner without changing the plan floor', () => {
  const levels = floors.map(floor => ({ ...floor, name: floor.id, roomHeight: 2.4, slabThickness: .3,
    rooms: [], models: [{ id: `${floor.id}-window`, modelId: 'window', position: { x: 0, y: 0 }, rotation: 0, scale: 1 }],
    walls: [{ id: `${floor.id}-wall`, start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: .3, height: 2.4, kind: 'external' as const }] }))
  const plan = levels[1], none = { modelId: null, wallId: null, roofId: null, surface: null }
  const before = JSON.stringify(levels)
  for (const id of ['ground-window', 'upper-window', 'ground-window']) {
    const context = getSelectionContextFloor(levels, plan, { ...none, modelId: id })
    assert.equal(context.id, id.split('-')[0])
    assert.equal(plan.id, 'upper')
  }
  assert.equal(getSelectionContextFloor(levels, plan, { ...none, wallId: 'ground-wall' }), levels[0])
  assert.equal(getSelectionContextFloor(levels, plan, { ...none, roofId: 'roof' }), levels[1])
  assert.equal(getSelectionContextFloor(levels, plan, { ...none, modelId: 'deleted-model' }), plan)
  assert.equal(getSelectionContextFloor(levels, plan, none), plan)
  assert.equal(JSON.stringify(levels), before)
  const surface: SelectableSurface = { type: 'room-floor', floorId: 'ground', roomSignature: 'room' }
  assert.equal(getSelectionContextFloor(levels, plan, { ...none, surface }), levels[0])
  assert.equal(surface.floorId, 'ground', 'material assignments retain the selected surface owner')
  assert.equal(getSelectionContextFloor(levels, levels[2], { ...none, surface: ceiling }), levels[2], 'inherited loft ceiling semantics stay intact')
})
