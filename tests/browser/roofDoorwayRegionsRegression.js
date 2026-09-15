// Run on roofWallRegression.html?materials (red_house_3).
export async function checkRoofDoorwayRegions() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene(), canvas = state.gl.domElement
  const wait = () => new Promise(resolve => setTimeout(resolve, 300))
  for (let i = 0; i < 80 && window.houseDesignerEngineLog.entries.filter(e => e.type === 'wall-roof-clipping-complete').length < 2; i++) await wait()
  const camera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  const original = structuredClone(window.regressionAssignments)
  const samples = { A: [6.2, 3.45], C: [5.09, 4.98], D: [4.1, 3.45], B: [7, 4.6], E: [2, 4.6] }
  const click = async ([z, y]) => {
    state.camera.position.set(2, y, z)
    state.camera.lookAt(1.35, y, z)
    state.camera.updateMatrixWorld()
    state.invalidate()
    await wait()
    const rect = canvas.getBoundingClientRect()
    const event = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse',
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
    await wait()
    return structuredClone(window.regressionSurface)
  }
  const materialAt = ([z, y]) => {
    const meshes = []
    state.scene.traverse(o => { if (o.isMesh && o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    const hit = new Raycaster(new Vector3(2, y, z), new Vector3(-1, 0, 0)).intersectObjects(meshes, false)[0]
    if (!hit || Math.abs(hit.point.x - 1.35) > 0.001) throw new Error('Doorway wall pieces must lie on x=1.35')
    return hit.object.material[hit.face.materialIndex].color.getHexString()
  }
  try {
    const selections = {}, before = {}
    for (const [name, point] of Object.entries(samples)) {
      selections[name] = await click(point)
      before[name] = materialAt(point)
      if (!selections[name]?.fragments?.length) throw new Error(`Missing selection ${name}`)
    }
    const ids = name => selections[name].fragments.map(f => f.fragmentId).sort()
    if (JSON.stringify(ids('A')) !== JSON.stringify(ids('C')) || JSON.stringify(ids('A')) !== JSON.stringify(ids('D'))) {
      throw new Error(`Doorway selection split at the roof ridge: ${JSON.stringify(selections)}`)
    }
    for (const [a, b] of [['A', 'B'], ['A', 'E'], ['B', 'E']]) {
      if (ids(a).some(id => ids(b).includes(id))) throw new Error(`Roof boundary lost between ${a} and ${b}`)
    }
    window.updateRegressionAssignments([...original, ...selections.A.fragments.map((f, i) => ({
      id: `doorway-region-${i}`, materialId: 'dulux-blush-matt', target: { type: 'wall-surface-fragment', ...f },
    }))])
    await wait()
    const after = Object.fromEntries(Object.entries(samples).map(([name, point]) => [name, materialAt(point)]))
    if (after.A === before.A || after.C !== after.A || after.D !== after.A || after.B !== before.B || after.E !== before.E) {
      throw new Error(`Doorway paint must cover A/C/D only: ${JSON.stringify({ before, after })}`)
    }
    return { passed: true, doorwayFragments: ids('A').length, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    state.camera.position.copy(camera.position)
    state.camera.quaternion.copy(camera.quaternion)
    state.camera.updateMatrixWorld()
    state.invalidate()
  }
}

// The opposite, room-facing side must select continuously across all roof lines.
export async function checkRoomSideOfRoofDoorway() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene(), canvas = state.gl.domElement
  const wait = () => new Promise(resolve => setTimeout(resolve, 300))
  for (let i = 0; i < 80 && window.houseDesignerEngineLog.entries.filter(e => e.type === 'wall-roof-clipping-complete').length < 2; i++) await wait()
  const camera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  const original = structuredClone(window.regressionAssignments)
  const samples = { A: [2,4.6], B: [4.1,3.45], C: [7,4.6], lintel: [5.09,4.98], right: [6.2,3.45] }
  const colors = (inside) => {
    const meshes = []
    state.scene.traverse(o => { if (o.isMesh && o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    return Object.fromEntries(Object.entries(samples).map(([name, [z,y]]) => {
      const hit = new Raycaster(new Vector3(inside ? 0 : 2,y,z), new Vector3(inside ? 1 : -1,0,0))
        .intersectObjects(meshes, false)[0]
      if (!hit || Math.abs(hit.point.x - (inside ? 1.05 : 1.35)) > 0.001) throw new Error(`Missing wall at ${name}`)
      return [name, hit.object.material[hit.face.materialIndex].color.getHexString()]
    }))
  }
  try {
    const selections = []
    for (const [z,y] of Object.values(samples)) {
      state.camera.position.set(0,y,z)
      state.camera.lookAt(1.05,y,z)
      state.camera.updateMatrixWorld()
      state.invalidate()
      await wait()
      const rect = canvas.getBoundingClientRect()
      const event = { bubbles:true, button:0, pointerId:1, pointerType:'mouse',
        clientX:rect.left+rect.width/2, clientY:rect.top+rect.height/2 }
      canvas.dispatchEvent(new PointerEvent('pointerdown', {...event, buttons:1}))
      canvas.dispatchEvent(new PointerEvent('pointerup', {...event, buttons:0}))
      await wait()
      selections.push(structuredClone(window.regressionSurface))
    }
    const ids = surface => surface?.fragments?.map(f => `${f.wallId}:${f.side}:${f.fragmentId}`).sort()
    if (!ids(selections[0])?.length || selections.some(s => JSON.stringify(ids(s)) !== JSON.stringify(ids(selections[0])))) {
      throw new Error(`Room side must select across all exterior roof boundaries: ${JSON.stringify(selections)}`)
    }
    if (selections[0].fragments.some(f => f.side !== 1 || f.wallId !== '3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e')) {
      throw new Error('Room selection crossed to another wall or the opposite side')
    }
    const before = { inside: colors(true), outside: colors(false) }
    window.updateRegressionAssignments([...original, ...selections[0].fragments.map((f,i) => ({
      id:`room-doorway-${i}`, materialId:'dulux-blush-matt', target:{type:'wall-surface-fragment', ...f},
    }))])
    await wait()
    const after = { inside: colors(true), outside: colors(false) }
    if (after.inside.A === before.inside.A || Object.values(after.inside).some(c => c !== after.inside.A) ||
      JSON.stringify(before.outside) !== JSON.stringify(after.outside)) {
      throw new Error(`Room paint must cover the entire inside face only: ${JSON.stringify({before,after})}`)
    }
    return { passed:true, fragments:ids(selections[0]).length, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    state.camera.position.copy(camera.position)
    state.camera.quaternion.copy(camera.quaternion)
    state.camera.updateMatrixWorld()
    state.invalidate()
  }
}
