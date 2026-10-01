// Run in roofWallRegression.html?loft-test&dormer-materials, optionally &edit-floor.
export async function checkDormerMaterials() {
  const { surfaceMaterialsById, registerRuntimeSurfaceMaterials } = await import('/src/materials/materialCatalog.ts')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { prepareDormerInteriors } = await import('/src/dormerInterior.ts')
  const original = structuredClone(window.regressionFloors)
  const assignments = structuredClone(window.regressionAssignments)
  const catalog = [...surfaceMaterialsById.values()].filter(material => material.id.startsWith('portal-material-'))
  const owner = original.find(floor => floor.models.some(model => model.roofAttachment))
  const model = owner.models.find(model => model.roofAttachment)
  const prepared = prepareDormerInteriors(original, modelsById)
  const contacts = prepared.wallContacts.get(model.id)
  if (!contacts?.length) throw Error('The fixture must have an intersecting internal wall')
  const contact = [...contacts].sort((a, b) => b.overlap - a.overlap)[0]
  const material = (id, baseColor) => ({ id, category: 'paint', manufacturer: 'Regression', productName: id, pbr: { baseColor, roughness: 0.6 } })
  const added = [material('portal-material-dormer-test-ceiling', '#55aaff'), material('portal-material-dormer-test-wall', '#ff5522'), material('portal-material-dormer-test-choice', '#22bb66')]
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2500))
    for (let i = 0; i < 100 && !document.body.innerText.includes('Engine idle'); i++) await new Promise(resolve => setTimeout(resolve, 200))
  }
  const mesh = role => {
    const found = []
    window.roofWallScene().scene.traverse(object => {
      if (object.userData.houseDesignerRole === role && object.userData.modelId === model.id) found.push(object)
    })
    if (found.length !== 1) throw Error(`Expected one ${role}, found ${found.length}`)
    return found[0]
  }
  const expectColor = (material, color, label) => {
    if (material?.color?.getHexString() !== color) throw Error(`${label}: expected ${color}, got ${material?.color?.getHexString()}`)
  }
  const dropdown = () => document.querySelector('select[aria-label="Dormer interior wall material"]')
  const roofAssignment = { id: 'test-ceiling', materialId: added[0].id,
    target: { type: 'roof', floorId: owner.id, roofId: model.roofAttachment.roofId, part: 'underside' } }
  const wallAssignment = { id: 'test-wall', materialId: added[1].id, customColor: '#aa3377',
    target: { type: 'wall-face', wallId: contact.wallId, side: contact.side } }
  try {
    registerRuntimeSurfaceMaterials([...catalog, ...added])
    window.selectRegressionModel(model.id)
    // Clear fixture fragments so the tested room-facing wall assignment supplies the finish.
    window.updateRegressionAssignments([roofAssignment, wallAssignment])
    await settle()
    expectColor(mesh('dormer-ceiling').material, '55aaff', 'Roof underside inheritance')
    expectColor(mesh('dormer-walls').material[1], 'aa3377', 'Wall custom colour inheritance')
    const exterior = mesh('dormer-walls').material[0].color.getHexString()
    if (dropdown()) throw Error('Intersecting walls should inherit automatically')
    if (!document.body.innerText.includes('Matches intersecting wall')) throw Error('Context must explain inheritance')
    window.updateRegressionAssignments([{ ...roofAssignment, customColor: '#eeeecc' }, { ...wallAssignment, customColor: '#8833cc' }])
    await settle()
    expectColor(mesh('dormer-ceiling').material, 'eeeecc', 'Live roof finish update')
    expectColor(mesh('dormer-walls').material[1], '8833cc', 'Live wall finish update')

    const withoutWalls = original.map(floor => ({ ...floor, walls: floor.walls.filter(wall => !contacts.some(c => c.wallId === wall.id)) }))
    window.updateRegressionFloors(withoutWalls)
    await settle()
    if (!dropdown()) throw Error('Missing manual finish dropdown without an intersecting wall')
    dropdown().value = added[2].id
    dropdown().dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expectColor(mesh('dormer-walls').material[1], '22bb66', 'Manual interior choice')
    expectColor(mesh('dormer-walls').material[0], exterior, 'Exterior finish unchanged')
    const saved = JSON.parse(JSON.stringify(window.regressionFloors))
    window.updateRegressionFloors(saved)
    await settle()
    if (dropdown()?.value !== added[2].id) throw Error('Material choice did not survive serialization')
    expectColor(mesh('dormer-walls').material[1], '22bb66', 'Restored choice')
    const rejoined = saved.map(floor => ({ ...floor, walls: original.find(source => source.id === floor.id).walls }))
    window.updateRegressionFloors(rejoined)
    await settle()
    expectColor(mesh('dormer-walls').material[1], '8833cc', 'Rejoining overrides manual choice')
    window.updateRegressionFloors(saved)
    await settle()
    expectColor(mesh('dormer-walls').material[1], '22bb66', 'Leaving restores manual choice')
    dropdown().value = ''
    dropdown().dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expectColor(mesh('dormer-walls').material[1], 'cbd5e1', 'Reset to internal wall default')
    return { passed: true, ceilingInherited: true, wallInherited: true, customColours: true, dropdown: true, liveUpdates: true, savedChoice: true, exteriorUnchanged: true }
  } finally {
    registerRuntimeSurfaceMaterials(catalog)
    window.updateRegressionAssignments(assignments)
    window.updateRegressionFloors(original)
    window.selectRegressionModel(null)
    await settle()
  }
}

