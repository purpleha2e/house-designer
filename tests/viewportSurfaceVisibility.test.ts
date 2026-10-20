import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from 'three'
import { retainViewportScene } from '../src/retainedViewportScene.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { registerViewportSurfaceVisibility } from '../src/viewportSurfaceVisibility.ts'

for (const [name, snapshot] of [['retained', retainViewportScene], ['startup', createOpaqueViewportScene]] as const) {
  test(`${name} scene retains floors hidden from below and updates surface visibility immediately`, () => {
    const source = new Scene(), geometry = new BoxGeometry(), floorMaterial = new MeshStandardMaterial()
    const floor = new Mesh(geometry, floorMaterial), ceiling = new Mesh(geometry, floorMaterial.clone())
    const capMaterial = floorMaterial.clone(), cap = new Mesh(geometry, capMaterial)
    const hidden = new Group(), helper = new Mesh(geometry, floorMaterial.clone())
    hidden.visible = false; hidden.add(helper)
    floor.visible = false; capMaterial.visible = false
    source.add(floor, ceiling, cap, hidden)
    const release = [
      registerViewportSurfaceVisibility(floor, camera => camera.y >= 2.7),
      registerViewportSurfaceVisibility(ceiling, camera => camera.y <= 2.4),
      registerViewportSurfaceVisibility(capMaterial, camera => camera.y >= 2.7),
    ]
    const prepared = snapshot(source)
    try {
      const meshes: Mesh[] = []
      prepared.scene.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
      assert.equal(meshes.length, 3, 'all camera-dependent surfaces retained; hidden editor helpers excluded')
      const [floorCopy, ceilingCopy, capCopy] = meshes
      // Snapshot rules survive the source being replaced by the editor.
      release.forEach(release => release())
      const cases = [
        { y: 1.8, floor: false, ceiling: true },
        { y: 4.5, floor: true, ceiling: false },
        { y: 1.8, floor: false, ceiling: true },
        { y: 4.5, floor: true, ceiling: false },
      ]
      for (const position of cases) {
        prepared.syncVisibility({ x: 0, y: position.y, z: 0 })
        assert.equal(floorCopy.visible, position.floor)
        assert.equal(ceilingCopy.visible, position.ceiling)
        assert.equal((capCopy.material as MeshStandardMaterial).visible, position.floor)
        assert.equal(prepared.syncVisibility({ x: 0, y: position.y, z: 0 }), false)
      }
    } finally { prepared.dispose(); geometry.dispose(); floorMaterial.dispose(); ceiling.material.dispose(); capMaterial.dispose(); helper.material.dispose() }
  })
}
