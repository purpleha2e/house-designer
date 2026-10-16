import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three'
import { createViewportSelection } from '../src/viewportSelection.ts'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'

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
