// Run on roofWallRegression.html?materials after geometry preparation.
// Compare actual pixels with/without interior finishes. Pixels whose nearest
// geometry is an exterior wall or roof must not change when finishes are hidden.
export async function checkHorizontalFinishDepth({ restoreLegacyOffset = false } = {}) {
  const { Raycaster, Vector2, Vector3, WebGLRenderTarget } = await import('three')
  const state = window.roofWallScene(), { scene, camera, gl } = state
  const originalCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
  const originalTarget = gl.getRenderTarget()
  const size = gl.getDrawingBufferSize(new Vector2())
  const target = new WebGLRenderTarget(size.x, size.y)
  const finishes = [], opaqueSurfaces = []
  scene.traverse(mesh => {
    if (['room-ceiling-finish', 'room-floor-finish'].includes(mesh.userData.houseDesignerRole)) {
      finishes.push({ mesh, visible: mesh.visible, offset: mesh.material.polygonOffset,
        factor: mesh.material.polygonOffsetFactor, units: mesh.material.polygonOffsetUnits })
    }
    if (mesh.isMesh) opaqueSurfaces.push(mesh)
  })
  if (!finishes.length) throw new Error('No horizontal finishes to inspect')
  const ray = new Raycaster(), point = new Vector2()
  const before = new Uint8Array(size.x * size.y * 4), after = new Uint8Array(before.length)
  const results = []
  const render = pixels => {
    gl.setRenderTarget(target)
    gl.render(scene, camera)
    gl.readRenderTargetPixels(target, 0, 0, size.x, size.y, pixels)
    gl.setRenderTarget(originalTarget)
  }
  try {
    if (restoreLegacyOffset) finishes.forEach(({ mesh }) => {
      mesh.material.polygonOffset = true
      mesh.material.polygonOffsetFactor = -1
      mesh.material.polygonOffsetUnits = -1
    })
    for (const cameraHeight of [4, 1.5, 3]) {
      camera.position.set(10, cameraHeight, -9)
      camera.lookAt(new Vector3(-3, 3, 5))
      camera.updateMatrixWorld(); state.invalidate()
      await new Promise(resolve => setTimeout(resolve, 400))
      finishes.forEach(entry => { entry.visible = entry.mesh.visible })
      render(before)
      finishes.forEach(({ mesh }) => { mesh.visible = false })
      render(after)
      finishes.forEach(({ mesh, visible }) => { mesh.visible = visible })
      let occludedChangedPixels = 0, interiorChangedPixels = 0
      for (let y = 0; y < size.y; y++) for (let x = 0; x < size.x; x++) {
        const i = (y * size.x + x) * 4
        if (Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]),
          Math.abs(before[i + 2] - after[i + 2])) < 12) continue
        point.set((x + 0.5) / size.x * 2 - 1, (y + 0.5) / size.y * 2 - 1)
        ray.setFromCamera(point, camera)
        const hit = ray.intersectObjects(opaqueSurfaces, false).find(({ object, face }) => {
          let current = object
          while (current) { if (!current.visible) return false; current = current.parent }
          const material = Array.isArray(object.material) ? object.material[face.materialIndex] : object.material
          return material.visible && !material.transparent
        })
        if (['roof-top', 'wall-engine-render'].includes(hit?.object.userData.houseDesignerRole)) occludedChangedPixels++
        else interiorChangedPixels++
      }
      results.push({ cameraHeight, occludedChangedPixels, interiorChangedPixels })
    }
    if (results.some(result => result.occludedChangedPixels > 0)) {
      throw new Error(`Interior finishes draw through exterior surfaces: ${JSON.stringify(results)}`)
    }
    if (!results.some(result => result.interiorChangedPixels > 0)) throw new Error('Finishes were not rendered in any view')
    return { passed: true, results }
  } finally {
    finishes.forEach(({ mesh, visible, offset, factor, units }) => {
      mesh.visible = visible
      mesh.material.polygonOffset = offset
      mesh.material.polygonOffsetFactor = factor
      mesh.material.polygonOffsetUnits = units
    })
    gl.setRenderTarget(originalTarget); target.dispose()
    camera.position.copy(originalCamera.position); camera.quaternion.copy(originalCamera.quaternion)
    camera.updateMatrixWorld(); state.invalidate()
  }
}
