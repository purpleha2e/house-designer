import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three'
import { TransformControls } from 'three-stdlib'
import { createViewportSelection } from '../src/viewportSelection.ts'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'

test('roof highlights stay live without rebuilding the retained house display', () => {
  const source = new Scene(), geometry = new BoxGeometry(), material = new MeshBasicMaterial({ transparent: true })
  const roof = new Mesh(geometry, material)
  roof.userData = { houseDesignerRole: 'roof-exterior-highlight', roofId: 'lean-to' }
  source.add(roof)
  const retained = retainViewportScene(source), selection = createViewportSelection()
  try {
    assert.equal(retained.scene.children.length, 0, 'the highlight is not baked into the house snapshot')
    selection.sync(source, retained.scene, 'selected-roof')
    const meshes: Mesh[] = []
    retained.scene.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
    assert.equal(meshes.length, 1)
    assert.equal(meshes[0].geometry, geometry)
    source.remove(roof)
    selection.sync(source, retained.scene, 'none')
    let count = 0
    retained.scene.traverse(object => { if (object instanceof Mesh) count++ })
    assert.equal(count, 0)
  } finally { selection.clear(); retained.dispose(); geometry.dispose(); material.dispose() }
})

test('wall and object selection stays current across retained and startup displays', () => {
  const source = new Scene(), parent = new Group(), geometry = new BoxGeometry()
  const material = new MeshBasicMaterial({ transparent: true, opacity: .28 })
  const wall = new Mesh(geometry, material), object = new Mesh(geometry, material)
  wall.userData = { selectionDecoration: true, houseDesignerRole: 'wall-engine-highlight' }
  parent.userData.selectionDecoration = true; parent.position.set(2, 3, 4); parent.renderOrder = 6
  parent.add(object); source.add(wall, parent)
  const retained = retainViewportScene(source), opaque = createOpaqueViewportScene(source)
  assert.equal(opaque.meshes, 0, 'selection children must not be frozen into opaque PBR geometry')
  assert.equal(retained.scene.children.length, 0)
  const selection = createViewportSelection()
  const meshes = (scene: Scene) => { const result: Mesh[] = []; scene.traverse(o => { if(o instanceof Mesh) result.push(o) }); return result }
  selection.sync(source, opaque.scene)
  assert.equal(meshes(opaque.scene).length, 2)
  const copy = meshes(opaque.scene).find(m => m.parent?.renderOrder === 6)!
  assert.deepEqual(copy.getWorldPosition(new Vector3()).toArray(), [2, 3, 4])
  assert.equal(copy.geometry, geometry); assert.equal(copy.material, material)
  source.remove(wall); parent.position.x = 5
  selection.sync(source, retained.scene)
  assert.equal(meshes(opaque.scene).length, 0, 'handover must not leave a stale highlight behind')
  assert.equal(meshes(retained.scene).length, 1)
  assert.deepEqual(copy.getWorldPosition(new Vector3()).toArray(), [5, 3, 4])
  parent.visible = false
  selection.sync(source, retained.scene)
  assert.equal(meshes(retained.scene).length, 0)
  let disposals = 0
  geometry.addEventListener('dispose', () => disposals++)
  material.addEventListener('dispose', () => disposals++)
  selection.clear(); opaque.dispose(); retained.dispose()
  assert.equal(disposals, 0, 'display proxies do not own selection resources')
  geometry.dispose(); material.dispose()
})

test('unchanged frames leave house geometry alone while nested selection changes remain live', () => {
  const source = new Scene(), display = new Scene(), house = new Group(), selection = createViewportSelection()
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), model = new Mesh(geometry, material)
  source.add(house); house.add(model)
  selection.sync(source, display, 'none')
  let houseUpdates = 0, houseReads = 0
  model.updateMatrixWorld = () => { houseUpdates++ }
  Object.defineProperty(model.userData, 'selectionDecoration', { configurable: true, get() { houseReads++; return false } })
  for (let i = 0; i < 20; i++) selection.sync(source, display, 'none')
  assert.equal(houseUpdates, 0, 'navigation does not update unrelated model transforms')
  assert.equal(houseReads, 0, 'navigation does not rescan the house')
  const highlight = new Mesh(geometry, material), nested = new Group()
  nested.userData.selectionDecoration = true; nested.add(highlight); house.add(nested)
  selection.sync(source, display, 'selected')
  let copies = 0; display.traverse(o => { if (o instanceof Mesh) copies++ })
  assert.equal(copies, 1, 'hierarchy additions update the selection index')
  nested.remove(highlight); selection.sync(source, display, 'selected')
  copies = 0; display.traverse(o => { if (o instanceof Mesh) copies++ })
  assert.equal(copies, 0, 'nested removal cannot leave stale selection geometry')
  selection.clear(); geometry.dispose(); material.dispose()
})

test('prepared displays position real transform handles at the newly attached object', () => {
  const source = new Scene(), display = new Scene(), selection = createViewportSelection()
  const floor = new Group(), first = new Group(), second = new Group()
  floor.position.y = 2.7; first.position.set(3, 1, 8); second.position.set(9, 0.8, 4)
  floor.add(first, second); source.add(floor)
  const camera = new PerspectiveCamera(50, 1, .1, 100)
  camera.position.set(5, 8, 20)
  const controls = new TransformControls(camera)
  source.add(controls)
  const originalTransforms = [first, second].map(o => o.position.toArray())
  try {
    for (const [index, object] of [first, second, first].entries()) {
      controls.attach(object)
      selection.sync(source, display, String(index))
      const expected = object.getWorldPosition(new Vector3())
      assert.ok(controls.worldPosition.distanceTo(expected) < 1e-9,
        'the controls must update even when only the prepared display is rendered')
      const handle = controls.gizmo.gizmo.translate.children.find(o => o instanceof Mesh && o.name === 'X' && o.visible) as Mesh
      assert.ok(handle, 'the real translate handle is visible')
      let copy: Mesh | undefined
      display.traverse(o => { if (o instanceof Mesh && o.geometry === handle.geometry) copy = o })
      assert.ok(copy)
      assert.ok(copy.getWorldPosition(new Vector3()).distanceTo(handle.getWorldPosition(new Vector3())) < 1e-9)
    }
    assert.deepEqual([first, second].map(o => o.position.toArray()), originalTransforms)
  } finally { selection.clear(); controls.dispose() }
})
