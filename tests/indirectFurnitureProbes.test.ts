import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, SphericalHarmonics3, Vector3 } from 'three'
import { createIndirectField, restoreIndirectField, serializeIndirectField, writeIndirectPosition, writeIndirectProbe } from '../src/indirectLighting.ts'
import { createIndirectVisibility, snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { prepareIndirectCache } from '../src/indirectLightingCache.ts'
import { addIndirectFurnitureProbes, INDIRECT_FURNITURE_PROBE_VERSION } from '../src/indirectFurnitureProbes.ts'
import { sampleIndirectCoefficients } from '../src/indirectVolume.ts'
import { inspectIndirectPoint } from '../src/indirectLightingDiagnostic.ts'
import { writeIndirectFloorLayer } from '../src/indirectFloorLighting.ts'

const floor = { id: 'ground', elevation: 0, height: 2.4, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }] }] }
function fixture(bottom = .25) {
  const field = createIndirectField([floor], 0), scene = new Group(), material = new MeshStandardMaterial()
  const geometry = new BoxGeometry(3, .3, 2), bed = new Mesh(geometry, material)
  bed.position.set(2.5, bottom + .15, 2.5); scene.add(bed)
  const floorGeometry = new BoxGeometry(8, .02, 6), slab = new Mesh(floorGeometry, material)
  slab.position.set(4, .002, 3); scene.add(slab)
  const boxes = [new Box3().setFromObject(bed)], visibility = createIndirectVisibility(scene)
  return { field, scene, boxes, visibility, dispose() { visibility.dispose(); field.dispose(); geometry.dispose(); floorGeometry.dispose(); material.dispose() } }
}

test('raised furniture gets real captures below its underside, restoring local floor support', () => {
  const f = fixture(), { field, visibility } = f
  field.probes.forEach(probe => { probe.position.set(2.5, .8, 2.5); writeIndirectPosition(field.positionData, probe.index, probe.position) })
  const result = new Float64Array(12), point = new Vector3(2.5, .016, 2.5)
  assert.equal(sampleIndirectCoefficients(field, 0, point.x, point.y, point.z, result, visibility), 0, 'all existing probes are hidden by the bed')
  const indices = field.probes.map(probe => probe.index)
  const count = addIndirectFurnitureProbes(field, f.boxes, visibility)
  assert.ok(count >= 4 && count <= 12)
  assert.equal(field.floorProbeLayoutVersion, INDIRECT_FURNITURE_PROBE_VERSION)
  assert.deepEqual(field.probes.slice(0, indices.length).map(probe => probe.index), indices)
  const sh = new SphericalHarmonics3(); sh.coefficients[0].set(.02, .02, .018)
  for (const probe of field.probes.filter(probe => probe.kind === 'floor')) {
    assert.ok(probe.position.y > .06 && probe.position.y < .25)
    writeIndirectProbe(field, probe.index, sh)
  }
  assert.ok(sampleIndirectCoefficients(field, 0, point.x, point.y, point.z, result, visibility) > .1)
  writeIndirectFloorLayer(field, visibility)
  const report = inspectIndirectPoint(field, visibility, new Vector3(2.5, .012, 2.5), new Vector3(0, 1, 0), [])
  assert.equal(report.exactAtSurface.confidence, 1, 'missing support no longer produces a black rectangle')
  assert.ok(Math.abs(report.displayed.rgb[0] - .02 * .886227) < .0001)
  const restored = restoreIndirectField(structuredClone(serializeIndirectField(field)))
  assert.equal(restored.probes.filter(probe => probe.kind === 'floor').length, count)
  assert.equal(restored.floorProbeLayoutVersion, INDIRECT_FURNITURE_PROBE_VERSION)
  restored.dispose(); f.dispose()
})

test('solid plinths receive no probes inside their geometry', () => {
  const f = fixture(.012)
  assert.equal(addIndirectFurnitureProbes(f.field, f.boxes, f.visibility), 0)
  f.dispose()
})

test('floor samples keep stable identities across obstacle ordering and do not duplicate on repeated placement', () => {
  const a = fixture(), b = fixture()
  const irrelevant = new Box3(new Vector3(6, 0, 4), new Vector3(7, 1, 5))
  const count = addIndirectFurnitureProbes(a.field, [...a.boxes, irrelevant], a.visibility)
  assert.equal(addIndirectFurnitureProbes(b.field, [irrelevant, ...b.boxes], b.visibility), count)
  assert.deepEqual(a.field.probes.map(p => [p.index, ...p.position.toArray()]), b.field.probes.map(p => [p.index, ...p.position.toArray()]))
  assert.equal(addIndirectFurnitureProbes(a.field, a.boxes, a.visibility), 0)
  a.dispose(); b.dispose()
})

test('a layout-only upgrade reuses direct captures and updates underside samples and dependent second bounces', () => {
  const f = fixture(), geometry = snapshotIndirectGeometry(f.scene), boxes = f.boxes.map(box => ({ min: box.min.toArray(), max: box.max.toArray() }))
  const baseline = prepareIndirectCache([floor], [], geometry, boxes)
  const previous = baseline.field.probes.filter(probe => !probe.kind).map(probe => ({ index: probe.index, position: probe.position.toArray(), floorId: probe.region.floorId }))
  const upgrade = prepareIndirectCache([floor], [], geometry, boxes, { previous, changes: [], captureNewOnly: true })
  const plan = upgrade.snapshot().zonePlan!
  assert.deepEqual(plan.first, upgrade.field.probes.filter(probe => probe.kind === 'floor').map(probe => probe.index))
  assert.ok(plan.first.length > 0 && plan.first.length < plan.second.length)
  assert.ok(previous.every(probe => !plan.first.includes(probe.index)), 'existing direct captures do not need repeating')
  baseline.dispose(); upgrade.dispose(); f.dispose()
})
