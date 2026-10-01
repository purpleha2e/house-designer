// Run in roofWallRegression.html?springfield-14&materials.
export async function checkExteriorWallShadows({ legacy = false } = {}) {
  const { Raycaster, ShaderChunk, Vector3 } = await import('three')
  const s = window.roofWallScene(), { scene, camera, gl } = s
  const sun = scene.children.find(o => o.userData.houseDesignerRole === 'sun-light')
  const walls = [], meshes = [], originals = []
  scene.traverse(o => {
    if (o.isMesh && o.userData.houseDesignerRole !== 'wall-engine-pick') meshes.push(o)
    if (o.userData.houseDesignerRole === 'wall-engine-render') walls.push([o, o.castShadow])
  })
  const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), sun: sun.position.clone() }
  const pcf = /float getShadow\( sampler2DShadow[\s\S]*?(?=\n\t#elif defined\( SHADOWMAP_TYPE_VSM \))/
  if (legacy) for (const [wall] of walls) for (const material of wall.material) {
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey
    originals.push([material, compile, key])
    material.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer)
      shader.fragmentShader = shader.fragmentShader.replace(pcf, ShaderChunk.shadowmap_pars_fragment.match(pcf)[0])
    }
    material.customProgramCacheKey = () => `${key.call(material)}-legacy-check`
    material.needsUpdate = true
  }
  const render = () => {
    sun.shadow.needsUpdate = true; gl.render(scene, camera)
    const c = gl.getContext(), width = c.drawingBufferWidth, height = c.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    c.readPixels(0, 0, width, height, c.RGBA, c.UNSIGNED_BYTE, pixels)
    return { pixels, width, height }
  }
  const visible = object => {
    for (let o = object; o; o = o.parent) if (!o.visible) return false
    return true
  }
  try {
    camera.position.set(7,4,-2); camera.lookAt(7.5,3.9,1.6); camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    const samples = []
    for (let x = 5.7; x < 9.7; x += 0.06) for (let y = 2.85; y < 4.6; y += 0.06) {
      const point = new Vector3(x, y, 1.5869930114026033)
      const hit = new Raycaster(camera.position, point.clone().sub(camera.position).normalize())
        .intersectObjects(meshes, false).find(h => {
          const m = Array.isArray(h.object.material) ? h.object.material[h.face.materialIndex] : h.object.material
          return visible(h.object) && m.visible && m.colorWrite && m.depthWrite
        })
      if (hit?.object.userData.houseDesignerRole !== 'wall-engine-render' || hit.point.distanceTo(point) > 0.003) continue
      const ndc = point.clone().project(camera)
      if (Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95) samples.push(ndc)
    }
    if (samples.length < 200) throw Error(`Not enough visible facade samples: ${samples.length}`)
    const results = []
    for (const [x,y,z] of [[-20,8,-2],[-20,8,-0.5],[-20,8,-10],[-20,1.5,-2]]) {
      sun.position.set(sun.target.position.x+x,y,sun.target.position.z+z)
      for (const [wall, casting] of walls) wall.castShadow = casting
      const normal = render()
      for (const [wall] of walls) wall.castShadow = false
      const reference = render()
      let affected = 0, maxError = 0
      for (const ndc of samples) {
        const px = Math.floor((ndc.x+1)*normal.width/2), py = Math.floor((ndc.y+1)*normal.height/2)
        const i = (py*normal.width+px)*4
        const error = Math.max(...[0,1,2].map(c => Math.abs(normal.pixels[i+c]-reference.pixels[i+c])))
        if (error > 3) affected++
        maxError = Math.max(maxError,error)
      }
      results.push({direction:[x,y,z],samples:samples.length,affected,maxError})
    }
    if (!legacy && results.some(r => r.affected > r.samples * 0.01)) throw Error(`Exterior shadow acne: ${JSON.stringify(results)}`)
    return {passed: !results.some(r => r.affected > r.samples * 0.01), legacy, results}
  } finally {
    for (const [wall,casting] of walls) wall.castShadow=casting
    for (const [material,compile,key] of originals) {
      material.onBeforeCompile=compile;material.customProgramCacheKey=key;material.needsUpdate=true
    }
    camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.updateMatrixWorld()
    sun.position.copy(saved.sun);sun.shadow.needsUpdate=true;s.invalidate()
  }
}
