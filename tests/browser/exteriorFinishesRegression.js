// Run on roofWallRegression.html?materials with the saved Red House.
export async function checkExteriorFinishes() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const wait = () => new Promise(resolve => setTimeout(resolve, 350))
  for (let attempt = 0; attempt < 80; attempt++) {
    const completed = window.houseDesignerEngineLog?.entries
      .filter(entry => entry.type === 'wall-roof-clipping-complete').length ?? 0
    if (completed >= window.regressionFloors.length) break
    if (attempt === 79) throw new Error('Wall geometry did not finish preparing')
    await wait()
  }
  const state = window.roofWallScene()
  const camera = state.camera
  const original = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
  const samples = [
    ['extension side', [6.5, 1.34, 4.26]],
    ['narrow ground wall', [1.7, 1.24, 1.2]],
    ['entrance return', [-1.3, 1.17, 0.17]],
    ['wide ground wall', [-4.8, 1.07, -1.78]],
    ['roof junction strip at front', [2, 4.5, 2.5]],
    ['roof junction strip at back', [2, 4.5, 6.7658]],
    ['rebuilt facade beside junction', [2, 4.5, 6.4]],
    ['entrance floor zone', [-1.3, 2.55, 0.17]],
    ['wide wall floor zone', [-4.8, 2.55, -1.78]],
  ]
  try {
    camera.position.set(10, 2.72, -9)
    camera.lookAt(-3, 2.72, 5)
    camera.updateMatrixWorld()
    state.invalidate()
    await wait()
    const meshes = []
    state.scene.traverse(object => {
      if (object.isMesh && object.userData.houseDesignerRole === 'wall-engine-render') meshes.push(object)
    })
    const results = samples.map(([name, origin]) => {
      const ray = new Raycaster(new Vector3(...origin), new Vector3(-1, 0, 0))
      const hit = ray.intersectObjects(meshes, false)[0]
      if (!hit) throw new Error(`Missing exterior sample: ${name}`)
      const material = hit.object.material[hit.face.materialIndex]
      if (!material.map) throw new Error(`Exterior finish missing on ${name}: ${material.color.getHexString()}`)
      return { name, texture: material.map.uuid, point: hit.point.toArray() }
    })
    if (new Set(results.map(result => result.texture)).size !== 1) {
      throw new Error(`Exterior panels have different finishes: ${JSON.stringify(results)}`)
    }
    return { passed: true, samples: results }
  } finally {
    camera.position.copy(original.position)
    camera.quaternion.copy(original.quaternion)
    camera.updateMatrixWorld()
    state.invalidate()
  }
}

// Older saves (and rebuilt cutters) may have no matching cap-specific finish.
// They must inherit brick from the adjoining exterior fragment on both ends.
export async function checkInheritedJunctionFinishes() {
  await checkExteriorFinishes()
  const original = structuredClone(window.regressionAssignments)
  try {
    window.updateRegressionAssignments(JSON.parse(JSON.stringify(original.filter(
      assignment => !assignment.target.fragmentId?.includes(':roof-boundary-cap:'),
    ))))
    await new Promise(resolve => setTimeout(resolve, 400))
    return await checkExteriorFinishes()
  } finally {
    window.updateRegressionAssignments(original)
  }
}
