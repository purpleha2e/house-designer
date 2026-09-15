export async function captureLightToggleCycle() {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const control = text => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === text)?.querySelector('input')
  if (!control('Lights')) {
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Render').click()
    await wait(150)
  }
  const set = (name, enabled) => { const input = control(name); if (input.checked !== enabled) input.click() }
  const snapshot = async () => {
    await wait(2500)
    const { scene, camera, gl } = window.roofWallScene(), gaps = []
    let last = performance.now()
    for (let i = 0; i < 50; i++) {
      await new Promise(r => requestAnimationFrame(r))
      const now = performance.now(); gaps.push(now - last); last = now
    }
    const before = gl.info.render.calls
    gl.render(scene, camera)
    const calls = gl.info.render.calls - before, lights = [], meshes = [], programs = new Set()
    scene.traverse(o => {
      if (o.isPointLight || o.isSpotLight) lights.push({ visible: o.visible, casts: o.castShadow,
        map: o.shadow.map ? [o.shadow.map.width, o.shadow.map.height] : null })
      if (o.isMesh) {
        meshes.push({ id: o.uuid, culling: o.frustumCulled })
        if (o.visible) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const p = gl.properties.get(m).currentProgram
          if (p) programs.add(p.id)
        }
      }
    })
    gaps.sort((a,b) => a-b)
    return { calls, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries,
      medianFrameMs: Math.round(gaps[25]), p95FrameMs: Math.round(gaps[47]),
      lights, meshes, currentPrograms: [...programs].sort((a,b) => a-b) }
  }
  set('Lights', false); set('Light shadows', false)
  const before = await snapshot()
  set('Lights', true); await wait(100); set('Light shadows', true)
  const enabled = await snapshot()
  set('Light shadows', false)
  const shadowsOff = await snapshot()
  set('Lights', false)
  const after = await snapshot()
  const cullingChanged = after.meshes.filter(m => before.meshes.some(b => b.id === m.id && b.culling !== m.culling))
  const result = { before, enabled, shadowsOff, after, cullingChanged }
  for (const phase of [before, enabled, shadowsOff, after]) delete phase.meshes
  return result
}

export async function checkLightToggleRecovery() {
  const result = await captureLightToggleCycle()
  const { before, enabled, shadowsOff, after, cullingChanged } = result
  const inactiveTargets = phase => phase.lights.filter(l => l.map).length
  result.passed = enabled.lights.some(l => l.visible && l.casts && l.map) &&
    !inactiveTargets(shadowsOff) && !inactiveTargets(after) &&
    after.calls === before.calls && after.textures === before.textures &&
    after.geometries === before.geometries && !cullingChanged.length &&
    JSON.stringify(after.currentPrograms) === JSON.stringify(before.currentPrograms)
  if (!result.passed) throw Error(JSON.stringify(result))
  return result
}
