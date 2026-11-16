import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { bakeExteriorEaveField } from '../src/exteriorEaveOcclusion.ts'
import { snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { isExteriorEaveOccluder } from '../src/exteriorSkyReceivers.ts'

test('fine eave field preserves a shallow porch underneath the main roof', () => {
  const scene = new Group(), material = new MeshStandardMaterial()
  const lower = new Mesh(new PlaneGeometry(3, .24), material)
  lower.rotation.x = Math.PI / 2; lower.position.set(10, 2, 10)
  const upper = new Mesh(new PlaneGeometry(4, 4), material)
  upper.rotation.x = Math.PI / 2; upper.position.set(10, 5, 10)
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

test('boxed eaves cast contact shading below the soffit without self-shadowing their fascia', () => {
  const trim = new Mesh(new BoxGeometry(4, .16, .3), new MeshStandardMaterial())
  trim.position.y = 2.48; trim.rotation.y = .55
  trim.userData.houseDesignerRole = 'roof-eaves'
  try {
    const field = bakeExteriorEaveField(snapshotIndirectGeometry(trim))!
    assert.equal(field.layers, 1, 'the top of the trim must not shade its own vertical fascia')
    assert.ok(Math.abs(field.heightMin - 2.4) < 1e-5)
    let covered = 0
    for (let i = 0; i < field.data.length; i += 4) if (field.data[i + 2]) {
      covered++
      const height = field.heightMin + (field.data[i] * 256 + field.data[i + 1]) / 65535 * field.heightRange
      assert.ok(Math.abs(height - 2.4) < 1e-5, 'the real underside still shades the wall below')
    }
    assert.ok(covered > 10)
    const coverage=Array.from({length:field.data.length/4},(_,i)=>field.data[i*4+2]/255)
    assert.ok(coverage.some(value=>value>0&&value<1),'angled roof edges retain fractional texel coverage')
    const cellArea=field.size[0]/(field.dimensions[0]-1)*field.size[1]/(field.dimensions[1]-1)
    const area=coverage.reduce((sum,value)=>sum+value,0)*cellArea
    assert.ok(Math.abs(area-4*.3)<.005,'coverage integrates the footprint instead of depending on grid phase')
  } finally { trim.geometry.dispose(); trim.material.dispose() }
})
