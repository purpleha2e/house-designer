export async function checkModelBatching() {
  const { Matrix4 } = await import('/node_modules/.vite/deps/three.js')
  const { scene, camera, gl } = window.roofWallScene()
  const batches = [], sources = [], roots = []
  scene.traverse(o => {
    if (o.userData.houseDesignerRole === 'model-batch') batches.push(o)
    if (o.userData.houseDesignerBatchModelId) roots.push(o)
  })
  let maxTransformError = 0
  for (const batch of batches) {
    batch.userData.modelIds.forEach((id, index) => {
      const root = roots.find(o => o.userData.houseDesignerBatchModelId === id)
      let source
      root.traverse(o => {
        if (o.isMesh && !o.visible && o.geometry === batch.geometry && o.material === batch.material &&
          Math.sign(o.matrixWorld.determinant()) === batch.scale.x) source = o
      })
      if (!source) throw Error(`Missing source for ${batch.name}/${id}`)
      const matrix = new Matrix4()
      batch.getMatrixAt(index, matrix)
      matrix.premultiply(batch.matrixWorld)
      source.matrixWorld.elements.forEach((v, i) => { maxTransformError = Math.max(maxTransformError, Math.abs(v - matrix.elements[i])) })
      sources.push(source)
    })
  }
  if (maxTransformError > 0.00001) throw Error(`Model placement changed by ${maxTransformError}`)
  const render = () => {
    const calls = { main: 0, shadow: 0 }, original = gl.renderBufferDirect
    gl.renderBufferDirect = function(c, s, g, m) {
      const before = gl.info.render.calls, result = original.apply(this, arguments)
      calls[m.isMeshDepthMaterial || m.isMeshDistanceMaterial ? 'shadow' : 'main'] += gl.info.render.calls - before
      return result
    }
    try { gl.render(scene, camera) } finally { gl.renderBufferDirect = original }
    const context = gl.getContext(), pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4)
    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, pixels)
    return { calls, total: calls.main + calls.shadow, pixels }
  }
  let before, after
  try {
    sources.forEach(o => { o.visible = true })
    batches.forEach(o => { o.visible = false })
    before = render()
  } finally {
    sources.forEach(o => { o.visible = false })
    batches.forEach(o => { o.visible = true })
  }
  after = render()
  let absoluteError = 0, materiallyChangedPixels = 0
  for (let i = 0; i < before.pixels.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 3; c++) { const error = Math.abs(before.pixels[i+c] - after.pixels[i+c]); absoluteError += error; delta = Math.max(delta, error) }
    if (delta > 8) materiallyChangedPixels++
  }
  const result = { before: { calls: before.calls, total: before.total }, after: { calls: after.calls, total: after.total },
    batchCount: batches.length, sourceMeshCount: sources.length, maxTransformError,
    meanChannelError: absoluteError / (before.pixels.length / 4 * 3), materiallyChangedPixelFraction: materiallyChangedPixels / (before.pixels.length / 4) }
  result.passed = sources.length > batches.length && after.total < before.total && result.meanChannelError < 0.5 && result.materiallyChangedPixelFraction < 0.005
  if (!result.passed) throw Error(JSON.stringify(result))
  return result
}

export async function checkBatchedModelPicking() {
  const { Vector3, Box3 } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene(), camera = state.camera, canvas = state.gl.domElement
  const originalCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
  const wait = () => new Promise(r => setTimeout(r, 350))
  const roots = []
  state.scene.traverse(o => { if (o.userData.houseDesignerBatchModelId) roots.push(o) })
  const picked = []
  try {
    for (const type of ['doorBase_geo', 'left_frame']) {
      const matches = roots.filter(root => { let found = false; root.traverse(o => { if (o.name === type && !o.visible) found = true }); return found }).slice(0, 2)
      if (matches.length !== 2) throw Error(`Need two batched ${type} models`)
      for (const root of matches) {
        const target = root.getObjectByName(type)
        const point = new Box3().setFromObject(target).getCenter(new Vector3())
        const direction = new Vector3(0, 0, 1).transformDirection(root.matrixWorld)
        camera.position.copy(point).addScaledVector(direction, 0.35)
        camera.lookAt(point); camera.updateMatrixWorld(); state.invalidate(); await wait()
        window.selectRegressionModel(null); await wait()
        const rect = canvas.getBoundingClientRect(), event = { bubbles: true, button: 0, pointerId: 17, pointerType: 'mouse',
          clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...event, buttons: 1 }))
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0 }))
        await wait()
        const id = root.userData.houseDesignerBatchModelId
        if (window.regressionSelectedModelId !== id) throw Error(`Picked ${window.regressionSelectedModelId}, expected ${id} (${type})`)
        picked.push(id)
      }
    }
    return { passed: true, independentlyPicked: picked }
  } finally {
    window.selectRegressionModel(null)
    camera.position.copy(originalCamera.position); camera.quaternion.copy(originalCamera.quaternion); camera.updateMatrixWorld(); state.invalidate()
  }
}

export async function checkBatchedModelEdits() {
  const original = window.regressionFloors
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const roots = []
  window.roofWallScene().scene.traverse(o => {
    if (o.userData.houseDesignerBatchModelId && o.getObjectByName('doorBase_geo')) roots.push(o)
  })
  const ids = roots.slice(0, 2).map(o => o.userData.houseDesignerBatchModelId)
  if (ids.length !== 2) throw Error('Need two doors for mirror/resize regression')
  try {
    window.updateRegressionFloors(floors => floors.map(floor => ({ ...floor,
      models: floor.models?.map(model => ids.includes(model.id) ? { ...model,
        mirrored: true, flipped: true, widthScale: 1.15,
        wallAttachment: model.wallAttachment ? { ...model.wallAttachment, offset: model.wallAttachment.offset + 0.1 } : undefined,
      } : model),
    })))
    await wait(5000)
    const appearance = await checkModelBatching()
    const mirrored = []
    window.roofWallScene().scene.traverse(o => {
      if (o.userData.houseDesignerRole === 'model-batch' && o.scale.x < 0) mirrored.push(...o.userData.modelIds)
    })
    if (!ids.every(id => mirrored.includes(id))) throw Error('Mirrored doors did not batch')
    const picking = await checkBatchedModelPicking()
    window.updateRegressionFloors(floors => floors.map(floor => ({ ...floor,
      models: floor.models?.filter(model => model.id !== ids[0]),
    })))
    await wait(3500)
    const removed = await checkModelBatching()
    let stale = false
    window.roofWallScene().scene.traverse(o => {
      if (o.userData.houseDesignerRole === 'model-batch' && o.userData.modelIds.includes(ids[0])) stale = true
    })
    if (stale) throw Error('Removed model remains in a render batch')
    return { passed: true, appearance, picking, removed }
  } finally { window.updateRegressionFloors(original) }
}
