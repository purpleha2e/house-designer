import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } from 'three'
import { createDormerWindow, fitDormerWindow, getDormerWindowHost, migrateDormerWindows, syncDormerWindows, updateDormerWindow } from '../src/dormerWindows.ts'
import { createPlacedModel, normalizeFloor } from '../src/modelPlacement.ts'
import { createDormerGeometries } from '../src/dormerGeometry.ts'
import type { FloorLevel, PlacedModel } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const dormer: ModelDefinition = { id: 'dormer', name: 'Dormer', category: 'Windows', color: '#fff',
  width: 2.4, height: 2, depth: 1.35, shape: 'box', roofMount: 'dormer' }
const window: ModelDefinition = { id: 'window', name: 'Window', category: 'Windows', color: '#fff',
  width: 1.5, height: 1, depth: 0.1, shape: 'box', wallMount: 'window' }
const other: ModelDefinition = { ...window, id: 'other', width: 1, height: 1.2 }
const definitions = new Map([dormer, window, other].map(d => [d.id, d]))
function fixture(legacy = false): FloorLevel {
  const model: PlacedModel = { ...createPlacedModel({ id: 'd', modelId: dormer.id, modelsById: definitions, walls: [] }),
    dormerWidth: 2.4, dormerHeight: 1.6,
    roofAttachment: { roofId: 'roof', surface: 'positive-x', localPosition: { x: 3, y: 0 } } }
  if (legacy) { delete model.dormerWindowOpenings; delete model.dormerHeight; model.dormerWindowModelId = window.id }
  return { id: 'floor', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.3, walls: [], rooms: [],
    models: [model], roofs: [{ id: 'roof', type: 'up-and-over', width: 10, depth: 10,
      position: { x: 4, y: 5 }, rotation: 0.4, pitchDegrees: 40 }] }
}
function addWindow(floor: FloorLevel, modelId = window.id) {
  const child = createDormerWindow(floor, 'd', modelId, 'child', definitions)!
  assert.ok(child)
  return syncDormerWindows({ ...floor, models: [...floor.models, child] }, definitions)
}
function wallAtWindow(floor: FloorLevel) {
  const assembly = getDormerWindowHost(floor, 'd', definitions)!.assembly
  const geometries = createDormerGeometries(assembly)
  const mesh = new Mesh(geometries.walls, new MeshBasicMaterial({ side: DoubleSide }))
  const hits = new Raycaster(new Vector3(0, 0.6, 1), new Vector3(0, 0, -1)).intersectObject(mesh)
    .filter(hit => Math.abs(hit.point.z) <= assembly.walls[0].thickness / 2 + 1e-6)
  Object.values(geometries).forEach(geometry => geometry.dispose())
  mesh.material.dispose()
  return hits.length > 0
}

test('new dormers have a closed front; adding, deleting and replacing a separate window updates only its opening', () => {
  const empty = fixture(), parent = structuredClone(empty.models[0])
  assert.deepEqual(parent.dormerWindowOpenings, [])
  assert.ok(wallAtWindow(empty))
  const placed = addWindow(empty)
  assert.equal(placed.models.length, 2)
  assert.equal(placed.models[1].dormerAttachment?.dormerId, 'd')
  assert.equal(wallAtWindow(placed), false)
  assert.equal(placed.models[0].dormerWidth, parent.dormerWidth)
  assert.equal(placed.models[0].dormerHeight, parent.dormerHeight)
  const deleted = syncDormerWindows({ ...placed, models: placed.models.slice(0, 1) }, definitions)
  assert.ok(wallAtWindow(deleted))
  assert.deepEqual(deleted.models[0].dormerWindowOpenings, [])
  const replaced = addWindow(deleted, other.id)
  assert.equal(replaced.models[1].modelId, other.id)
  assert.equal(wallAtWindow(replaced), false)
  assert.equal(getDormerWindowHost(replaced, 'd', definitions)!.assembly.wallHeight,
    getDormerWindowHost(empty, 'd', definitions)!.assembly.wallHeight)
})

