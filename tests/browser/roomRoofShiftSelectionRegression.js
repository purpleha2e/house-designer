// Red House's upstairs front window: A is on the room side of an extended roof junction.
export async function checkRoomRoofShiftSelection() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const s = window.roofWallScene(), canvas = s.gl.domElement
  const original = structuredClone(window.regressionAssignments)
  const camera = { position: s.camera.position.clone(), quaternion: s.camera.quaternion.clone() }
  const wallId = 'feb38193-7550-40b8-9dfb-663aa593a6df'
  const wait = () => new Promise(r => setTimeout(r, 300))
  const key = f => `${f.wallId}:${f.side}:${f.fragmentId}`
  const click = async (x, y, shiftKey = false) => {
    s.camera.position.set(x, y, 6.8); s.camera.lookAt(x, y, 7.834318178330288)
    s.camera.updateMatrixWorld(); s.invalidate(); await wait()
    const r = canvas.getBoundingClientRect(), e = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', shiftKey,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...e, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...e, buttons: 0 })); await wait()
    const picked = structuredClone(window.regressionSurface)
    if (picked?.type !== 'wall-surface-fragment' || picked.pickedFragment?.wallId !== wallId) throw Error('Missed window wall')
    return picked
  }
  const colour = (x, y, outside = false) => {
    const meshes = []
    s.scene.traverse(o => { if (o.userData.houseDesignerRole === 'wall-engine-render') meshes.push(o) })
    const hit = new Raycaster(new Vector3(x, y, outside ? 8.5 : 6.8), new Vector3(0, 0, outside ? -1 : 1)).intersectObjects(meshes)[0]
    if (!hit) throw Error('Missing wall colour sample')
    return hit.object.material[hit.face.materialIndex].color.getHexString()
  }
  try {
    const a = await click(0.37, 4.95), lowerA = await click(0.8, 3.2)
    const b = await click(-0.83, 4.95, true), shiftedA = await click(0.37, 4.95, true)
    const members = new Set(b.fragments.map(key))
    if (!members.has(key(a.pickedFragment)) || !members.has(key(lowerA.pickedFragment))) throw Error('Shift B omitted part of A')
    if (JSON.stringify([...members].sort()) !== JSON.stringify(shiftedA.fragments.map(key).sort())) throw Error('Shift A and Shift B selected different rooms')
    if (new Set(b.fragments.map(f => f.wallId)).size < 3) throw Error('Selection did not include the room walls')
    if (b.fragments.some(f => f.wallId === wallId && f.side !== 1)) throw Error('Room selection crossed to exterior wall face')
    const exteriorBefore = colour(0.37, 4.95, true)
    window.updateRegressionAssignments([...original, ...b.fragments.map((target, i) => ({
      id: `room-shift-${i}`, target: { ...target, type: 'wall-surface-fragment' }, materialId: 'dulux-blush-matt',
    }))]); await wait()
    const colours = { a: colour(0.37, 4.95), lowerA: colour(0.8, 3.2), b: colour(-0.83, 4.95) }
    if (new Set(Object.values(colours)).size !== 1 || colour(0.37, 4.95, true) !== exteriorBefore) throw Error(`Room material application failed: ${JSON.stringify(colours)}`)
    return { passed: true, fragments: members.size, wallCount: new Set(b.fragments.map(f => f.wallId)).size, colours, exteriorBefore }
  } finally {
    window.updateRegressionAssignments(original)
    s.camera.position.copy(camera.position); s.camera.quaternion.copy(camera.quaternion); s.camera.updateMatrixWorld(); s.invalidate()
  }
}
