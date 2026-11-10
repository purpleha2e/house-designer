import test from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { softFloorGISource, softFloorGISourceMatches } from '../src/softFloorGISource.ts'
import { snapshotIndirectGeometry, snapshotIndirectGeometrySteps } from '../src/indirectVisibility.ts'
import { runViewportTask } from '../src/viewportScheduling.ts'

test('floor publication fences texture identity as well as project, geometry and version', () => {
  const field = createIndirectField([], 0), other = createIndirectField([], 0)
  const now = { field, generation: 1, geometryKey: 'walls-1', ready: true }, source = softFloorGISource(now)
  try {
    assert.equal(softFloorGISourceMatches(source, now), true)
    assert.equal(softFloorGISourceMatches(source, { ...now, ready: false }), true, 'a compatible result survives unrelated shader preparation')
    assert.equal(softFloorGISourceMatches(source, { ...now, generation: 2 }), false)
    assert.equal(softFloorGISourceMatches(source, { ...now, geometryKey: 'walls-2' }), false)
    assert.equal(softFloorGISourceMatches(source, { ...now, field: other }), false)
    const original = field.floorLayer.texture
    assert.equal(original.version, other.floorLayer.texture.version)
    field.floorLayer.texture = other.floorLayer.texture
    assert.equal(softFloorGISourceMatches(source, now), false, 'a same-version replacement is incompatible')
    field.floorLayer.texture = original; original.needsUpdate = true
    assert.equal(softFloorGISourceMatches(source, now), false)
  } finally { field.dispose(); other.dispose() }
})

test('cooperative geometry descriptors match the synchronous snapshot and skip detached owners', async () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const first = new Mesh(geometry, material), removed = new Mesh(geometry, material)
  scene.add(first, removed)
  try {
    assert.deepEqual(await runViewportTask(snapshotIndirectGeometrySteps(scene), () => false), snapshotIndirectGeometry(scene))
    const steps = snapshotIndirectGeometrySteps(scene)
    steps.next(); removed.removeFromParent()
    let next = steps.next(); while (!next.done) next = steps.next()
    assert.equal(next.value.length, 1)
    assert.equal(await runViewportTask(snapshotIndirectGeometrySteps(scene), () => true), undefined)
  } finally { geometry.dispose(); material.dispose() }
})
