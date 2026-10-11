import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createIndirectField, writeIndirectPosition } from '../src/indirectLighting.ts'
import { INDIRECT_MIN_PROBE_SPACING, pruneRedundantIndirectProbes } from '../src/indirectLightingCache.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'

const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
function fixture() {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 2.4, rooms: [{ signature: 'room', polygon }] }])
  const first = field.probes.find(p => p.position.y < 1)!
  const second = field.probes.find(p => p !== first && p.position.y < 1)!
  field.probes.splice(0, field.probes.length, first, second)
  return { field, first, second }
}
function move(field: ReturnType<typeof createIndirectField>, probe: ReturnType<typeof fixture>['first'], position: number[]) {
  probe.position.fromArray(position); writeIndirectPosition(field.positionData, probe.index, probe.position)
}

test('relocated neighbours share one capture without renumbering retained atlas slots', () => {
  const { field, first, second } = fixture()
  move(field, first, [2, .6, 2]); move(field, second, [2.14, .6, 2])
  const visibility = createIndirectVisibility(new Group())
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 1)
  assert.equal(field.probes.length, 1)
  const retained = field.probes[0], removed = retained === first ? second : first
  assert.equal(field.positionData[retained.index * 4 + 3], 1)
  assert.equal(field.positionData[removed.index * 4 + 3], 0)
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 0, 'pruning is stable')
  visibility.dispose(); field.dispose()
})

test('close probes on opposite sides of a thin wall are both retained', () => {
  const { field, first, second } = fixture()
  move(field, first, [1.85, .6, 2]); move(field, second, [2.15, .6, 2])
  const material = new MeshStandardMaterial(), geometry = new BoxGeometry(.1, 2.4, 4)
  const wall = new Mesh(geometry, material); wall.position.set(2, 1.2, 2)
  const scene = new Group(); scene.add(wall)
  const visibility = createIndirectVisibility(scene)
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 0)
  assert.equal(field.probes.length, 2)
  visibility.dispose(); field.dispose(); geometry.dispose(); material.dispose()
})

test('vertically coincident probes belonging to different floors are not combined', () => {
  const { field, first, second } = fixture()
  second.region = { ...second.region, floorId: 'other-floor' }
  // Such a pair can occur when two storeys have overlapping authored elevations.
  field.floors.push({ id: 'other-floor', elevation: 0, height: 2.4, rooms: [] })
  field.grids[1] = { ...field.grids[0] }
  move(field, first, [2, .6, 2]); move(field, second, [2, .6, 2])
  const visibility = createIndirectVisibility(new Group())
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 0)
  visibility.dispose(); field.dispose()
})

test('probes at the minimum spacing and the two normal height layers remain distinct', () => {
  const { field, first, second } = fixture()
  move(field, first, [0, .6, 0]); move(field, second, [INDIRECT_MIN_PROBE_SPACING, .6, 0])
  const visibility = createIndirectVisibility(new Group())
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 0)
  move(field, second, [0, 1.8, 0])
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 0)
  visibility.dispose(); field.dispose()
})

test('sparse neighbouring room labels do not preserve redundant probes through an open doorway', () => {
  const { field, first, second } = fixture()
  second.region = { ...second.region, id: 2 }
  move(field, first, [2, .6, 2]); move(field, second, [2.2, .6, 2])
  const visibility = createIndirectVisibility(new Group())
  assert.equal(pruneRedundantIndirectProbes(field, visibility), 1)
  assert.ok(field.probes[0].position instanceof Vector3)
  visibility.dispose(); field.dispose()
})
