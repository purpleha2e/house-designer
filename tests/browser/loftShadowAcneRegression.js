// Run in roofWallRegression.html?loft-test after scene preparation.
export async function checkLoftShadowAcne() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const s = window.roofWallScene(), { scene, camera, gl } = s
  const originalCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
  const gables = [], meshes = []
  scene.traverse(o => {
    if (o.isMesh && o.visible && o.userData.houseDesignerRole !== 'wall-engine-pick') meshes.push(o)
    if (o.userData.solidGable) gables.push([o, o.castShadow])
  })
  if (!gables.length) throw Error('Load loft-test before running the shadow regression')
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  if (!sun?.castShadow) throw Error('Sun shadows must be enabled')
  const render = () => {
    sun.shadow.needsUpdate = true
    gl.render(scene, camera)
    const context = gl.getContext()
    const pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4)
    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight,
      context.RGBA, context.UNSIGNED_BYTE, pixels)
    return { pixels, width: context.drawingBufferWidth, height: context.drawingBufferHeight }
  }
  try {
    camera.position.set(-2, 8, 15); camera.lookAt(4, 4, 7); camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    const normal = render()
    for (const [mesh] of gables) mesh.castShadow = false
    const reference = render()
    let samples = 0, affected = 0, maxError = 0
    // Sample the sun-facing vertical gable away from its roof overhang.
    // It cannot legitimately shadow itself here; the roof still casts in
    // both renders, so this comparison does not hide the contact shadow.
    for (let x = 2.3; x <= 5.7; x += 0.07) for (let y = 5.15; y <= 6.2; y += 0.07) {
      const point = new Vector3(x, y, 11.20420210053031)
      const ray = new Raycaster(camera.position, point.clone().sub(camera.position).normalize())
      const hit = ray.intersectObjects(meshes, false).find(h => {
        const m = Array.isArray(h.object.material) ? h.object.material[h.face.materialIndex] : h.object.material
        return m.visible && m.colorWrite
      })
      if (!hit?.object.userData.solidGable || Math.abs(hit.point.z - point.z) > 0.002) continue
      const ndc = point.project(camera)
      const px = Math.floor((ndc.x + 1) * normal.width / 2)
      const py = Math.floor((ndc.y + 1) * normal.height / 2)
      if (px < 0 || py < 0 || px >= normal.width || py >= normal.height) continue
      const index = (py * normal.width + px) * 4
      const error = Math.max(...[0, 1, 2].map(c => Math.abs(normal.pixels[index + c] - reference.pixels[index + c])))
      samples++; if (error > 3) affected++; maxError = Math.max(maxError, error)
    }
    if (samples < 100) throw Error(`Insufficient visible gable samples: ${samples}`)
    if (affected > samples * 0.01) throw Error(`Gable self-shadow acne: ${affected}/${samples} samples; max error ${maxError}`)
    return { passed: true, samples, affected, maxError }
  } finally {
    for (const [mesh, castShadow] of gables) mesh.castShadow = castShadow
    camera.position.copy(originalCamera.position); camera.quaternion.copy(originalCamera.quaternion)
    camera.updateMatrixWorld(); sun.shadow.needsUpdate = true; s.invalidate()
  }
}