test('window resizing and movement are independent and remain inside the dormer front', () => {
  const floor = addWindow(fixture()), child = floor.models[1]
  const host = getDormerWindowHost(floor, 'd', definitions)!
  const updated = updateDormerWindow(floor, child, { scale: child.scale * 0.7, widthScale: 0.8,
    position: host.toWorld(0.3), wallOpeningBottom: host.mountBottom + 0.25 }, definitions)
  const changed = syncDormerWindows({ ...floor, models: [floor.models[0], updated] }, definitions)
  const opening = changed.models[0].dormerWindowOpenings![0]
  assert.ok(Math.abs(opening.width - window.width * updated.scale * updated.widthScale!) < 1e-6)
  assert.ok(Math.abs(updated.dormerAttachment!.offset - 0.3) < 1e-6)
  assert.ok(Math.abs(updated.dormerAttachment!.bottom - 0.25) < 1e-6)
  assert.equal(changed.models[0].dormerWidth, floor.models[0].dormerWidth)
  assert.equal(changed.models[0].dormerHeight, floor.models[0].dormerHeight)
  const oversized = fitDormerWindow(floor, { ...child, scale: 20 }, definitions)
  const halfWidth = window.width * oversized.scale * oversized.widthScale! / 2
  assert.ok(halfWidth < 1.2)
  const topCorner = oversized.dormerAttachment!.bottom + window.height * oversized.scale
  assert.ok(topCorner < host.assembly.wallHeight + host.assembly.roofRise -
    host.assembly.roofRise / host.assembly.roofHalfWidth * halfWidth)
  assert.equal(syncDormerWindows(changed, definitions), changed, 'synchronization settles without a render loop')
})

test('attached windows follow roof and dormer edits and are removed with their parent', () => {
  const floor = addWindow(fixture()), child = floor.models[1]
  const parent = { ...floor.models[0], scale: 1.3,
    roofAttachment: { ...floor.models[0].roofAttachment!, localPosition: { x: 2.5, y: 1 } } }
  const moved = syncDormerWindows({ ...floor, models: [parent, child],
    roofs: floor.roofs!.map(roof => ({ ...roof, rotation: 1.1, heightOffset: 0.6 })) }, definitions)
  assert.notDeepEqual(moved.models[1].position, child.position)
  assert.notEqual(moved.models[1].wallOpeningBottom, child.wallOpeningBottom)
  assert.equal(moved.models[1].scale, child.scale, 'parent edits keep the window size')
  assert.equal(syncDormerWindows({ ...moved, models: [moved.models[1]] }, definitions).models.length, 0)
})

test('legacy dormer migration retains body and window dimensions and is stable across save/load', () => {
  const original = fixture(true), before = getDormerWindowHost(original, 'd', definitions)!
  original.models[0].scale = 1.2
  original.models[0].widthScale = 1.1
  const migrated = migrateDormerWindows(original, definitions), child = migrated.models[1]
  assert.equal(migrated.models.length, 2)
  assert.equal(migrated.models[0].dormerHeight, before.assembly.wallHeight)
  assert.ok(Math.abs(child.scale * window.height - before.assembly.windowHeight * 1.2) < 1e-6)
  assert.ok(Math.abs(child.scale * child.widthScale! * window.width - before.assembly.windowWidth * 1.32) < 1e-6)
  assert.equal(migrateDormerWindows(migrated, definitions).models.length, 2)
  const loaded = normalizeFloor(JSON.parse(JSON.stringify(migrated)), definitions)
  assert.deepEqual(loaded.models.map(model => model.id), migrated.models.map(model => model.id))
  assert.deepEqual(loaded.models[0].dormerWindowOpenings, migrated.models[0].dormerWindowOpenings)
  const deleted = syncDormerWindows({ ...loaded, models: loaded.models.slice(0, 1) }, definitions)
  assert.equal(normalizeFloor(JSON.parse(JSON.stringify(deleted)), definitions).models.length, 1,
    'a deliberately removed window does not return on reload')
})
