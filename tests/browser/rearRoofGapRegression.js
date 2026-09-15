// Run on roofWallRegression.html?materials with the saved red_house_3 scene.
export async function checkRearRoofGap() {
  const { Raycaster, Vector3 } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene()
  const roofs = [], walls = []
  state.scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'roof-top' &&
      /^(ded6|cc46)/.test(object.userData.roofId)) roofs.push(object)
    if (object.userData.houseDesignerRole === 'wall-engine-render') walls.push(object)
  })
  let samples = 0
  for (let z = 8; z <= 8.8; z += 0.025) {
    for (let x = -1.92; x <= -1.45; x += 0.01) {
      const hit = new Raycaster(new Vector3(x, 4, z), new Vector3(0, -1, 0))
        .intersectObjects(roofs, false)[0]
      if (!hit || hit.point.y < 2.2 || hit.point.y > 3) throw new Error(`Rear roof gap at ${x},${z}`)
      samples++
    }
  }
  // The new contact subdivides a previously painted brick region.
  const hit = new Raycaster(new Vector3(-1.66, 3.13, 9), new Vector3(0, 0, -1))
    .intersectObjects(walls, false)[0]
  const material = hit && hit.object.material[hit.face.materialIndex]
  if (!material?.map || material.color.getHexString() !== 'ffffff') {
    throw new Error('The rear facade lost its saved brick finish')
  }
  return { passed: true, samples, facadeColor: material.color.getHexString() }
}
