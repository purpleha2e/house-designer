// Run on roofWallRegression.html?materials&red-house-door.
export async function checkSolidGables() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene()
  state.scene.updateMatrixWorld(true)
  const gables = [], walls = []
  state.scene.traverse(object => {
    if (object.userData.solidGable && object.userData.roofId === 'b490e12e-e2cc-4509-801c-33d0e68a1aa2') gables.push(object)
    if (object.userData.houseDesignerRole === 'wall-engine-render') walls.push(object)
  })
  if (!gables.length || !walls.length) throw new Error('Gable/wall meshes have not loaded')
  const ray = (objects, origin, direction) => new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(objects, false)
  let samples = 0
  for (const y of [5.15, 5.3, 5.5, 5.8]) for (const [origin, direction, x] of [
    [[3, y, 4.7], [-1, 0, 0], 1.35], [[4, y, 4.7], [1, 0, 0], 5.62],
  ]) {
    const hit = ray(gables, origin, direction)[0]
    if (!hit || Math.abs(hit.point.x - x) > 1e-4) throw new Error(`Missing interior gable at ${origin}`)
    if (!hit.object.userData.interior) throw new Error('Room-facing gable has exterior classification')
    const overlappingWall = ray(walls, origin, direction).find(wall => Math.abs(wall.point.x - x) < 1e-4)
    if (overlappingWall) throw new Error('Gable and wall still have overlapping faces')
    samples++
  }
  if (ray(gables, [3, 3.7, 5.2431305714], [-1, 0, 0]).length) throw new Error('Gable blocks the upstairs doorway')
  const outer = ray(gables, [7, 5.7, 4.7], [-1, 0, 0])[0]
  if (!outer || Math.abs(outer.point.x - 5.92) > 1e-4 || outer.object.userData.interior) throw new Error('Exterior gable missing or misclassified')
  // These are the facade, both perpendicular upstairs wall ends, and the
  // low outside corner in the reported scene. Their first surface must be the
  // authored wall, with no roof-owned closure laid over it.
  for (const z of [2.5, 6.4, 6.7658, 7.5]) {
    const origin = [2, 4.5, z], direction = [-1, 0, 0]
    const hit = ray(walls, origin, direction)[0]
    if (!hit || Math.abs(hit.point.x - 1.35) > 1e-4) throw new Error(`Exposed wall end or missing facade at ${z}`)
    if (ray(gables, origin, direction).some(gable => gable.distance <= hit.distance + 1e-4)) throw new Error('Gable overlaps the authored facade')
    samples++
  }
  for (const [x, y] of [[1.3, 2.8], [1.3, 3], [1.34, 2.85]]) {
    const hit = ray(walls, [x, y, 8.5], [0, 0, -1])[0]
    if (!hit || Math.abs(hit.point.z - 7.984318178) > 1e-4) throw new Error(`Missing exterior corner at ${x}, ${y}`)
    samples++
  }
  for (const y of [2.3, 2.35, 2.45, 2.55, 2.65]) for (const z of [1.24, 1.28, 1.32]) {
    const hit = ray(walls, [2,y,z], [-1,0,0])[0]
    if (!hit || Math.abs(hit.point.x - 1.35) > 1e-4) throw new Error(`Hole beside the roof overhang at ${y}, ${z}`)
    samples++
  }
  for (const y of [2.45, 2.55, 2.65]) for (const z of [2.8, 3.3, 4.4, 6.5]) {
    const hit = ray(walls, [7,y,z], [-1,0,0])[0]
    if (!hit || Math.abs(hit.point.x - 5.92) > 1e-4) throw new Error('Missing floor band')
    if (ray(gables, [7,y,z], [-1,0,0]).some(hit => Math.abs(hit.point.x - 5.92) < 1e-4)) throw new Error('Gable overlaps the floor band')
    samples++
  }
  const lower = ray(walls, [7,2.2,2.3], [-1,0,0])[0]
  const triangle = ray(gables, [7,2.8,2.3], [-1,0,0])[0]
  const materialAt = hit => Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material
  if (!lower || !triangle) throw new Error('Missing adjoining wall and gable triangle')
  const wallMaterial = materialAt(lower), gableMaterial = materialAt(triangle)
  if (!wallMaterial.normalScale.equals(gableMaterial.normalScale)) throw new Error('Gable and wall use different normal-map orientations')
  for (const [hit, height] of [[lower, 2.2], [triangle, 2.8]]) {
    if (Math.abs(hit.uv.x - 2.3) > 1e-4 || Math.abs(hit.uv.y - height) > 1e-4) throw new Error('Discontinuous gable texture coordinates')
  }
  return { passed: true, samples, gableMeshes: gables.length }
}
