import assert from 'node:assert/strict'
import test from 'node:test'
import { getDormerCeilingAssignment, getDormerWallAssignment } from '../src/dormerMaterials.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'
import type { FloorLevel, PlacedModel, SurfaceMaterialAssignment } from '../src/types.ts'

const model: PlacedModel = { id: 'd', modelId: 'dormer', position: { x: 0, y: 0 }, rotation: 0, scale: 1,
  materialOverrides: { 'dormer-interior': 'chosen-paint', frame: 'other-finish' } }
const contact = { wallId: 'knee', side: -1 as const, overlap: 1.2, height: 2.4 }
const wall: SurfaceMaterialAssignment = { id: 'paint', materialId: 'paint', customColor: '#123456',
  textureScale: 2, textureRotation: 90, target: { type: 'wall-face', wallId: 'knee', side: -1 } }

test('dormer ceiling follows the host underside, including colour and texture settings', () => {
  const exterior: SurfaceMaterialAssignment = { id: 'tiles', materialId: 'tiles', target: { type: 'roof', floorId: 'owner', roofId: 'roof' } }
  const interior: SurfaceMaterialAssignment = { ...exterior, id: 'lining', materialId: 'paint', customColor: '#ffffff', textureScale: 3,
    target: { type: 'roof', floorId: 'owner', roofId: 'roof', part: 'underside' } }
  assert.equal(getDormerCeilingAssignment([exterior, interior], 'owner', 'roof'), interior)
  assert.equal(getDormerCeilingAssignment([exterior], 'owner', 'roof'), exterior)
  assert.equal(getDormerCeilingAssignment([exterior, interior], 'loft', 'roof'), undefined)
  assert.equal(getDormerCeilingAssignment([], 'owner', 'roof'), undefined)
})

test('intersecting room-facing wall overrides the saved choice and ignores the opposite face and low trim', () => {
  const opposite: SurfaceMaterialAssignment = { ...wall, id: 'opposite', target: { ...wall.target, side: 1 } as SurfaceMaterialAssignment['target'] }
  const trim = { ...wall, id: 'trim', coverageHeight: 0.15 }
  assert.equal(getDormerWallAssignment([wall, opposite, trim], model, [contact]), wall)
  assert.equal(getDormerWallAssignment([], model, [contact]), undefined, 'unpainted walls use the internal wall default')
  assert.equal(getDormerWallAssignment([wall], model, [])?.materialId, 'chosen-paint', 'moving away restores the saved manual choice')
  assert.equal(getDormerWallAssignment([], { ...model, materialOverrides: undefined }), undefined)
})

test('wall fragments and multiple intersections follow deterministic wall finish precedence', () => {
  const fragment: SurfaceMaterialAssignment = { ...wall, id: 'fragment', target: { type: 'wall-surface-fragment', wallId: 'knee', side: -1, fragmentId: 'room' } }
  const smaller = { ...contact, wallId: 'short-wall', overlap: 0.1 }
  assert.equal(getDormerWallAssignment([wall, fragment], model, [smaller, contact]), fragment)
  assert.equal(getDormerWallAssignment([wall, fragment], model, [contact, smaller]), fragment)
})

test('manual dormer finish survives project serialization and floor normalization', () => {
  const floor: FloorLevel = { id: 'loft', name: 'Loft', elevation: 5, roomHeight: 2.4, models: [model], walls: [], rooms: [], roofs: [] }
  const loaded = normalizeFloor(JSON.parse(JSON.stringify(floor)), new Map())
  assert.deepEqual(loaded.models[0].materialOverrides, model.materialOverrides)
})

test('dormer dimensions and exterior finish survive reload while invalid dimensions are ignored', () => {
  const definition = { id: 'dormer', name: 'Dormer', category: 'Windows', color: '#fff', width: 1.2, height: 1.4, depth: 1.5,
    shape: 'box' as const, roofMount: 'dormer' as const }
  const definitions = new Map([[definition.id, definition]])
  const resized = { ...model, dormerWidth: 2.8, dormerHeight: 1.9,
    materialOverrides: { ...model.materialOverrides, 'dormer-exterior': 'brick' } }
  const floor: FloorLevel = { id: 'loft', name: 'Loft', elevation: 5, roomHeight: 2.4, walls: [], rooms: [], roofs: [], models: [resized] }
  const loaded = normalizeFloor(JSON.parse(JSON.stringify(floor)), definitions).models[0]
  assert.equal(loaded.dormerWidth, 2.8)
  assert.equal(loaded.dormerHeight, 1.9)
  assert.deepEqual(loaded.materialOverrides, resized.materialOverrides)
  assert.equal(normalizeFloor({ ...floor, models: [{ ...resized, dormerHeight: NaN }] }, definitions).models[0].dormerHeight, undefined)
})
