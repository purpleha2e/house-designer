import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Scene } from 'three'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { createViewportSelection } from '../src/viewportSelection.ts'

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
