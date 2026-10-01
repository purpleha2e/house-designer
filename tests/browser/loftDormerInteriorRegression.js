// Run in roofWallRegression.html?loft-test, with or without &edit-floor.
export async function checkLoftDormerInterior(modelId) {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const { createDormerStructuralAssembly } = await import('/src/dormerPlacement.ts')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { prepareDormerInteriors } = await import('/src/dormerInterior.ts')
  const s = window.roofWallScene()
  const owner = window.regressionFloors.find(floor => floor.models.some(model => model.roofAttachment && (!modelId || model.id === modelId)))
  const model = owner?.models.find(model => model.roofAttachment && (!modelId || model.id === modelId))
  if (!model) throw Error('The fixture needs a dormer')
  const roof = owner.roofs.find(roof => roof.id === model.roofAttachment.roofId)
  const assembly = createDormerStructuralAssembly({
    definition: modelsById.get(model.modelId), hostRoof: roof, ownerId: model.id,
    windowDefinition: modelsById.get(model.dormerWindowModelId),
    width: model.dormerWidth, height: model.dormerHeight,
  })
  const walls = [], ceilings = [], buildingWalls = []
  s.scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'dormer-walls' && object.userData.modelId === model.id) walls.push(object)
    if (object.userData.houseDesignerRole === 'dormer-ceiling' && object.userData.modelId === model.id) ceilings.push(object)
    if (object.userData.houseDesignerRole === 'wall-engine-render') buildingWalls.push(object)
  })
  if (walls.length !== 1 || ceilings.length !== 1) throw Error('Dormer must render once, including in loft edit view')
  s.scene.updateMatrixWorld(true)
  const world = (x, y, z) => walls[0].localToWorld(new Vector3(x, y, z))
  const ray = (start, end) => new Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end))
  const gableY = assembly.wallHeight + assembly.roofRise / 2
  if (!ray(world(0, gableY, -0.3), world(0, gableY, 0.2)).intersectObjects(walls).length) {
    throw Error('Missing dormer front gable')
  }
  for (const x of [-0.4, 0, 0.4]) {
    const slope = assembly.roofRise / assembly.roofHalfWidth
    const top = assembly.wallHeight + assembly.roofRise - Math.abs(x) * slope
    for (const z of [-0.2, -top / slope + 0.05]) {
      if (!ray(world(x, -0.1, z), world(x, top + 0.1, z)).intersectObjects(ceilings).length) {
        throw Error('Dormer ceiling does not reach the main roof')
      }
    }
  }
  let samples = 0
  const prepared = prepareDormerInteriors(window.regressionFloors, modelsById)
  const originY = world(0, 0, 0).y, scaleY = world(0, 1, 0).y - originY
  const floorY = (prepared.baseElevations.get(model.id) - originY) / scaleY
  for (const x of [-0.35, 0, 0.35]) for (let y = Math.max(0.1, floorY + 0.05); y < assembly.wallHeight; y += 0.015) {
    const hits = ray(world(x, y, -assembly.depth), world(x, y, -0.1)).intersectObjects(buildingWalls)
    if (hits.length) throw Error(`Wall still crosses the dormer recess at ${x}, ${y}: ${JSON.stringify({originY,floorY,scaleY,base:prepared.baseElevations.get(model.id),position:model.position,contacts:prepared.wallContacts.get(model.id),hits:hits.slice(0,3).map(hit=>({point:hit.point.toArray(),data:hit.object.userData}))})}`)
    samples++
  }
  const roomPlanes = prepared.roomClipPlanes.get(model.id) ?? []
  let cheekSamples = 0
  const halfWidth = Math.abs(assembly.walls[0].start.x)
  const slope = assembly.roofRise / assembly.roofHalfWidth
  const cheekTop = assembly.wallHeight + assembly.roofRise - halfWidth * slope - roof.thickness
  for (let z = -0.2; z > -assembly.depth; z -= 0.1) {
    const hostUnderside = -z * slope - roof.thickness
    if (hostUnderside > cheekTop - 0.12) continue
    for (const side of [-1, 1]) {
      const x = side * halfWidth
      if (roomPlanes.length && !roomPlanes.some(p => p[0] * x + p[2] * z + p[3] > 0.03)) continue
      const crossing = y => ray(world(0, y, z), world(side * (halfWidth + 0.12), y, z)).intersectObjects(walls)
      if (crossing(hostUnderside - 0.1).length) throw Error('Dormer cheek projects into the loft below its roof')
      if (!crossing(hostUnderside + 0.06).length) throw Error('Missing cheek above the main roof')
      cheekSamples++
    }
  }
  // Low eaves may put every visible cheek outside the knee wall; in that
  // case there are no upper cheek samples on the room side of the wall.
  return { passed: true, recessRays: samples, cheekSamples, gableClosed: true, ceilingClosed: true }
}

