// Run on roofWallRegression.html?materials after the scene has finished preparing.
export async function checkRoofUnderside() {
  const { replaceRoofMaterialAssignment } = await import('/src/roofMaterialAssignments.ts')
  const { FrontSide } = await import('/node_modules/.vite/deps/three.js')
  const s = window.roofWallScene(), canvas = s.gl.domElement
  const original = structuredClone(window.regressionAssignments)
  const camera = { position: s.camera.position.clone(), quaternion: s.camera.quaternion.clone() }
  const wait = () => new Promise(resolve => setTimeout(resolve, 1000))
  const roofId = 'b490e12e-e2cc-4509-801c-33d0e68a1aa2'
  const find = role => {
    let mesh
    s.scene.traverse(o => { if (o.userData.roofId === roofId && o.userData.houseDesignerRole === role) mesh = o })
    if (!mesh) throw new Error(`Missing ${role}`)
    return mesh
  }
  const click = async (position, target) => {
    s.camera.position.set(...position); s.camera.lookAt(...target); s.camera.updateMatrixWorld(); s.invalidate(); await wait()
    const r = canvas.getBoundingClientRect(), event = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
    await wait()
    return structuredClone(window.regressionSurface)
  }
  try {
    const selection = await click([3.4, 4.3, 6], [3.4, 5.5, 6])
    if (selection?.type !== 'roof' || selection.roofId !== roofId || selection.part !== 'underside') throw new Error(`Wrong underside selection: ${JSON.stringify(selection)}`)
    const baseline = replaceRoofMaterialAssignment(original, selection, null)
    window.updateRegressionAssignments(JSON.parse(JSON.stringify(baseline))); await wait()
    const before = { top: find('roof-top').material.color.getHexString(), underside: find('roof-underside').material.color.getHexString(),
      soffit: find('roof-soffit').material.color.getHexString(), map: find('roof-top').material.map?.uuid }
    if (!find('roof-soffit').castShadow) throw new Error('Visible roof overhangs must cast shadows from their soffit geometry')
    const highlight = find('roof-underside-highlight')
    if (highlight.geometry !== find('roof-underside').geometry ||
      highlight.material.color.getHexString() !== '3b82f6' ||
      highlight.material.side !== FrontSide || !highlight.material.depthTest ||
      highlight.material.depthWrite || !highlight.material.transparent) {
      throw new Error('Underside selection must highlight its actual panels in blue, visible only from below')
    }
    const painted = replaceRoofMaterialAssignment(baseline, selection, { id: 'underside-regression', materialId: 'dulux-blush-matt', customColor: '#e1dfca' })
    window.updateRegressionAssignments(JSON.parse(JSON.stringify(painted))); await wait()
    const after = { top: find('roof-top').material.color.getHexString(), underside: find('roof-underside').material.color.getHexString(),
      soffit: find('roof-soffit').material.color.getHexString(), map: find('roof-top').material.map?.uuid }
    if (after.underside !== 'e1dfca' || after.top !== before.top || after.soffit !== before.soffit || after.map !== before.map) {
      throw new Error(`Material change leaked from the interior underside: ${JSON.stringify({ before, after })}`)
    }
    const outside = await click([3.4, 8, 6], [3.4, 4, 6])
    if (outside?.type !== 'roof' || outside.roofId !== roofId || outside.part) throw new Error(`Exterior selected underside: ${JSON.stringify(outside)}`)
    let leftoverHighlight = false
    s.scene.traverse(o => { if (o.userData.houseDesignerRole === 'roof-underside-highlight') leftoverHighlight = true })
    if (leftoverHighlight) throw new Error('Underside highlight remained after selecting the exterior')
    window.updateRegressionAssignments(replaceRoofMaterialAssignment(painted, selection, null)); await wait()
    if (find('roof-underside').material.color.getHexString() !== before.underside) throw new Error('Removing underside override did not restore inherited roof finish')
    return { passed: true, selection, outside, before, after }
  } finally {
    window.updateRegressionAssignments(original)
    s.camera.position.copy(camera.position); s.camera.quaternion.copy(camera.quaternion); s.camera.updateMatrixWorld(); s.invalidate()
  }
}
