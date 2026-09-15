export async function captureAoShadowCycle() {
  const { _roots } = await import('@react-three/fiber')
  const root = [..._roots.values()][0], state = root.store.getState()
  const { gl, scene } = state
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const control = label => [...document.querySelectorAll('label')]
    .find(element => element.textContent.trim() === label)?.querySelector('input')
  if (!control('Ambient occlusion')) {
    [...document.querySelectorAll('button')].filter(b => b.textContent === 'Render').at(-1).click()
    await wait(200)
  }
  const originalOptions = Object.fromEntries(['Ambient occlusion', 'Lights', 'Light shadows', 'Shadows']
    .map(name => [name, control(name).checked]))
  const set = async (name, value) => {
    if (control(name).checked !== value) control(name).click()
    await wait(350)
  }
  const sun = scene.children.find(object => object.userData.houseDesignerRole === 'sun-light')
  const originalRender = gl.renderBufferDirect
  let sunCalls = 0, calls = 0, frames = 0
  gl.renderBufferDirect = function(camera) {
    const before = gl.info.render.calls
    const result = originalRender.apply(this, arguments)
    const count = gl.info.render.calls - before
    calls += count
    if (camera === sun.shadow.camera) sunCalls += count
    return result
  }
  const sample = async () => {
    await wait(1800)
    sunCalls = 0; calls = 0; frames = 0
    const gaps = []
    let last = performance.now()
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const now = performance.now(); gaps.push(now - last); last = now; frames++
    }
    gaps.sort((a,b) => a-b)
    return { frames, sunCalls, callsPerFrame: Math.round(calls/frames), medianFrameMs: gaps[20],
      programs: gl.info.programs.length, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries }
  }
  try {
    await set('Lights', false); await set('Light shadows', false); await set('Shadows', true)
    await set('Ambient occlusion', false)
    const withoutAo = await sample()
    await set('Ambient occlusion', true)
    const withAo = await sample()
    if (withAo.sunCalls) throw new Error(`AO regenerated static sun shadows: ${withAo.sunCalls}`)
    sunCalls = 0
    sun.shadow.needsUpdate = true
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const requestedShadowCalls = sunCalls
    if (!requestedShadowCalls) throw new Error('AO prevented an explicitly requested shadow update')
    await set('Ambient occlusion', false)
    const afterFirst = await sample()
    await set('Ambient occlusion', true)
    const secondAo = await sample()
    await set('Ambient occlusion', false)
    const afterSecond = await sample()
    for (const key of ['programs', 'textures', 'geometries']) {
      if (afterFirst[key] !== afterSecond[key]) throw new Error(`AO toggles accumulate ${key}: ${afterFirst[key]} -> ${afterSecond[key]}`)
    }
    if (secondAo.sunCalls) throw new Error('AO shadow caching regressed after toggling')
    return { passed: true, withoutAo, withAo, requestedShadowCalls, afterFirst, secondAo, afterSecond }
  } finally {
    gl.renderBufferDirect = originalRender
    for (const [name,value] of Object.entries(originalOptions)) await set(name,value)
  }
}
