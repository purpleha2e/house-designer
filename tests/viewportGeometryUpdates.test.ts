import assert from 'node:assert/strict'
import test from 'node:test'
import { DoubleSide, Mesh, MeshStandardMaterial, Path, PlaneGeometry, Raycaster, Scene, Shape, ShapeGeometry, Vector3 } from 'three'
import { retainViewportScene } from '../src/retainedViewportScene.ts'

test('prepared display publishes a real wall opening before whole-scene preparation completes', () => {
  const scene = new Scene(), material = new MeshStandardMaterial({ side: DoubleSide }), solid = new PlaneGeometry(4, 3)
  const source = new Mesh(solid, material); source.userData.houseDesignerRole = 'wall-engine-render'; scene.add(source)
  const display = retainViewportScene(scene), copy = display.scene.children.find(o => o instanceof Mesh) as Mesh
  const ray = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1))
  assert.equal(ray.intersectObject(copy).length > 0, true)
  const shape = new Shape().moveTo(-2, -1.5).lineTo(2, -1.5).lineTo(2, 1.5).lineTo(-2, 1.5).closePath()
  shape.holes.push(new Path().moveTo(-.5, -.5).lineTo(-.5, .5).lineTo(.5, .5).lineTo(.5, -.5).closePath())
  const opening = new ShapeGeometry(shape), preparedMaterial = copy.material
  let released = 0; opening.addEventListener('dispose', () => released++)
  try {
    source.geometry = opening
    assert.equal(display.syncGeometry(), true)
    assert.equal(copy.material, preparedMaterial, 'the compiled material is retained')
    assert.equal(ray.intersectObject(copy).length, 0, 'the opening is visible, not just the moved window frame')
    assert.equal(display.syncGeometry(), false)
    opening.dispose(); assert.equal(released, 0, 'the displayed geometry remains leased')
  } finally { display.dispose(); solid.dispose(); material.dispose() }
  assert.equal(released, 1)
})