// Red House 5 has an external loft eaves wall and no internal knee wall.
export async function checkExternalWallDormer() {
  const { Raycaster, Vector3 } = await import('three')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { prepareDormerInteriors } = await import('/src/dormerInterior.ts')
  const prepared = prepareDormerInteriors(window.regressionFloors, modelsById)
  let wall
  window.roofWallScene().scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'dormer-walls') wall = object
  })
  if (!wall) throw Error('Saved Red House dormer missing')
  const modelId = wall.userData.modelId
  const planes = prepared.roomClipPlanes.get(modelId)
  if (!planes?.length) throw Error('External eaves wall did not close the dormer recess')
  if (prepared.wallContacts.get(modelId)?.length) throw Error('Fixture must use an external wall, not an internal knee wall')
  wall.updateWorldMatrix(true, true)
  const world = (x, y, z) => wall.localToWorld(new Vector3(x,y,z))
  const floorY = prepared.baseElevations.get(modelId) - world(0,0,0).y
  const hit = (a,b) => new Raycaster(a,b.clone().sub(a).normalize(),0,a.distanceTo(b)).intersectObject(wall).length > 0
  wall.geometry.computeBoundingBox()
  const halfWidth = wall.geometry.boundingBox.max.x
  const innerWidth = halfWidth - 0.3
  const rear = -planes[0][3] / planes[0][2]
  const floorMeshes = []
  window.roofWallScene().scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'room-floor-finish') floorMeshes.push(object)
  })
  let floorSamples = 0
  for (const x of [-0.9,-0.45,0,0.45,0.9].map(t => t * innerWidth)) for (const fraction of [0,0.25,0.5,0.75,1]) {
    const z = -0.16 + (rear + 0.16) * fraction
    const start = world(x,floorY+0.3,z), end = world(x,floorY-0.1,z)
    const hit = new Raycaster(start,end.clone().sub(start).normalize(),0,start.distanceTo(end)).intersectObjects(floorMeshes)[0]
    if (!hit || Math.abs(hit.point.y - prepared.baseElevations.get(modelId) - 0.012) > 0.0001)
      throw Error(`Missing finished floor in dormer at ${x}, ${z}`)
    floorSamples++
  }
  let samples = 0
  for (const y of [floorY + 0.03, floorY + 0.1]) {
    for (const x of [-0.8,0,0.8].map(t => t * innerWidth)) {
      if (!hit(world(x,y,-0.3),world(x,y,0.3))) throw Error('Gap below the dormer front apron')
      samples++
    }
    for (const side of [-1,1]) {
      for (const z of [-0.2, rear + 0.02]) {
        if (!hit(world(0,y,z),world(side*(halfWidth+0.05),y,z))) throw Error('Missing lower side return')
        samples++
      }
      if (hit(world(0,y,rear-0.1),world(side*(halfWidth+0.05),y,rear-0.1))) throw Error('Side return projects into the room')
    }
  }
  const visible = object => {
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false
    return true
  }
  const renderedHits = (a,b) => new Raycaster(a,b.clone().sub(a).normalize(),0,a.distanceTo(b))
    .intersectObjects(window.roofWallScene().scene.children, true).filter(hit => {
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material
      return visible(hit.object) && material?.visible && material.colorWrite && material.depthWrite && material.opacity > 0
    })
  let junctionSamples = 0
  for (const side of [-1,1]) for (const offset of [0.075,0.225]) {
    const x = side * (halfWidth - offset), y = floorY + 0.3
    const hits = renderedHits(world(x,y,rear-0.2),world(x,y,rear+0.2))
    const nearest = hits[0]
    if (!nearest) throw Error('Gap at the dormer-to-wall junction')
    if (new Set(hits.filter(hit => Math.abs(hit.distance-nearest.distance)<0.0001).map(hit=>hit.object.uuid)).size !== 1)
      throw Error('Coplanar surfaces at the dormer-to-wall junction')
    junctionSamples++
  }
  for (const x of [-0.8,0,0.8].map(t=>t*innerWidth)) {
    const hits = renderedHits(world(x,floorY+0.2,rear+0.15),world(x,floorY-0.03,rear+0.15))
      .filter(hit => Math.abs(hit.point.y-prepared.baseElevations.get(modelId)-0.012)<0.0001)
    if (new Set(hits.map(hit=>hit.object.uuid)).size !== 1) throw Error('Duplicate threshold over the dormer floor')
  }
  return { ...await checkLoftDormerInterior(modelId), lowerClosureSamples: samples, floorSamples, junctionSamples }
}

