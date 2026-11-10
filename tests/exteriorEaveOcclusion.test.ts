import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { bakeExteriorEaveField } from '../src/exteriorEaveOcclusion.ts'
import { snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { isExteriorEaveOccluder } from '../src/exteriorSkyReceivers.ts'

test('fine eave field preserves a shallow porch underneath the main roof', () => {
  const scene = new Group(), material = new MeshStandardMaterial()
  const lower = new Mesh(new PlaneGeometry(3, .24), material)
  lower.rotation.x = -Math.PI / 2; lower.position.set(10, 2, 10)
  const upper = new Mesh(new PlaneGeometry(4, 4), material)
  upper.rotation.x = -Math.PI / 2; upper.position.set(10, 5, 10)
  lower.userData.houseDesignerRole = upper.userData.houseDesignerRole = 'roof-underside'
  scene.add(lower, upper)
  try {
    const field = bakeExteriorEaveField(snapshotIndirectGeometry(scene, isExteriorEaveOccluder))!
    assert.ok(field)
    assert.equal(field.layers, 2)
    const cell = field.size[0] / (field.dimensions[0] - 1)
    assert.ok(cell <= .081, 'narrow overhangs use a finer grid than the sky field')
    const x = Math.round((10 - field.min[0]) / cell), z = Math.round((10 - field.min[1]) / cell)
    const heights = Array.from({ length: field.layers }, (_, layer) => {
      const offset = (x + field.dimensions[0] * z + layer * field.dimensions[0] * field.dimensions[1]) * 4
      assert.equal(field.data[offset + 2], 255)
      return field.heightMin + (field.data[offset] * 256 + field.data[offset + 1]) / 65535 * field.heightRange
    })
    assert.ok(Math.abs(heights[0] - 2) < .001)
    assert.ok(Math.abs(heights[1] - 5) < .001)
    assert.equal(field.data[2], 0, 'padding beyond roof boundaries is uncovered')
  } finally { lower.geometry.dispose(); upper.geometry.dispose(); material.dispose() }
})

test('vertical fascia and wall tops cannot create overhead eave coverage', () => {
  const material = new MeshStandardMaterial(), fascia = new Mesh(new PlaneGeometry(3, 1), material)
  fascia.userData.houseDesignerRole = 'roof-eaves'
  try {
    assert.equal(bakeExteriorEaveField(snapshotIndirectGeometry(fascia)), null)
    fascia.userData.houseDesignerRole = 'wall-engine-render'
    assert.equal(isExteriorEaveOccluder(fascia), false)
    assert.equal(bakeExteriorEaveField([]), null)
  } finally { fascia.geometry.dispose(); material.dispose() }
})
