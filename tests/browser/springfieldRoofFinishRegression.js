// Run on roofWallRegression.html?springfield&materials. Exercise exterior paint
// selection, including the exposed wall beneath an overhang and an open canopy.
export async function checkSpringfieldRoofFinishes() {
  const { Raycaster, Vector3 } = await import('three')
  const s = window.roofWallScene(), canvas = s.gl.domElement
  const original = structuredClone(window.regressionAssignments)
  const camera = { position: s.camera.position.clone(), quaternion: s.camera.quaternion.clone() }
  const wait = () => new Promise(resolve => setTimeout(resolve, 450))
  const sideWall = 'b0ebccfb-76de-40f2-a05f-ed79c4176ee0'
  const rearWall = 'cc68aecd-58eb-476d-a29b-996164b1c4a1'
  const brick = 'portal-material-0b2dc7ea2ce7b4eef9b3d5ce6c29e9b4'
  const sample = (origin, direction) => {
    const meshes = []
    s.scene.traverse(o => { if (o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    const hit = new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(meshes, false)[0]
    if (!hit || hit.distance > 1) throw new Error(`Missing facade at ${origin}`)
    const material = hit.object.material[hit.face.materialIndex]
    return { point: hit.point.toArray(), color: material.color.getHexString(), texture: material.map?.uuid }
  }
  const samples = () => ({
    strip: sample([5, 3, 8.65], [1,0,0]),
    sideAbove: sample([5, 4, 8.65], [1,0,0]),
    sideInterior: sample([5, 3, 8.4], [1,0,0]),
    canopy: sample([9.6, 2.8, 12.2], [0,0,-1]),
    rearAbove: sample([9, 4, 12.2], [0,0,-1]),
    porchInterior: sample([12, 2.8, 12.2], [0,0,-1]),
  })
  const click = async (position, target) => {
    s.camera.position.set(...position); s.camera.lookAt(...target); s.camera.updateMatrixWorld(); s.invalidate()
    await wait()
    const r = canvas.getBoundingClientRect()
    const event = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: r.left+r.width/2, clientY: r.top+r.height/2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', {...event, buttons: 1}))
    canvas.dispatchEvent(new PointerEvent('pointerup', {...event, buttons: 0}))
    await wait()
    const selected = window.regressionSurface
    if (!selected?.fragments?.length) throw new Error(`Exterior wall selection missing at ${position}: ${JSON.stringify(selected)}`)
    return selected.fragments
  }
  try {
    let assignments = original.filter(a => !(a.target.type === 'wall-surface-fragment' &&
      [sideWall, rearWall].includes(a.target.wallId) && a.target.side === 1))
      .map(a => a.materialId === 'house-designer-red-brick' ? { ...a, materialId: brick } : a)
    assignments.push(...[sideWall,rearWall].map(wallId => ({ id: `test-base-${wallId}`,
      materialId: 'house-designer-custom-paint-matt', customColor: '#94a3b8', target: { type: 'wall-face', wallId, side: 1 } })))
    window.updateRegressionAssignments(assignments); await wait()
    const before = samples()
    for (const [position,target] of [[[3,4,10],[5.36,4,10]], [[9,4,14],[9,4,11.937]]]) {
      const fragments = await click(position,target)
      assignments = [...assignments, ...fragments.map((f,i) => ({ id: `test-brick-${assignments.length}-${i}`,
        materialId: brick, target: { type: 'wall-surface-fragment', ...f } }))]
      window.updateRegressionAssignments(assignments); await wait()
    }
    const after = samples()
    for (const [patch, facade] of [['strip','sideAbove'], ['canopy','rearAbove']]) {
      if (!after[patch].texture || after[patch].texture !== after[facade].texture) {
        throw new Error(`Exterior ${patch} was excluded from brick selection: ${JSON.stringify(after)}`)
      }
    }
    for (const name of ['sideInterior','porchInterior']) {
      if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) throw new Error(`Exterior paint changed ${name}`)
    }
    return { passed: true, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    s.camera.position.copy(camera.position); s.camera.quaternion.copy(camera.quaternion); s.camera.updateMatrixWorld(); s.invalidate()
  }
}

// Check the reported saved-project load independently of repainting.
export async function checkLoadedSpringfieldRoofFinishes() {
  const { Raycaster, Vector3 } = await import('three')
  const s = window.roofWallScene(), meshes = []
  s.scene.traverse(o => { if (o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
  const results = []
  for (const [origin,direction] of [
    [[5,3,8.65],[1,0,0]], [[5,4,8.65],[1,0,0]],
    [[9.6,2.8,12.2],[0,0,-1]], [[9,4,12.2],[0,0,-1]],
  ]) {
    const hit = new Raycaster(new Vector3(...origin),new Vector3(...direction)).intersectObjects(meshes,false)[0]
    if (!hit || hit.distance > 1) throw new Error(`Missing exterior geometry at ${origin}`)
    const material = hit.object.material[hit.face.materialIndex]
    if (!material.map) throw new Error(`Missing saved brick finish at ${origin}`)
    results.push({ point:hit.point.toArray(), texture:material.map.uuid })
  }
  if (new Set(results.map(r => r.texture)).size !== 1) throw new Error('Saved patch and facade finishes differ')
  return { passed:true, samples:results }
}
