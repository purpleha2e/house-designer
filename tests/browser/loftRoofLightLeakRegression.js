// Run in roofWallRegression.html?loft-test after scene preparation.
export async function checkLoftRoofLightLeak() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const s = window.roofWallScene(), { scene, camera, gl } = s
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  const roof = window.regressionFloors.flatMap(f => f.roofs ?? [])[0]
  if (!sun?.castShadow || !roof) throw Error('Load loft-test with sun shadows enabled')
  const original = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), intensity: sun.intensity }
  const tops = [], meshes = []
  scene.traverse(o => {
    if (o.userData.houseDesignerRole === 'roof-top') tops.push(o)
    if (o.isMesh && o.visible && !String(o.userData.houseDesignerRole).includes('pick')) meshes.push(o)
  })
  const render = () => {
    sun.shadow.needsUpdate = true
    gl.render(scene, camera)
    const context = gl.getContext(), width = context.drawingBufferWidth, height = context.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
    return { pixels, width, height }
  }
  try {
    let samples = 0, leaking = 0, maxError = 0
    for (const z of [1.65, 10.90420210053031]) {
      camera.position.set(4, 5.7, 6); camera.lookAt(4, 5.7, z); camera.updateMatrixWorld()
      scene.updateMatrixWorld(true)
      sun.intensity = original.intensity
      const lit = render()
      // This closed attic receives no direct sun. Ambient/environment light
      // remains identical, so removing direct sunlight supplies a reference.
      sun.intensity = 0
      const reference = render()
      for (let x = 2; x <= 6; x += 0.025) {
        const top = new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0)).intersectObjects(tops, false)[0]
        if (!top) continue
        for (const inset of [0.001, 0.003, 0.006, 0.012, 0.025]) {
          const point = new Vector3(x, top.point.y - (roof.thickness ?? 0.04) - inset, z)
          const ray = new Raycaster(camera.position, point.clone().sub(camera.position).normalize())
          const hit = ray.intersectObjects(meshes, false).find(h => {
            const m = Array.isArray(h.object.material) ? h.object.material[h.face.materialIndex] : h.object.material
            return m.visible && m.colorWrite
          })
          if (!hit?.object.userData.solidGable || Math.abs(hit.point.z - z) > 0.002) continue
          const ndc = point.project(camera)
          const px = Math.floor((ndc.x + 1) * lit.width / 2), py = Math.floor((ndc.y + 1) * lit.height / 2)
          if (px < 0 || py < 0 || px >= lit.width || py >= lit.height) continue
          const index = (py * lit.width + px) * 4
          const error = Math.max(...[0, 1, 2].map(c => lit.pixels[index + c] - reference.pixels[index + c]))
          samples++; if (error > 3) leaking++; maxError = Math.max(maxError, error)
        }
      }
    }
    if (samples < 500) throw Error(`Insufficient interior seam samples: ${samples}`)
    if (leaking > samples * 0.01) throw Error(`Roof light leak: ${leaking}/${samples} samples; max error ${maxError}`)
    return { passed: true, samples, leaking, maxError }
  } finally {
    sun.intensity = original.intensity; sun.shadow.needsUpdate = true
    camera.position.copy(original.position); camera.quaternion.copy(original.quaternion)
    camera.updateMatrixWorld(); s.invalidate()
  }
}
