import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { indirectOpeningChanges, indirectZoneProbes, planIndirectZones } from '../src/indirectLightingZones.ts'
import type { FloorLevel } from '../src/types.ts'

const room = (x: number) => [{ x, y: 0 }, { x: x + 4, y: 0 }, { x: x + 4, y: 4 }, { x, y: 4 }]
const floor: FloorLevel = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
  rooms: [], roofs: [], models: [], walls: [{ id: 'front', start: { x: 0, y: 0 }, end: { x: 12, y: 0 },
    kind: 'external', thickness: .2, height: 2.4, openings: [] }] }
const revision = (floors: FloorLevel[], extra = {}) => JSON.stringify({ floors, lightDirection: { azimuth: 1, elevation: .8 },
  lightingSettings: { diffuseProbeResolution: 4 }, modelAssetVersion: 0, ...extra })
function withWindow(center = 2): FloorLevel {
  return { ...floor, models: [{ id: 'window', modelId: 'window', position: { x: center, y: 0 }, rotation: 0, scale: 1,
    wallAttachment: { wallId: 'front', offset: center } }], walls: floor.walls.map(wall => ({ ...wall,
    openings: [{ id: 'window', modelId: 'window', center, width: 1.2, height: 1.2, bottom: .8 }] })) }
}

test('window additions, removal and movement dirty only their old/new opening bounds', () => {
  const before = revision([floor]), after = revision([withWindow()])
  const changes = indirectOpeningChanges(before, after)!
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0], { floorId: 'ground', min: [1.4, .8, -.35], max: [2.6, 2, .35] })
  assert.deepEqual(indirectOpeningChanges(after, before), changes)
  assert.equal(indirectOpeningChanges(after, revision([withWindow(6)]))!.length, 2)
  assert.ok(indirectOpeningChanges(before, revision([withWindow()], { modelAssetVersion: 1 })), 'a new window asset can accompany its opening')
})

test('global light, quality, structure, furniture and unknown revisions require full bakes', () => {
  const before = revision([floor]), after = withWindow()
  assert.equal(indirectOpeningChanges(before, revision([after], { lightDirection: { azimuth: 2, elevation: .8 } })), null)
  assert.equal(indirectOpeningChanges(before, revision([after], { lightingSettings: { diffuseProbeResolution: 8 } })), null)
  assert.equal(indirectOpeningChanges(before, revision([{ ...after, roomHeight: 3 }])), null)
  assert.equal(indirectOpeningChanges(before, revision([{ ...after, walls: after.walls.map(wall => ({ ...wall, thickness: .3 })) }])), null)
  assert.equal(indirectOpeningChanges(before, revision([{ ...after, models: [...after.models, { id: 'chair', modelId: 'chair', position: { x: 1, y: 2 }, rotation: 0, scale: 1 }] }])), null)
  assert.equal(indirectOpeningChanges('1', '2'), null)
})

function fixture(open: boolean) {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 2.4,
    rooms: [0, 4, 8].map(x => ({ signature: String(x), polygon: room(x) })) },
  { id: 'first', elevation: 3, height: 2.4, rooms: [{ signature: 'upstairs', polygon: room(0) }] }])
  const scene = new Group(), material = new MeshStandardMaterial()
  const box = (x: number, y: number, z: number, width: number, height: number, depth: number) => {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material); mesh.position.set(x, y, z); scene.add(mesh)
  }
  if (open) { box(4, 1.2, .5, .15, 2.4, 1); box(4, 1.2, 3.5, .15, 2.4, 1) }
  else box(4, 1.2, 2, .15, 2.4, 4)
  box(8, 1.2, 2, .15, 2.4, 4); box(6, 2.7, 2, 12, .3, 4)
  const visibility = createIndirectVisibility(scene)
  return { field, visibility, dispose() { visibility.dispose(); field.dispose(); scene.traverse(o => { if (o instanceof Mesh) o.geometry.dispose() }); material.dispose() } }
}

test('sealed rooms and upstairs retain their probes after a downstairs window change', () => {
  const { field, visibility, dispose } = fixture(false)
  const plan = planIndirectZones(field, visibility, indirectZoneProbes(field), indirectOpeningChanges(revision([floor]), revision([withWindow()]))!)
  const affected = new Set(field.probes.filter(p => p.region.floorId === 'ground' && p.region.polygon[0].x === 0).map(p => p.index))
  assert.deepEqual(new Set(plan.first), affected)
  assert.deepEqual(new Set(plan.second), affected)
  assert.equal(plan.reused, field.probes.length - affected.size)
  assert.equal(plan.reflections.length, 1)
  dispose()
})

test('a real doorway propagates updates into its neighbouring zone, stopping at solid walls/slabs', () => {
  const { field, visibility, dispose } = fixture(true)
  const plan = planIndirectZones(field, visibility, indirectZoneProbes(field), indirectOpeningChanges(revision([floor]), revision([withWindow()]))!)
  const updated = field.probes.filter(p => plan.second.includes(p.index))
  assert.ok(updated.some(p => p.region.polygon[0].x === 4), 'light crosses the open doorway')
  assert.ok(updated.every(p => p.region.floorId === 'ground' && p.region.polygon[0].x < 8), 'solid partition and slab stop propagation')
  assert.ok(plan.reused > 0)
  dispose()
})

test('new or relocated probes are recaptured even outside the edited opening zone', () => {
  const { field, visibility, dispose } = fixture(false), previous = indirectZoneProbes(field)
  const probe = field.probes.find(p => p.region.polygon[0].x === 8)!
  probe.position.x += .1
  const plan = planIndirectZones(field, visibility, previous, indirectOpeningChanges(revision([floor]), revision([withWindow()]))!)
  assert.ok(plan.first.includes(probe.index))
  assert.ok(plan.second.includes(probe.index))
  dispose()
})
