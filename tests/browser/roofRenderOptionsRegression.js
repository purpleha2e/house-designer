// Run in roofWallRegression.html?loft-test&materials.
export async function checkRoofRenderOptions() {
  const { Box3, Vector3 } = await import('three')
  const { isProximityFadedObject } = await import('/src/components/ProximityViewFade.tsx')
  const state = window.roofWallScene()
  const savedCamera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  const wait = () => new Promise(resolve => setTimeout(resolve, 1800))
  const checkbox = text => [...document.querySelectorAll('label')].find(label => label.textContent.trim() === text)?.querySelector('input')
  if (!checkbox('Hide roofs')) {
    [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Render')?.click()
    await wait()
  }
  const fade = 'Fade nearby roofs (1.5 m)'
  const original = Object.fromEntries([fade, 'Hide roofs', 'Roofs only'].map(label => [label, checkbox(label)?.checked]))
  const set = async (label, enabled) => {
    const input = checkbox(label)
    if (!input) throw Error(`Missing ${label} control`)
    if (input.checked !== enabled) { input.click(); await wait() }
  }
  const meshes = predicate => {
    const result = []
    state.scene.traverse(object => { if (object.isMesh && predicate(object)) result.push(object) })
    return result
  }
  const visible = object => {
    for (let current = object; current; current = current.parent) if (!current.visible) return false
    return true
  }
  const role = name => meshes(object => object.userData.houseDesignerRole === name)
  const interiors = () => meshes(object => ['roof-underside', 'dormer-ceiling'].includes(object.userData.houseDesignerRole) ||
    object.userData.houseDesignerRole === 'roof-infill' && object.userData.interior)
  const checkInterior = () => {
    for (const object of interiors()) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (materials.some(material => material.opacity !== 1 || !material.depthWrite) || isProximityFadedObject(object))
        throw Error(`Interior faded or stopped blocking picks: ${object.userData.houseDesignerRole}`)
    }
  }
  const near = async mesh => {
    const center = new Box3().setFromObject(mesh).getCenter(new Vector3())
    state.camera.position.copy(center)
    state.camera.lookAt(center.clone().add(new Vector3(0,-0.1,1)))
    state.camera.updateMatrixWorld(); state.invalidate(); await wait()
  }
  try {
    await set('Roofs only', false); await set('Hide roofs', false); await set(fade, true)
    const roof = role('roof-top')[0]
    if (!roof || !interiors().length) throw Error('Fixture requires roof skins and interior linings')
    await near(roof)
    if (roof.material.opacity >= 0.99 || !isProximityFadedObject(roof)) throw Error('Nearby exterior roof did not fade')
    checkInterior()
    const dormer = role('dormer-roof-top')[0]
    if (!dormer) throw Error('Fixture requires a dormer')
    await near(dormer)
    if (dormer.material.opacity >= 0.99) throw Error('Dormer exterior roof did not fade')
    checkInterior()
    await set(fade, false)
    if (role('roof-top').some(mesh => mesh.material.opacity !== 1) || dormer.material.opacity !== 1) throw Error('Exterior opacity did not restore')
    await set('Hide roofs', true)
    const roofs = meshes(object => /^roof-|^dormer-roof-|^dormer-ceiling$|^dormer-soffit$/.test(object.userData.houseDesignerRole ?? ''))
    if (roofs.some(visible)) throw Error('Hide roofs left a visible roof surface')
    if (!role('dormer-walls').some(visible) || !role('room-floor-finish').some(visible)) throw Error('Hide roofs also hid walls or floors')
    await set('Roofs only', true)
    if (checkbox('Hide roofs').checked || !role('roof-top').some(visible)) throw Error('Roofs only did not restore roofs')
    await set('Hide roofs', true)
    if (checkbox('Roofs only').checked || !role('dormer-walls').some(visible)) throw Error('Hide roofs did not exit roofs-only mode')
    await set('Hide roofs', false)
    if (!role('roof-top').some(visible) || !role('dormer-ceiling').some(visible)) throw Error('Roofs failed to restore')
    return { passed: true, exteriorFade: true, opaqueInteriors: true, hiddenRoofs: true, exclusiveSwitches: true }
  } finally {
    await set('Hide roofs', false); await set('Roofs only', false)
    for (const [label, value] of Object.entries(original)) if (value) await set(label, value)
    state.camera.position.copy(savedCamera.position); state.camera.quaternion.copy(savedCamera.quaternion)
    state.camera.updateMatrixWorld(); state.invalidate()
  }
}