export async function checkDormerExterior() {
  const { registerRuntimeSurfaceMaterials, surfaceMaterialsById } = await import('/src/materials/materialCatalog.ts')
  const original = structuredClone(window.regressionFloors)
  const catalog = [...surfaceMaterialsById.values()].filter(material => material.id.startsWith('portal-material-'))
  const owner = original.find(floor => floor.models.some(model => model.roofAttachment))
  const model = owner.models.find(model => model.roofAttachment)
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2500))
    for (let i = 0; i < 100 && !document.body.innerText.includes('Engine idle'); i++) await new Promise(resolve => setTimeout(resolve, 200))
  }
  const wallMesh = () => {
    let found
    window.roofWallScene().scene.traverse(object => {
      if (object.userData.houseDesignerRole === 'dormer-walls' && object.userData.modelId === model.id) found = object
    })
    if (!found) throw Error('Dormer walls missing')
    return found
  }
  const input = label => document.querySelector(`input[aria-label="${label}"]`)
  const setInput = async (label, value) => {
    const element = input(label)
    element.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))
    element.blur()
    await settle()
  }
  try {
    registerRuntimeSurfaceMaterials([...catalog, { id: 'portal-material-dormer-exterior-test', category: 'paint', manufacturer: 'Regression',
      productName: 'Exterior green', pbr: { baseColor: '#447755', roughness: 0.8 } }])
    window.selectRegressionModel(model.id)
    await settle()
    const interior = wallMesh().material[1].color.getHexString()
    const originalWidth = Number(input('Dormer width').value), originalHeight = Number(input('Dormer wall height').value)
    const width = originalWidth + 0.4, height = originalHeight + 0.35
    const before = wallMesh().geometry.getAttribute('position').array.slice()
    await setInput('Dormer width', width)
    await setInput('Dormer wall height', height)
    const changed = window.regressionFloors.flatMap(floor => floor.models).find(candidate => candidate.id === model.id)
    if (Math.abs(changed.dormerWidth * changed.scale * (changed.widthScale ?? 1) - width) > 1e-5 ||
      Math.abs(changed.dormerHeight * changed.scale - height) > 1e-5) throw Error('Dimension inputs did not update the dormer')
    if (JSON.stringify(before) === JSON.stringify(wallMesh().geometry.getAttribute('position').array)) throw Error('Resizing did not rebuild walls')
    const dropdown = document.querySelector('select[aria-label="Dormer exterior wall material"]')
    if (!dropdown) throw Error('Missing exterior material dropdown')
    dropdown.value = 'portal-material-dormer-exterior-test'
    dropdown.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    if (wallMesh().material[0].color.getHexString() !== '447755') throw Error('Exterior material did not update')
    if (wallMesh().material[1].color.getHexString() !== interior) throw Error('Exterior finish changed the interior')
    window.updateRegressionFloors(JSON.parse(JSON.stringify(window.regressionFloors)))
    await settle()
    if (Math.abs(Number(input('Dormer width').value) - width) > 1e-5 || wallMesh().material[0].color.getHexString() !== '447755') throw Error('Saved dimensions or exterior material lost')
    return { passed: true, width, height, geometryResized: true, exteriorDropdown: true, interiorPreserved: true, saved: true }
  } finally {
    registerRuntimeSurfaceMaterials(catalog)
    window.updateRegressionFloors(original)
    window.selectRegressionModel(null)
    await settle()
  }
}