export async function checkWideLowDormer() {
  const { createDormerStructuralAssembly } = await import('/src/dormerPlacement.ts')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { prepareDormerInteriors } = await import('/src/dormerInterior.ts')
  const owner = window.regressionFloors.find(floor => floor.models.some(model => model.dormerWidth === 2.25 && model.dormerHeight === 0.6))
  const model = owner?.models.find(model => model.dormerWidth === 2.25 && model.dormerHeight === 0.6)
  if (!model) throw Error('Saved wide/low dormer missing')
  const prepared = prepareDormerInteriors(window.regressionFloors, modelsById)
  const loft = window.regressionFloors.find(floor => floor.id === window.regressionActiveFloorId)
  if (prepared.baseElevations.get(model.id) !== loft.elevation) throw Error('Wide dormer assigned to the wrong floor')
  const contacts = prepared.wallContacts.get(model.id)
  if (!contacts?.length) throw Error('Missed knee wall behind the side valley')
  const assembly = createDormerStructuralAssembly({ definition: modelsById.get(model.modelId),
    hostRoof: owner.roofs.find(roof => roof.id === model.roofAttachment.roofId), ownerId: model.id,
    windowDefinition: modelsById.get(model.dormerWindowModelId), width: model.dormerWidth, height: model.dormerHeight })
  if (assembly.windowWidth < 1.2 || assembly.windowHeight < 0.8) throw Error('Window still shrunk below the eaves')
  const geometry = await checkLoftDormerInterior(model.id)
  return { ...geometry, modelId: model.id, windowWidth: assembly.windowWidth, windowHeight: assembly.windowHeight, loftFloor: loft.name }
}

export async function checkDormerMove() {
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { getMovedDormerPlacement } = await import('/src/dormerPlacement.ts')
  const { getRoofWithExternalWallSupportExtents, getRoofWorldPointFromLocal } = await import('/src/roofBuildingGeometry.ts')
  const original = structuredClone(window.regressionFloors)
  const active = window.regressionActiveFloorId
  const owner = original.find(floor => floor.models.some(model => model.dormerWidth === 2.25))
  const model = owner.models.find(model => model.dormerWidth === 2.25)
  const roof = getRoofWithExternalWallSupportExtents(owner.roofs.find(roof => roof.id === model.roofAttachment.roofId), owner.walls)
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2500))
    for(let i=0;i<100 && !document.body.innerText.includes('Engine idle');i++) await new Promise(resolve=>setTimeout(resolve,200))
  }
  const controls = () => {
    let found
    window.roofWallScene().scene.traverse(object => {
      if (object.isTransformControls && object.object) found = object
    })
    if (!found) throw Error('Selected dormer has no Move handles')
    return found
  }
  const saved = () => window.regressionFloors.flatMap(floor => floor.models).find(candidate => candidate.id === model.id)
  try {
    if (!new URLSearchParams(location.search).has('edit-floor')) window.updateRegressionActiveFloor(owner.id)
    window.selectRegressionModel(model.id)
    await settle()
    let gizmo = controls()
    if (gizmo.showY || gizmo.mode !== 'translate' || gizmo.space !== 'local') throw Error('Dormer must move across its local roof plane')
    const local = { x: model.roofAttachment.localPosition.x - 0.15, y: model.roofAttachment.localPosition.y + 0.3 }
    const world = getRoofWorldPointFromLocal(roof, local)
    const expected = getMovedDormerPlacement(roof, model, modelsById.get(model.modelId), world, modelsById.get(model.dormerWindowModelId))
    if (!expected) throw Error('Test position should be a valid roof move')
    gizmo.dispatchEvent({type:'mouseDown'})
    gizmo.object.position.x = world.x
    gizmo.object.position.z = world.y
    gizmo.dispatchEvent({type:'objectChange'})
    const expectedY = owner.elevation + owner.roomHeight + (roof.heightOffset ?? 0) + expected.surfaceHeight
    if (Math.abs(gizmo.object.position.y - expectedY) > 1e-6) throw Error('Dragging did not follow roof height')
    gizmo.dispatchEvent({type:'mouseUp'})
    await settle()
    if (Math.abs(saved().roofAttachment.localPosition.x-local.x)>1e-6 || Math.abs(saved().roofAttachment.localPosition.y-local.y)>1e-6)
      throw Error('Dragging did not save the new roof attachment')
    if (saved().dormerWidth !== model.dormerWidth || JSON.stringify(saved().materialOverrides)!==JSON.stringify(model.materialOverrides))
      throw Error('Move changed dimensions or materials')
    const moved = structuredClone(saved())
    gizmo = controls()
    const position = gizmo.object.position.clone()
    gizmo.dispatchEvent({type:'mouseDown'})
    gizmo.object.position.x += 100
    gizmo.dispatchEvent({type:'objectChange'})
    if (gizmo.object.position.distanceTo(position)>1e-6) throw Error('Invalid move did not restore the last valid position')
    gizmo.dispatchEvent({type:'mouseUp'})
    await settle()
    if (JSON.stringify(saved().roofAttachment)!==JSON.stringify(moved.roofAttachment)) throw Error('Invalid roof position was saved')
    window.updateRegressionFloors(JSON.parse(JSON.stringify(window.regressionFloors)))
    await settle()
    if (Math.abs(controls().object.position.y-expectedY)>1e-6) throw Error('Moved dormer does not reload at the roof height')
    return { passed:true, roofHeightFollowed:true, attachmentSaved:true, dimensionsPreserved:true, invalidMoveRejected:true, reload:true }
  } finally {
    window.selectRegressionModel(null)
    window.updateRegressionFloors(original)
    window.updateRegressionActiveFloor(active)
    await settle()
  }
}

