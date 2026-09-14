// Run on roofWallRegression.html?roof-tests after the wall worker completes.
export async function checkRoofMaterialRegions() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const wait = () => new Promise(resolve => setTimeout(resolve, 250))
  for (let attempt = 0; attempt < 80 && window.houseDesignerEngineLog.entries.filter(e => e.type === 'wall-roof-clipping-complete').length < 2; attempt++) await wait()
  const state = window.roofWallScene()
  const canvas = state.gl.domElement
  const originalCamera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  state.camera.position.set(14, 4.5, 5)
  state.camera.lookAt(6.65, 4.5, 5)
  state.camera.updateMatrixWorld()
  const click = async (z, shiftKey = false) => {
    state.camera.position.set(14, 4.5, z)
    state.camera.lookAt(6.65, 4.5, z)
    state.camera.updateMatrixWorld()
    await wait()
    const point = new Vector3(6.65, 4.5, z).project(state.camera)
    const rect = canvas.getBoundingClientRect()
    const event = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', shiftKey,
      clientX: rect.left + (point.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - point.y) * rect.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
    await wait()
    return structuredClone(window.regressionSurface)
  }
  const original = structuredClone(window.regressionAssignments)
  try {
  const left = await click(2.7)
  const right = await click(7.5)
  const shifted = await click(2.7, true)
  const ids = surface => surface?.fragments?.map(f => f.fragmentId) ?? []
  if (!ids(left).length || !ids(right).length || ids(left).some(id => ids(right).includes(id))) {
    throw new Error(`The two exposed A regions must select independently: ${JSON.stringify({ left, right })}`)
  }
  if (!ids(right).every(id => ids(shifted).includes(id)) || ids(shifted).some(id => id.includes(':below'))) {
    throw new Error('Shift selection must join exposed exterior regions without selecting the wall hidden behind the roof')
  }
  const additions = left.fragments.map((fragment, i) => ({ id: `region-test-${i}`,
    materialId: 'dulux-blush-matt', target: { type: 'wall-surface-fragment', ...fragment } }))
  const materialAt = (z, y) => {
    const meshes = []
    state.scene.traverse(o => { if (o.isMesh && o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    const hit = new Raycaster(new Vector3(6.8, y, z), new Vector3(-1, 0, 0)).intersectObjects(meshes, false)[0]
    if (!hit) throw new Error('Missing wall surface')
    return hit.object.material[hit.face.materialIndex].color.getHexString()
  }
  const before = { right: materialAt(7.5, 4.5), hidden: materialAt(5, 3.5) }
    window.updateRegressionAssignments(JSON.parse(JSON.stringify([...original, ...additions])))
    await wait()
    const after = { left: materialAt(2.7, 4.5), right: materialAt(7.5, 4.5), hidden: materialAt(5, 3.5) }
    if (after.left === after.right || after.right !== before.right || after.hidden !== before.hidden) {
      throw new Error(`Material crossed the roof contact line: ${JSON.stringify({ before, after })}`)
    }
    return { passed: true, leftFragments: ids(left).length, rightFragments: ids(right).length, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    state.camera.position.copy(originalCamera.position)
    state.camera.quaternion.copy(originalCamera.quaternion)
    state.camera.updateMatrixWorld()
  }
}

// Run on roofWallRegression.html?materials for the saved red_house_3 scene.
export async function checkRedHouseRoofMaterialRegions() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene(), canvas = state.gl.domElement
  const wait = () => new Promise(resolve => setTimeout(resolve, 400))
  for (let attempt = 0; attempt < 50 && window.houseDesignerEngineLog.entries.filter(e => e.type === 'wall-roof-clipping-complete').length < 2; attempt++) await wait()
  const original = structuredClone(window.regressionAssignments)
  const camera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  const clickAt = async (x, y, z, side = false) => {
    state.camera.position.set(side ? 6 : x, y, side ? z : 12)
    state.camera.lookAt(x, y, z)
    state.camera.updateMatrixWorld()
    await wait()
    const rect = canvas.getBoundingClientRect()
    const event = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse',
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
    await wait()
    return structuredClone(window.regressionSurface)
  }
  const materialAt = (x, y) => {
    const meshes = []
    state.scene.traverse(o => { if (o.isMesh && o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    const hit = new Raycaster(new Vector3(x, y, 8.05), new Vector3(0, 0, -1)).intersectObjects(meshes, false)[0]
    if (!hit || Math.abs(hit.point.z - 7.984318178330288) > 0.001) throw new Error('Missing front facade')
    return hit.object.material[hit.face.materialIndex].color.getHexString()
  }
  try {
    const mainLeft = await clickAt(1.35, 4.5, 1.8, true)
    const mainRight = await clickAt(1.35, 4.5, 7.5, true)
    if (!mainLeft?.fragments?.length || !mainRight?.fragments?.length ||
      mainLeft.fragments.some(a => mainRight.fragments.some(b => a.fragmentId === b.fragmentId))) {
      throw new Error('The partial main roof contacts did not select independently')
    }
    const selected = await clickAt(0.8, 3.3, 7.984318178330288)
    if (selected?.type !== 'wall-surface-fragment' || !selected.fragmentId.includes(':roof-region:')) {
      throw new Error(`Bay facade did not select a roof region: ${JSON.stringify(selected)}`)
    }
    const before = { exposed: materialAt(0.8, 3.3), hidden: materialAt(-0.2, 2.9) }
    window.updateRegressionAssignments([...original, ...selected.fragments.map((f, i) => ({
      id: `red-roof-region-${i}`, materialId: 'dulux-blush-matt', target: { type: 'wall-surface-fragment', ...f },
    }))])
    await wait()
    const after = { exposed: materialAt(0.8, 3.3), hidden: materialAt(-0.2, 2.9) }
    if (after.exposed === before.exposed || after.hidden !== before.hidden) throw new Error(`Finish leaked across Bay roof: ${JSON.stringify({before,after})}`)
    return { passed: true, fragments: selected.fragments.length, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    state.camera.position.copy(camera.position)
    state.camera.quaternion.copy(camera.quaternion)
    state.camera.updateMatrixWorld()
  }
}
