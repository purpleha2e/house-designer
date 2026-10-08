import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshStandardMaterial, Texture } from 'three'
import { applyWindowFrameFinish } from '../src/windowFrameMaterial.ts'
import { createWindowDesign } from '../src/windowDesign.ts'
import { createWindowGeometry, disposeWindowGeometry } from '../src/windowGeometry.ts'

test('satin window lighting preserves white and coloured designer finishes through updates', () => {
  const environment = new Texture()
  for (const color of ['#ffffff', '#f4f3ee', '#174e36', '#202934']) {
    const design = { ...createWindowDesign(), color }
    const window = createWindowGeometry(design)
    const frame = (window.getObjectByName('frame-top') as Mesh).material as MeshStandardMaterial
    const before = frame.color.clone()
    assert.ok(applyWindowFrameFinish(frame, environment, 0.55))
    assert.ok(frame.color.equals(before))
    assert.equal(frame.color.getHexString(), color.slice(1))
    assert.equal(frame.metalness, 0)
    assert.equal(frame.emissive.getHex(), 0)
    assert.equal(frame.envMap, environment)
    applyWindowFrameFinish(frame, environment, 0.16)
    assert.ok(frame.color.equals(before))
    assert.equal(frame.envMapIntensity, 0.16)
    disposeWindowGeometry(window)
  }
  environment.dispose()
})

test('imported window frames retain their colour texture; glass and other models keep their materials', () => {
  const environment = new Texture(), paint = new Texture()
  const frame = new MeshStandardMaterial({ name: 'painted_white_frame.002', color: '#e8eeed', map: paint, metalness: 0.05 })
  const before = frame.color.clone()
  assert.ok(applyWindowFrameFinish(frame, environment, 0.55))
  assert.ok(frame.color.equals(before))
  assert.equal(frame.map, paint)
  const version = frame.version
  applyWindowFrameFinish(frame, environment, 0.55)
  assert.equal(frame.version, version, 'reapplying the same finish does not recompile its shader')
  for (const name of ['pale_blue_glass', 'Window handles', 'interior_door_white', 'Default OBJ']) {
    const material = new MeshStandardMaterial({ name, metalness: 0.1, roughness: 0.7 })
    assert.equal(applyWindowFrameFinish(material, environment, 0.55), false)
    assert.equal(material.envMap, null)
    assert.equal(material.roughness, 0.7)
    material.dispose()
  }
  frame.dispose(); environment.dispose(); paint.dispose()
})