// Exercise live updates, not just a model loaded with pre-existing openings.
export async function checkLiveDormerWallIntersections() {
  const { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const probeMaterial = new MeshBasicMaterial({ side: DoubleSide })
  const original = structuredClone(window.regressionFloors)
  const owner = original.find(floor => floor.models.some(model => model.roofAttachment))
  const source = owner.models.find(model => model.roofAttachment)
  const loft = original.find(floor => floor.id === window.regressionActiveFloorId)
  const model = { ...structuredClone(source), id: `${source.id}:new` }
  const cos = Math.cos(model.rotation), sin = Math.sin(model.rotation)
  const plan = (x, z) => ({ x: model.position.x + cos * x - sin * z, y: model.position.y + sin * x + cos * z })
  const base = original.map(floor => ({ ...floor,
    models: floor.models.filter(model => !model.roofAttachment),
    walls: floor.id === loft.id ? floor.walls.filter(wall => wall.kind !== 'internal') : floor.walls,
  }))
  const state = () => window.roofWallScene()
  const meshes = role => {
    const found = []; state().scene.traverse(object => { if (object.userData.houseDesignerRole === role) found.push(object) })
    return found
  }
  const update = async floors => {
    window.updateRegressionFloors(floors)
    await new Promise(resolve => setTimeout(resolve, 2500))
    for (let i = 0; i < 100 && !document.body.innerText.includes('Engine idle'); i++) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    state().scene.updateMatrixWorld(true)
  }
  // Probe current geometry independently of asynchronous material slot updates.
  const hit = (objects, start, end) => new Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end))
    .intersectObjects(objects.map(object => {
      const probe = new Mesh(object.geometry, probeMaterial)
      probe.matrixWorld.copy(object.matrixWorld)
      return probe
    })).length > 0
  const apron = () => {
    const wall = meshes('dormer-walls')[0]
    if (!wall) throw Error('New dormer is missing')
    return hit([wall], wall.localToWorld(new Vector3(0, -0.3, -0.3)), wall.localToWorld(new Vector3(0, -0.3, 0.3)))
  }
  const add = (walls, placed = model) => base.map(floor => ({ ...floor,
    models: floor.id === owner.id ? [...floor.models, placed] : floor.models,
    walls: floor.id === loft.id ? [...floor.walls, ...walls] : floor.walls,
  }))
  try {
    await update(base)
    await update(add([]))
    if (apron()) throw Error('A new dormer without a knee wall has a hanging front apron')
    let cases = 1
    for (const z of [-0.45, 0.06]) {
      const knee = { id: 'live-knee', kind: 'internal', start: plan(-1, z), end: plan(1, z), thickness: 0.2, height: loft.roomHeight }
      await update(add([knee]))
      if (!apron()) throw Error('The front apron must reach the floor when an internal wall intersects')
      const dormer = meshes('dormer-walls')[0]
      const start = dormer.localToWorld(new Vector3(0, -0.25, z - 0.2))
      const end = dormer.localToWorld(new Vector3(0, -0.25, z + 0.2))
      if (hit(meshes('wall-engine-render'), start, end)) throw Error(`New dormer failed to carve the internal wall at ${z}`)
      const moved = structuredClone(model)
      moved.roofAttachment.localPosition.y -= 3
      await update(add([knee], moved))
      if (!hit(meshes('wall-engine-render'), start, end)) throw Error(`Moving the dormer did not restore the wall: ${JSON.stringify({z, start: start.toArray(), end: end.toArray(), status: document.body.innerText.slice(-220), meshes: meshes('wall-engine-render').map(o=>({data:o.userData,vertices:o.geometry.attributes.position.count}))})}`)
      if (apron()) throw Error('Moving away from the wall must clip the apron back to the lining')
      cases++
    }
    return { passed: true, liveCases: cases, movedWallsRestored: true }
  } finally {
    await update(original)
    probeMaterial.dispose()
  }
}
