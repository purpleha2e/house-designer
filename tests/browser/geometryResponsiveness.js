// Run after roofWallRegression.html has completed its initial load.
export async function checkGeometryResponsiveness() {
  const logs = () => window.houseDesignerEngineLog.entries
  const startIndex = logs().at(-1)?.index ?? 0
  const started = performance.now(), gaps = []
  let last = started, ticks = 0
  const timer = setInterval(() => {
    const now = performance.now(); gaps.push(now - last); last = now; ticks++
  }, 25)
  const adjust = delta => window.updateRegressionFloors(floors => floors.map(f => ({ ...f,
    roofs: f.roofs?.map((r, i) => i === 0 ? { ...r, pitchDegrees: r.pitchDegrees + delta } : r),
  })))
  try {
    adjust(1)
    await new Promise(resolve => setTimeout(resolve, 200))
    adjust(-1)
    for (let i = 0; i < 8; i++) {
      window.selectRegressionModel(i % 2 ? '__missing__' : null)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const deadline = performance.now() + 15000
    const completed = () => logs().filter(e => e.index > startIndex && e.type === 'wall-roof-clipping-complete')
    while (performance.now() < deadline && completed().length < window.regressionFloors.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const result = {
      elapsedMs: Math.round(performance.now() - started), ticks,
      maxTimerGapMs: Math.round(Math.max(...gaps)), clipping: completed(),
      levelRestarts: logs().filter(e => e.index > startIndex && e.type === 'level-preparation-start').length,
    }
    result.passed = ticks >= 10 && result.maxTimerGapMs < 1000 && result.levelRestarts === 0 &&
      new Set(result.clipping.map(entry => entry.detail.split(':')[0])).size === window.regressionFloors.length
    document.documentElement.dataset.responsiveness = result.passed ? 'passed' : 'failed'
    return result
  } finally { clearInterval(timer); window.selectRegressionModel(null) }
}
