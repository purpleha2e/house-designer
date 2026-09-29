// Run in roofWallRegression.html?loft-test, with or without &edit-floor.
export async function checkLoftDormerInterior() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const { createDormerStructuralAssembly } = await import('/src/dormerPlacement.ts')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const { prepareDormerInteriors } = await import('/src/dormerInterior.ts')
  const s = window.roofWallScene()
  const owner = window.regressionFloors.find(floor => floor.models.some(model => model.roofAttachment))
  const model = owner?.models.find(model => model.roofAttachment)
  if (!model) throw Error('The fixture needs a dormer')
  const roof = owner.roofs.find(roof => roof.id === model.roofAttachment.roofId)
  const assembly = createDormerStructuralAssembly({
    definition: modelsById.get(model.modelId), hostRoof: roof, ownerId: model.id,
    windowDefinition: modelsById.get(model.dormerWindowModelId),
  })
  const walls = [], ceilings = [], buildingWalls = []
  s.scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'dormer-walls') walls.push(object)
    if (object.userData.houseDesignerRole === 'dormer-ceiling') ceilings.push(object)
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
  for (const x of [-0.35, 0, 0.35]) for (let y = 0.1; y < assembly.wallHeight; y += 0.015) {
    const hits = ray(world(x, y, -assembly.depth), world(x, y, -0.1)).intersectObjects(buildingWalls)
    if (hits.length) throw Error(`Wall still crosses the dormer recess at ${x}, ${y}`)
    samples++
  }
  const roomPlanes = prepareDormerInteriors(window.regressionFloors, modelsById).roomClipPlanes.get(model.id) ?? []
  let cheekSamples = 0
  const halfWidth = modelsById.get(model.modelId).width / 2
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
  if (cheekSamples < 4) throw Error('Insufficient cheek clipping samples')
  return { passed: true, recessRays: samples, cheekSamples, gableClosed: true, ceilingClosed: true }
}
