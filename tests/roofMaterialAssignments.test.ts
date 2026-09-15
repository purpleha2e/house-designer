import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceRoofMaterialAssignment } from '../src/roofMaterialAssignments.ts'

test('roof underside materials save independently; replacing/removing one finish preserves the other', () => {
  const top = { type: 'roof' as const, floorId: 'ground', roofId: 'bay' }
  const underside = { ...top, part: 'underside' as const }
  const tiles = { id: 'tiles', materialId: 'roof-tiles', textureScale: 2 }
  const paint = { id: 'paint', materialId: 'white-paint', customColor: '#eeeeee', textureRotation: 30 }
  const original = replaceRoofMaterialAssignment([], top, tiles)
  const painted = replaceRoofMaterialAssignment(original, underside, paint)
  const saved = JSON.parse(JSON.stringify(painted))
  assert.deepEqual(saved, [{ ...tiles, target: top }, { ...paint, target: underside }])
  assert.deepEqual(replaceRoofMaterialAssignment(saved, underside, null), original)
  assert.deepEqual(replaceRoofMaterialAssignment(saved, top, null), [{ ...paint, target: underside }])
  const replaced = replaceRoofMaterialAssignment(saved, underside, { ...paint, materialId: 'plaster' })
  assert.equal(replaced.length, 2)
  assert.equal(replaced[0].materialId, 'roof-tiles')
  assert.equal(replaced[1].materialId, 'plaster')
  assert.equal(original.length, 1, 'history state is immutable')
  const otherFloor = replaceRoofMaterialAssignment(saved, { ...underside, floorId: 'upper' }, paint)
  assert.equal(otherFloor.length, 3)
})
