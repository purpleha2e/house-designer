// Run after the Red House browser harness and shaders have settled.
export async function checkSunShadowCache() {
  const { scene, camera, gl } = window.roofWallScene()
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  if (!sun?.castShadow) throw Error('Enable daylight and sun shadows for this check')
  const original = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), autoUpdate: sun.shadow.autoUpdate }
  const renderDirect = gl.renderBufferDirect
  let sunCalls = 0, totalCalls = 0
  gl.renderBufferDirect = function(c, s, g, m) {
    const before = gl.info.render.calls, result = renderDirect.apply(this, arguments)
    const delta = gl.info.render.calls - before
    totalCalls += delta
    if (c === sun.shadow.camera && m.isMeshDepthMaterial) sunCalls += delta
    return result
  }
  const render = () => {
    sunCalls = 0; totalCalls = 0
    gl.render(scene, camera)
    const context = gl.getContext(), pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4)
    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, pixels)
    return { sunCalls, totalCalls, pixels }
  }
  const compare = (a, b) => {
    let error = 0
    for (let i = 0; i < a.pixels.length; i++) error += Math.abs(a.pixels[i] - b.pixels[i])
    const mean = error / a.pixels.length
    if (mean > 0.1) throw Error(`Cached shadows differ from a fresh map: ${mean}`)
    return mean
  }
  try {
    sun.shadow.autoUpdate = true
    const uncached = render()
    sun.shadow.autoUpdate = false
    const cached = render(), idle = render()
    if (!uncached.sunCalls || cached.sunCalls || idle.sunCalls) throw Error('Static sun shadow map was not reused')
    const initialPixelError = compare(uncached, cached)
    camera.position.x += 0.2; camera.updateMatrixWorld()
    const movedCamera = render()
    if (movedCamera.sunCalls) throw Error('Camera movement regenerated the sun shadow map')
    sun.shadow.needsUpdate = true
    const cameraFresh = render()
    const cameraPixelError = compare(movedCamera, cameraFresh)
    const mesh = scene.children.find(o => o.userData.houseDesignerRole === 'model-batches')?.children.find(o => o.castShadow)
    if (!mesh) throw Error('Missing instanced shadow caster')
    const wasVisible = mesh.visible
    mesh.visible = false
    const hidden = render()
    sun.shadow.needsUpdate = true
    const hiddenFresh = render()
    mesh.visible = wasVisible
    const restored = render()
    if (!hidden.sunCalls || !restored.sunCalls) throw Error('Caster visibility did not refresh the map')
    const visibilityPixelError = compare(hidden, hiddenFresh)
    const { Matrix4 } = await import('/node_modules/.vite/deps/three.js')
    const matrix = new Matrix4()
    mesh.getMatrixAt(0, matrix)
    const changed = matrix.clone(); changed.elements[12] += 0.1
    mesh.setMatrixAt(0, changed); mesh.instanceMatrix.needsUpdate = true
    const movedInstance = render()
    sun.shadow.needsUpdate = true
    const movedInstanceFresh = render()
    mesh.setMatrixAt(0, matrix); mesh.instanceMatrix.needsUpdate = true
    render()
    if (!movedInstance.sunCalls) throw Error('Instance movement did not refresh the map')
    const instancePixelError = compare(movedInstance, movedInstanceFresh)
    const settled = render()
    if (settled.sunCalls) throw Error('Sun shadows did not settle after editing')
    return { passed: true, uncachedCalls: uncached.totalCalls, cachedCalls: cached.totalCalls,
      savedSunCalls: uncached.sunCalls, cameraShadowCalls: movedCamera.sunCalls,
      initialPixelError, cameraPixelError, visibilityPixelError, instancePixelError }
  } finally {
    gl.renderBufferDirect = renderDirect
    sun.shadow.autoUpdate = original.autoUpdate
    camera.position.copy(original.position); camera.quaternion.copy(original.quaternion); camera.updateMatrixWorld()
  }
}

export async function checkSunDragShadowRefresh() {
  const { scene, gl } = window.roofWallScene()
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  const original = gl.renderBufferDirect, shadowFrames = new Set()
  gl.renderBufferDirect = function(c, s, g, m) {
    if (c === sun.shadow.camera && m.isMeshDepthMaterial) shadowFrames.add(gl.info.render.frame)
    return original.apply(this, arguments)
  }
  try {
    const { captureSunDrag } = await import('./sunDragRegression.js')
    const drag = await captureSunDrag()
    if (!drag.passed || shadowFrames.size < 10) throw Error(JSON.stringify({ drag, shadowFrames: shadowFrames.size }))
    return { passed: true, drag, refreshedFrames: shadowFrames.size }
  } finally { gl.renderBufferDirect = original }
}
