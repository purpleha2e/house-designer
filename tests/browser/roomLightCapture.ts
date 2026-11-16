import { BoxGeometry, DataTexture, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, Scene, SpotLight, WebGLRenderer } from 'three'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { createIndirectCaptureScene } from '../../src/indirectCaptureScene'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'

const renderer = new WebGLRenderer()
renderer.setSize(32, 32)
document.body.append(renderer.domElement)
installNonBlockingShaderDiagnostics(renderer)
const field = createIndirectField([]), mask = new DataTexture()
const indirect = createIndirectUniforms(field)
const camera = new PerspectiveCamera(); camera.position.z = 4
const results: {lights: string; atlasOnly: boolean; capture: boolean; displayAtlasActive: boolean}[] = []
for (const atlasOnly of [false,true]) for (const lights of ['none', 'point', 'spot', 'both']) {
  const room = createRoomLightShaderUniforms(mask, undefined, atlasOnly)
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry()
  applyRoomLightShader(material, room); applyIndirectLightingShader(material, indirect)
  scene.add(new Mesh(geometry, material))
  if (lights === 'point' || lights === 'both') scene.add(new PointLight())
  if (lights === 'spot' || lights === 'both') scene.add(new SpotLight())
  const capture = createIndirectCaptureScene(scene, false)
  for (const capturing of [false, true]) {
    const before = new Set(renderer.info.programs)
    await renderer.compileAsync(capturing ? capture.scene : scene, camera)
    const gl = renderer.getContext()
    const programs = renderer.info.programs!.filter(p => !before.has(p))
    const names = programs.flatMap(p => Array.from({length: gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS)},
      (_, index) => gl.getActiveUniform(p.program, index)?.name))
    results.push({lights, atlasOnly, capture: capturing, displayAtlasActive: names.includes('hdLocalShadowAtlas')})
  }
  capture.dispose(); material.dispose(); geometry.dispose()
}
Object.assign(window, {roomCaptureResults: results})
mask.dispose(); field.dispose(); renderer.dispose()
