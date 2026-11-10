import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Scene } from 'three'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { createViewportSelection } from '../src/viewportSelection.ts'

test('retained view preserves invisible sun blockers for shadow refreshes after model edits', () => {
  const scene = new Scene(), floor = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const blocker = new Mesh(geometry, material)
  blocker.name = 'ceiling-blocker'; blocker.visible = false; blocker.castShadow = true
  blocker.userData.houseDesignerSunShadowBlocker = true
  floor.add(blocker); scene.add(floor)
  const hiddenFloor = new Group(), excluded = blocker.clone()
  excluded.name = 'excluded-blocker'; hiddenFloor.visible = false; hiddenFloor.add(excluded); scene.add(hiddenFloor)
  const display = retainViewportScene(scene)
  try {
    const copy = display.scene.getObjectByName(blocker.name) as Mesh
    assert.ok(copy, 'camera-invisible ceiling must remain a sun caster')
    assert.equal(copy.visible, false, 'the blocker must not enter the beauty image')
    assert.equal(copy.castShadow, true)
    assert.equal(copy.userData.houseDesignerSunShadowBlocker, true)
    assert.equal(display.scene.getObjectByName(excluded.name), undefined, 'excluded storeys remain excluded')
  } finally { display.dispose(); geometry.dispose(); material.dispose() }
})

for (const [name, factory] of [['retained', retainViewportScene], ['opaque', createOpaqueViewportScene]] as const) {
  test(`${name} display keeps a rotated, resized, flipped model aligned with its live selection`, () => {
    const scene = new Scene(), model = new Group(), local = new Group()
    model.name = 'model-transform-stairs'; local.name = 'model-local-transform-stairs'
    const geometry = new BoxGeometry(1, 2, 3), material = new MeshStandardMaterial(), source = new Mesh(geometry, material)
    source.position.set(.2, .3, .4); local.add(source); model.add(local); scene.add(model)
    const display = factory(scene), selection = createViewportSelection()
    const mesh = (() => { let result: Mesh | undefined; display.scene.traverse(o => { if (o instanceof Mesh) result = o }); return result! })()
    const highlight = new Mesh(geometry, material); highlight.userData.selectionDecoration = true; source.add(highlight)
    try {
      assert.equal(display.syncTransforms(), false)
      for (const rotation of [-Math.PI / 2, Math.PI, .37]) {
        model.rotation.y = rotation; model.position.set(4, 1, -3); model.scale.set(1.2, .9, .7)
        local.rotation.y = Math.PI; local.scale.x = -1
        assert.equal(display.syncTransforms(), true)
        selection.sync(scene, display.scene)
        assert.ok(mesh.matrixWorld.equals(source.matrixWorld), 'prepared mesh follows the current transform')
        const highlights: Mesh[] = []; display.scene.traverse(o => { if (o instanceof Mesh && o.userData.selectionDecoration) highlights.push(o) })
        assert.equal(highlights.length, 1); assert.ok(highlights[0].matrixWorld.equals(mesh.matrixWorld))
        assert.equal(mesh.geometry, geometry, 'no geometry rebuild/upload is needed')
        assert.equal(display.syncTransforms(), false)
      }
      scene.remove(model); assert.equal(display.syncTransforms(), true); assert.equal(mesh.visible, false)
      const replacement = new Group(), replacementLocal = new Group()
      replacement.name = model.name; replacementLocal.name = local.name
      replacement.position.set(-2, 2, 3); replacement.rotation.y = .7
      replacement.add(replacementLocal); scene.add(replacement)
      assert.equal(display.syncTransforms(), true); assert.equal(mesh.visible, true)
      const expected = new Matrix4().multiplyMatrices(replacementLocal.matrixWorld, source.matrix)
      assert.ok(mesh.matrixWorld.equals(expected), 'a replacement model keeps retained geometry at the new placement')
    } finally { selection.clear(); display.dispose(); geometry.dispose(); material.dispose() }
  })
}

test('retained instance buffers follow edits, batch replacement, and a final unbatched model', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  let source = new InstancedMesh(geometry, material, 2)
  source.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, 0)); source.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0)); scene.add(source)
  const display = retainViewportScene(scene), copy = display.scene.children.find(o => o instanceof InstancedMesh) as InstancedMesh
  const actual = new Matrix4()
  try {
    source.setMatrixAt(0, new Matrix4().makeTranslation(3, 0, 0)); source.instanceMatrix.needsUpdate = true
    assert.equal(display.syncTransforms(), true); copy.getMatrixAt(0, actual); assert.equal(actual.elements[12], 3)
    scene.remove(source); source.dispose(); source = new InstancedMesh(geometry, material, 3)
    for (let i = 0; i < 3; i++) source.setMatrixAt(i, new Matrix4().makeTranslation(i + 4, 0, 0))
    scene.add(source); assert.equal(display.syncTransforms(), true); assert.equal(copy.count, 3)
    copy.getMatrixAt(2, actual); assert.equal(actual.elements[12], 6)
    scene.remove(source)
    const single = new Mesh(geometry, material); single.position.x = 9; scene.add(single)
    assert.equal(display.syncTransforms(), true); assert.equal(copy.count, 1)
    copy.getMatrixAt(0, actual); assert.equal(actual.elements[12], 9)
    scene.remove(single); display.syncTransforms(); assert.equal(copy.count, 0)
  } finally { display.dispose(); source.dispose(); geometry.dispose(); material.dispose() }
})
