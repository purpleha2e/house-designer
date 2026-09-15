// Run on roofWallRegression.html?materials after loading has settled.
export async function captureSunDrag({ cancel = false } = {}) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const { scene } = window.roofWallScene()
  const pad = document.querySelector('.light-gimbal-pad')
  const light = scene.children.find(o => o.isDirectionalLight)
  if (!pad || !light) throw new Error('Sun control or light is missing')
  const resources = () => {
    const ids = []
    scene.traverse(o => {
      if (o.isMesh) ids.push([o.uuid, o.geometry.uuid,
        ...(Array.isArray(o.material) ? o.material : [o.material]).map(m => m.uuid)])
    })
    return JSON.stringify(ids.sort())
  }
  const before = resources(), saved = { ...window.regressionSunPosition }
  const startCommits = window.regressionSunCommits ?? 0
  const startLog = window.houseDesignerEngineLog.entries.at(-1)?.index ?? 0
  const originalPosition = light.position.toArray()
  // Synthetic pointer events have no browser-owned pointer capture.
  const originals = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].map(k => pad[k])
  let captured = false
  pad.setPointerCapture = () => { captured = true }
  pad.hasPointerCapture = () => captured
  pad.releasePointerCapture = () => { captured = false }
  const rect = pad.getBoundingClientRect(), gaps = []
  const dispatch = (type, angle) => pad.dispatchEvent(new PointerEvent(type, {
    bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 31, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2 + Math.cos(angle) * rect.width * 0.35,
    clientY: rect.top + rect.height / 2 + Math.sin(angle) * rect.height * 0.35,
  }))
  let finalAngle = 0
  try {
    dispatch('pointerdown', saved.azimuth)
    for (let i = 1; i <= 24; i++) {
      const start = performance.now()
      finalAngle = saved.azimuth + i / 24 * Math.PI * 1.5
      dispatch('pointermove', finalAngle)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      gaps.push(performance.now() - start)
    }
    const during = {
      projectCommits: (window.regressionSunCommits ?? 0) - startCommits,
      sameResources: before === resources(),
      lightMoved: JSON.stringify(originalPosition) !== JSON.stringify(light.position.toArray()),
      bakes: window.houseDesignerEngineLog.entries.filter(e => e.index > startLog && e.type === 'floor-lightmap-baked').length,
      maxTwoFrameMs: Math.round(Math.max(...gaps)),
      medianTwoFrameMs: Math.round(gaps.sort((a,b) => a-b)[Math.floor(gaps.length / 2)]),
    }
    dispatch(cancel ? 'pointercancel' : 'pointerup', finalAngle)
    await wait(600)
    const result = { during, commitsAfterRelease: (window.regressionSunCommits ?? 0) - startCommits,
      saved: window.regressionSunPosition, originalSaved: saved, cancel,
      bakesAfterRelease: window.houseDesignerEngineLog.entries.filter(e => e.index > startLog && e.type === 'floor-lightmap-baked').length,
      lightRestored: light.position.toArray().every((value, i) => Math.abs(value - originalPosition[i]) < 1e-8) }
    result.passed = during.projectCommits === 0 && during.sameResources && during.lightMoved && during.bakes === 0 &&
      result.commitsAfterRelease === (cancel ? 0 : 1) &&
      (cancel ? result.lightRestored && JSON.stringify(saved) === JSON.stringify(result.saved) :
        Math.abs(result.saved.azimuth - Math.atan2(Math.sin(finalAngle), Math.cos(finalAngle))) < 1e-6)
    return result
  } finally {
    if (captured) dispatch('pointercancel', finalAngle)
    originals.forEach((value, i) => { pad[['setPointerCapture','hasPointerCapture','releasePointerCapture'][i]] = value })
  }
}
