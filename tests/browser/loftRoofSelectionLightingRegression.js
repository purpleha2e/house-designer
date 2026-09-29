// Run in roofWallRegression.html?loft-test&edit-floor after preparation.
export async function checkLoftRoofSelectionLighting() {
  const s = window.roofWallScene(), canvas = s.gl.domElement
  const original = { floors: window.regressionFloors, active: window.regressionActiveFloorId,
    position: s.camera.position.clone(), quaternion: s.camera.quaternion.clone() }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const lights = () => {
    const result = []
    s.scene.traverse(o => { if (o.isPointLight && o.visible && o.intensity > 0)
      result.push({ id: o.uuid, power: o.power, position: o.position.toArray() }) })
    return result
  }
  const click = async (position, target) => {
    s.camera.position.set(...position); s.camera.lookAt(...target); s.camera.updateMatrixWorld(); s.invalidate()
    await wait(1000)
    const r = canvas.getBoundingClientRect()
    const event = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
    await wait(1200)
    return structuredClone(window.regressionSurface)
  }
  try {
    const owner = original.floors[1], elevation = owner.elevation + owner.roomHeight + owner.slabThickness
    const loft = { ...structuredClone(owner), id: 'selection-lighting-loft', name: 'Loft', elevation,
      roofs: [], rooms: [], ceilingMode: 'open',
      walls: owner.walls.map(wall => ({ ...wall, id: `loft-${wall.id}` })),
      models: [{ id: 'loft-light', modelId: 'point-light', position: { x: 4, y: 6 }, height: 0.6,
        rotation: 0, scale: 1, lightPower: 120, lightEnabled: true }] }
    window.updateRegressionFloors([...original.floors, loft]); window.updateRegressionActiveFloor(loft.id)
    await wait(6000)
    if (![...document.querySelectorAll('label')].some(l => l.textContent.includes('Fade nearby roofs'))) {
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Render')?.click()
      await wait(200)
    }
    const fade = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Fade nearby roofs'))?.querySelector('input')
    const wasFaded = fade?.checked
    if (wasFaded) fade.click()
    try {
      const before = lights()
      if (before.length !== 1) throw Error(`Expected one active loft light: ${JSON.stringify(before)}`)
      const selection = await click([3.4, elevation + 0.35, 6], [3.4, elevation + 1.2, 6])
      if (selection?.type !== 'roof' || selection.part !== 'underside' || selection.floorId !== owner.id)
        throw Error(`Wrong roof material target: ${JSON.stringify(selection)}`)
      if (window.regressionActiveFloorId !== loft.id) throw Error('Roof underside selection switched away from the loft')
      if (JSON.stringify(lights()) !== JSON.stringify(before)) throw Error('Selecting the roof changed the loft lights')
      const floorSelection = await click([4, elevation + 0.6, 7], [4, elevation, 7])
      if (floorSelection?.type !== 'room-floor' || floorSelection.floorId !== loft.id)
        throw Error(`Wrong floor selection: ${JSON.stringify(floorSelection)}`)
      if (JSON.stringify(lights()) !== JSON.stringify(before)) throw Error('Floor selection changed the loft lights')
      return { passed: true, editingFloor: loft.id, roofOwner: selection.floorId, lightsBefore: before, lightsAfter: lights() }
    } finally {
      if (fade && fade.checked !== wasFaded) fade.click()
    }
  } finally {
    window.updateRegressionFloors(original.floors); window.updateRegressionActiveFloor(original.active)
    s.camera.position.copy(original.position); s.camera.quaternion.copy(original.quaternion)
    s.camera.updateMatrixWorld(); s.invalidate()
  }
}
