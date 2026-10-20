import { BoxGeometry, CubeUVReflectionMapping, DataTexture, DirectionalLight, HalfFloatType, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PointLight, RGBAFormat, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createIndirectCaptureScene } from '../../src/indirectCaptureScene'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'

Object.assign(window, { captureShaderRegression: (async () => {
  const renderer = new WebGLRenderer(), scene = new Scene(), camera = new PerspectiveCamera()
  document.body.append(renderer.domElement)
  installNonBlockingShaderDiagnostics(renderer)
  renderer.shadowMap.enabled = true
  const field = createIndirectField([]), geometry = new BoxGeometry()
  const maps = Array.from({ length: 6 }, () => { const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); texture.needsUpdate = true; return texture })
  const environment = new DataTexture(new Uint16Array(336 * 256 * 4), 336, 256, RGBAFormat, HalfFloatType)
  environment.mapping = CubeUVReflectionMapping; environment.needsUpdate = true
  const material = new MeshStandardMaterial({ name: 'Sampler stress material', map: maps[0], normalMap: maps[1],
    roughnessMap: maps[2], metalnessMap: maps[3], alphaMap: maps[4], aoMap: maps[5], alphaTest: .1, envMap: environment })
  applyRoomLightShader(material, createRoomLightShaderUniforms(field.mask))
  applyIndirectLightingShader(material, createIndirectUniforms(field))
  const mesh = new Mesh(geometry, material); mesh.receiveShadow = true
  const sun = new DirectionalLight(); sun.castShadow = true
  scene.add(mesh, sun, new PointLight())
  const capture = createIndirectCaptureScene(scene, false), target = new WebGLRenderTarget(1, 1)
  try {
    renderer.setRenderTarget(target)
    await renderer.compileAsync(capture.scene, camera)
    const context = renderer.getContext(), activeSamplers: string[] = []
    for (const program of renderer.info.programs ?? []) {
      const handle = program.program as WebGLProgram
      for (let index = 0; index < context.getProgramParameter(handle, context.ACTIVE_UNIFORMS); index++) {
        const uniform = context.getActiveUniform(handle, index)!
        if ([context.SAMPLER_2D, context.SAMPLER_3D, context.SAMPLER_CUBE, context.SAMPLER_2D_SHADOW].includes(uniform.type)) activeSamplers.push(uniform.name)
      }
    }
    return { maxTextures: renderer.capabilities.maxTextures, activeSamplers }
  } finally {
    capture.dispose(); target.dispose(); material.dispose(); geometry.dispose(); maps.forEach(map => map.dispose()); environment.dispose(); field.dispose(); renderer.dispose()
  }
})() })
