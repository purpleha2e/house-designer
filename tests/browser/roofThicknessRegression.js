// Run in bayRoofRegression.html, which exposes the real plan and 3D controls.
export async function checkRoofThicknessControls() {
  const wait = () => new Promise(resolve => setTimeout(resolve, 150))
  const bounds = () => {
    const result = {}
    window.bayScene()?.scene.traverse(object => {
      const role = object.userData.houseDesignerRole
      if (role !== 'roof-top' && role !== 'roof-shell') return
      object.geometry.computeBoundingBox()
      result[role] = { min: object.geometry.boundingBox.min.y, max: object.geometry.boundingBox.max.y }
    })
    return result
  }
  const results = []
  for (const type of ['flat', 'hip', 'lean-to', 'up-and-over', 'bay']) {
    window.loadRoof(type, 0.04)
    await wait()
    const input = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Roof thickness (m)'))?.querySelector('input')
    if (!input) throw new Error(`No thickness control for ${type}`)
    let before = bounds()
    for (let i = 0; i < 40 && !before['roof-top']; i++) { await wait(); before = bounds() }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0.24')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await wait()
    const after = bounds()
    const thickness = window.bayRegression.floor.roofs[0].thickness
    const passed = thickness === 0.24 && Math.abs(after['roof-top'].min - before['roof-top'].min) < 1e-6 &&
      Math.abs(after['roof-top'].min - after['roof-shell'].min - 0.24) < 1e-6
    results.push({ type, thickness, before, after, passed })
  }
  document.documentElement.dataset.thickness = results.every(result => result.passed) ? 'passed' : 'failed'
  return results
}
