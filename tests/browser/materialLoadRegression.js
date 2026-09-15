// Reload roofWallRegression.html?materials and run without touching render settings.
export async function checkMaterialLoad() {
  const { scene, camera, gl } = window.roofWallScene()
  const original = gl.renderBufferDirect, materials = new Set(), missing = []
  const fields = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'displacementMap']
  gl.renderBufferDirect = function(c, s, g, m, object) {
    const result = original.apply(this, arguments)
    if (!m.isMeshStandardMaterial) return result
    materials.add(m)
    const uniforms = gl.properties.get(m).currentProgram?.getUniforms().map
    for (const field of fields) {
      if (m[field] && !uniforms?.[field]) missing.push({ role: object.userData.houseDesignerRole || object.name, field })
    }
    return result
  }
  const pixels = () => {
    gl.render(scene, camera)
    const context = gl.getContext(), data = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4)
    context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, data)
    return data
  }
  let before
  try { before = pixels() } finally { gl.renderBufferDirect = original }
  if (missing.length) throw Error(`Textures arrived but shaders still omit their maps: ${JSON.stringify(missing)}`)
  const mapped = [...materials].filter(m => m.map)
  if (mapped.length < 3) throw Error('Material assets have not finished loading')
  // A render-setting toggle previously fixed the view by doing this globally.
  // Once loaded correctly, forcing recompilation should not change the image.
  materials.forEach(m => { m.needsUpdate = true })
  const after = pixels()
  let changedChannels = 0
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changedChannels++
  const result = { mappedMaterials: mapped.length, missingShaderMaps: missing.length, changedChannels,
    passed: changedChannels === 0 }
  if (!result.passed) throw Error(JSON.stringify(result))
  return result
}
