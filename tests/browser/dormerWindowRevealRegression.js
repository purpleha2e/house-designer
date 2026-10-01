// Run in roofWallRegression.html?loft-test&materials, optionally &edit-floor.
export async function checkDormerWindowReveals() {
  const { Box3, Matrix4, Vector3 } = await import('three')
  const original = structuredClone(window.regressionFloors)
  const measure = () => {
    const scene = window.roofWallScene().scene
    scene.updateMatrixWorld(true)
    const windows = [], results = []
    scene.traverse(object => {
      if (object.userData.houseDesignerRole === 'dormer-window') windows.push(object)
    })
    if (windows.length !== 2) throw Error('Expected both saved dormer window styles')
    for (const window of windows) {
      let wall
      scene.traverse(object => {
        if (object.userData.houseDesignerRole === 'dormer-walls' && object.userData.modelId === window.userData.modelId) wall = object
      })
      const inverse = wall.matrixWorld.clone().invert(), bounds = new Box3()
      window.traverse(object => {
        if (!object.isMesh) return
        const transform = new Matrix4().multiplyMatrices(inverse, object.matrixWorld)
        const vertices = object.geometry.getAttribute('position')
        for (let i = 0; i < vertices.count; i++) bounds.expandByPoint(new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(transform))
      })
      wall.geometry.computeBoundingBox()
      const depthScale = new Vector3().setFromMatrixColumn(wall.matrixWorld, 2).length()
      const recess = (wall.geometry.boundingBox.max.z - bounds.max.z) * depthScale
      // Normal windows anchor the frame, allowing small imported trim protrusions.
      if (Math.abs(recess - 0.02) > 0.0005) throw Error(`Window ${window.userData.modelId} recess ${recess}, expected 0.02 m`)
      results.push({ modelId: window.userData.modelId, recess })
    }
    return results
  }
  try {
    const normal = measure()
    window.updateRegressionFloors(original.map(floor => ({ ...floor, models: floor.models.map(model =>
      model.roofAttachment ? { ...model, scale: 1.1, depthScale: 1.25 } : model) })))
    await new Promise(resolve => setTimeout(resolve, 3000))
    const scaled = measure()
    return { passed: true, normal, scaled }
  } finally {
    window.updateRegressionFloors(original)
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
}
