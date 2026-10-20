(async () => {
  const { syncWallOpenings, getWallAngle } = await import('/src/modelPlacement.ts')
  const { modelsById } = await import('/src/models/modelLibrary.ts')
  const s = window.roofWallScene(), floor = window.regressionFloors[0]
  const original = floor.models.find(m => m.wallAttachment && modelsById.get(m.modelId)?.wallMount === 'window')
  if (!original) throw Error('No source window')
  const definition = modelsById.get(original.modelId)
  const wall = floor.walls.filter(w => !(w.openings?.length) && Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) > definition.width + .4)
    .sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y))[0]
  if (!wall) throw Error('No free wall for placement')
  const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y, length = Math.hypot(dx, dz)
  const model = { ...original, id: 'placement-latency-test', position: { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 },
    rotation: -getWallAngle(wall), wallAttachment: { wallId: wall.id, offset: length / 2, side: 1 } }
  s.camera.position.set(model.position.x - dz / length * 1.5, floor.elevation + 1.7, model.position.y + dx / length * 1.5)
  s.camera.lookAt(model.position.x, floor.elevation + 1.5, model.position.y); s.camera.updateMatrixWorld()
  s.setDpr(.6)
  await new Promise(r => setTimeout(r, 500))
  const started = performance.now(), metrics = { mountedMs: null, displayMs: null, geometryMs: null, model: original.modelId }
  const oldWalls = new Set(), candidates = [], wrapped = new Set()
  s.scene.traverse(o => { if (o.userData.houseDesignerRole === 'wall-engine-render' && o.userData.floorId === floor.id) oldWalls.add(o.geometry) })
  const render = s.gl.render.bind(s.gl)
  s.gl.render = (scene, camera) => {
    const group = s.scene.getObjectByName(`model-transform-${model.id}`)
    if (group && !candidates.length) {
      group.updateWorldMatrix(true, true)
      group.traverse(o => { if (o.isMesh && !o.userData.selectionDecoration) candidates.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() }) })
      if (candidates.length) metrics.mountedMs = performance.now() - started
    }
    if (camera === s.camera && candidates.length && metrics.displayMs === null) {
      scene.traverseVisible(o => {
        if (!o.isMesh || wrapped.has(o) || !candidates.some(c => c.geometry === o.geometry && c.matrix.elements.every((v, i) => Math.abs(v - o.matrixWorld.elements[i]) < 1e-5))) return
        wrapped.add(o)
        const after = o.onAfterRender
        o.onAfterRender = function (...args) {
          after.apply(this, args)
          const target = s.gl.getRenderTarget()
          if (o.geometry.drawRange.count >= 0 && (!target || (target.width > 1 && target.height > 1))) {
            if (metrics.displayMs === null) metrics.displayMs = performance.now() - started
            o.onAfterRender = after
          }
        }
      })
    }
    return render(scene, camera)
  }
  window.houseDesignerEngineLog?.clear()
  window.updateRegressionFloors(window.regressionFloors.map(f => f.id === floor.id ? syncWallOpenings({ ...f, models: [...f.models, model] }, modelsById) : f))
  await new Promise(resolve => {
    function frame() {
      const elapsed = performance.now() - started
      if (metrics.geometryMs === null) s.scene.traverse(o => {
        if (o.userData.houseDesignerRole === 'wall-engine-render' && o.userData.floorId === floor.id && !oldWalls.has(o.geometry)) metrics.geometryMs = elapsed
      })
      if (elapsed > 45000 || (metrics.displayMs !== null && elapsed > metrics.displayMs + 1000)) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  s.gl.render = render
  return { ...metrics, warmup: s.scene.userData.shaderWarmupProfile?.slice(-3),
    logs: window.houseDesignerEngineLog?.entries?.filter(e => /preparation|clipping|warmup|model-load/.test(e.type)) }
})()
