// Run in roofWallRegression.html?loft-test&edit-floor after preparation.
export async function checkLoftSkirtingLightLeak() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const s = window.roofWallScene(), { scene, camera, gl } = s
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  if (!sun?.castShadow) throw Error('Sun shadows must be enabled')
  const skirting = []
  scene.traverse(o => { if (o.userData.houseDesignerRole === 'skirting') skirting.push(o) })
  const original = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), intensity: sun.intensity }
  const render = () => {
    sun.shadow.needsUpdate = true; gl.render(scene, camera)
    const c = gl.getContext(), width = c.drawingBufferWidth, height = c.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    c.readPixels(0, 0, width, height, c.RGBA, c.UNSIGNED_BYTE, pixels)
    return { pixels, width, height }
  }
  try {
    let samples = 0, leaking = 0, maxError = 0
    for (const [position, target] of [
      [[4, 3.4, 7], [6.3, 2.85, 10]], [[4, 3.4, 5], [1.7, 2.85, 2]],
    ]) {
      camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld()
      scene.updateMatrixWorld(true)
      sun.intensity = original.intensity; const lit = render()
      // The fixture has no openings: the entire skirting top must be
      // shielded from direct sun, including its contact with the wall.
      sun.intensity = 0; const reference = render()
      for (const mesh of skirting) {
        const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal
        for (let i = 0; i < p.count; i += 3) {
          if (n.getY(i) < 0.99) continue
          const vertices = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(p, i + j).applyMatrix4(mesh.matrixWorld))
          for (let a = 1; a < 30; a++) for (let b = 1; b < 30 - a; b++) {
            const point = vertices[0].clone().multiplyScalar(a / 30)
              .addScaledVector(vertices[1], b / 30).addScaledVector(vertices[2], 1 - (a + b) / 30)
            const hit = new Raycaster(camera.position, point.clone().sub(camera.position).normalize())
              .intersectObjects(skirting, false)[0]
            if (!hit || hit.point.distanceTo(point) > 0.002) continue
            const ndc = point.project(camera)
            const x = Math.floor((ndc.x + 1) * lit.width / 2), y = Math.floor((ndc.y + 1) * lit.height / 2)
            if (x < 0 || y < 0 || x >= lit.width || y >= lit.height) continue
            const index = (y * lit.width + x) * 4
            const error = Math.max(...[0, 1, 2].map(c => lit.pixels[index + c] - reference.pixels[index + c]))
            samples++; if (error > 3) leaking++; maxError = Math.max(maxError, error)
          }
        }
      }
    }
    if (samples < 500) throw Error(`Insufficient skirting samples: ${samples}`)
    if (leaking > samples * 0.01) throw Error(`Skirting sunlight leak: ${leaking}/${samples} samples; max error ${maxError}`)
    return { passed: true, samples, leaking, maxError }
  } finally {
    sun.intensity = original.intensity; sun.shadow.needsUpdate = true
    camera.position.copy(original.position); camera.quaternion.copy(original.quaternion)
    camera.updateMatrixWorld(); s.invalidate()
  }
}
