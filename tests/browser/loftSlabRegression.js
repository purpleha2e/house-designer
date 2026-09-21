import { Raycaster, Vector3 } from 'three'

// Run in roofWallRegression.html?springfield-14&materials after scene preparation.
export function checkLoftSlabRegression() {
  const scene = window.roofWallScene().scene
  scene.updateMatrixWorld(true)
  const meshes = []
  scene.traverse(object => { if (object.isMesh) meshes.push(object) })
  const hits = (role, origin, direction) => new Raycaster(new Vector3(...origin), new Vector3(...direction))
    .intersectObjects(meshes.filter(object => object.userData.houseDesignerRole === role), false)
  const roof = hits('roof-top', [10, 12, 11.7], [0, -1, 0])[0]
  if (!roof || Math.abs(roof.point.y - 5.17859) > 0.005) throw Error('Loft floor cuts through roof tiles')
  if (hits('room-floor-finish', [10, 12, 11.7], [0, -1, 0]).some(hit => hit.point.y > 5)) {
    throw Error('Loft floor finish projects outside the roof')
  }
  if (hits('skirting', [9.1, 12, 11.623], [0, -1, 0]).some(hit => hit.point.y > 5.23)) {
    throw Error('Loft skirting projects through the roof')
  }
  const wallMaterialAt = (y, z) => {
    const hit = hits('wall-engine-render', [3, y, z], [1, 0, 0])[0]
    if (!hit || Math.abs(hit.point.x - 5.359627582) > 0.001) throw Error('Gable facade has a gap')
    return Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material
  }
  for (const z of [10.44, 11.2, 11.4]) for (const y of [5.1, 5.2, 5.22]) {
    const wall = wallMaterialAt(4.9, z), band = wallMaterialAt(y, z)
    if (!wall.map || wall.map !== band.map) throw Error(`Loft floor band loses brick at ${y}, ${z}`)
  }
  return { roofIntact: true, floorFinishClipped: true, skirtingClipped: true, brickBandContinuous: true }
}
