import { BoxGeometry, CubeUVReflectionMapping, DataTexture, DirectionalLight, HalfFloatType, Mesh,
  FloatType, MeshStandardMaterial, PerspectiveCamera, PointLight, RGBAFormat, Scene, SpotLight, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createIndirectCaptureScene } from '../../src/indirectCaptureScene'
import { createIndirectField, INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, writeIndirectPosition } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'

Object.assign(window, { captureShaderRegression: (async () => {
  const renderer = new WebGLRenderer(), scene = new Scene(), camera = new PerspectiveCamera()
  document.body.append(renderer.domElement)
  installNonBlockingShaderDiagnostics(renderer)
  renderer.shadowMap.enabled = true
  const field = createIndirectField([]), geometry = new BoxGeometry()
  // Tiny unobstructed lamp atlas, including light indices beyond the display pool.
  field.distanceColumns = field.distanceRows = 6; field.distanceSize = 1
  field.distances.image = { data: new Float32Array(36), width: 6, height: 6 }
  const offset = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS
  for (let i=0;i<34;i++) writeIndirectPosition(field.positionData,offset+i,new Vector3(0,0,2))
  field.positions.needsUpdate = true; field.distances.needsUpdate = true
  const maps = Array.from({ length: 6 }, () => { const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); texture.needsUpdate = true; return texture })
  const environment = new DataTexture(new Uint16Array(336 * 256 * 4), 336, 256, RGBAFormat, HalfFloatType)
  environment.mapping = CubeUVReflectionMapping; environment.needsUpdate = true
  const material = new MeshStandardMaterial({ name: 'Sampler stress material', map: maps[0], normalMap: maps[1],
    roughnessMap: maps[2], metalnessMap: maps[3], alphaMap: maps[4], aoMap: maps[5], alphaTest: .1, envMap: environment })
  applyRoomLightShader(material, createRoomLightShaderUniforms(field.mask))
  const indirect = createIndirectUniforms(field)
  indirect.hdFastFeature.value = new URLSearchParams(location.search).has('fast') ? 1 : 0
  const blocker = new DataTexture(new Float32Array([
    0,0,1,1, -2,-2,1,0, 2,-2,1,0, 2,2,1,0,
    -2,-2,1,0, 2,2,1,0, -2,2,1,0,
  ]),7,1,RGBAFormat,FloatType)
  blocker.needsUpdate=true
  indirect.hdGITriangles.value=blocker;indirect.hdGITriangleSize.value.set(7,1)
  indirect.hdGICapture.value = 1
  indirect.hdGIPointIndices.value[16] = offset + 16
  indirect.hdGISpotIndices.value[16] = offset + 33
  applyIndirectLightingShader(material, indirect)
  const mesh = new Mesh(geometry, material); mesh.receiveShadow = true
  const sun = new DirectionalLight(0xffffff,0); sun.castShadow = true
  scene.add(mesh, sun)
  for(let i=0;i<17;i++) {
    const point=new PointLight(0xffffff,0); point.name=`capture-point-${i}`;point.position.set(0,0,2);scene.add(point)
    const spot=new SpotLight(0xffffff,0); spot.name=`capture-spot-${i}`;spot.position.set(0,0,2);scene.add(spot,spot.target)
  }
  camera.position.set(0,0,4); camera.lookAt(0,0,0); camera.updateMatrixWorld()
  const capture = createIndirectCaptureScene(scene, false), target = new WebGLRenderTarget(1, 1)
  try {
    renderer.setRenderTarget(target)
    const display = new URLSearchParams(location.search).has('display')
    await renderer.compileAsync(display ? scene : capture.scene, camera)
    const context = renderer.getContext(), activeSamplers: string[] = []
    for (const program of renderer.info.programs ?? []) {
      const handle = program.program as WebGLProgram
      for (let index = 0; index < context.getProgramParameter(handle, context.ACTIVE_UNIFORMS); index++) {
        const uniform = context.getActiveUniform(handle, index)!
        if ([context.SAMPLER_2D, context.SAMPLER_3D, context.SAMPLER_CUBE, context.SAMPLER_2D_SHADOW].includes(uniform.type)) activeSamplers.push(uniform.name)
      }
    }
    if (display) return { maxTextures: renderer.capabilities.maxTextures, activeSamplers }
    const point=capture.scene.getObjectByName('capture-point-16') as PointLight
    const spot=capture.scene.getObjectByName('capture-spot-16') as SpotLight
    const pixel=new Uint8Array(4)
    const sample=async()=>{renderer.render(capture.scene,camera);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,pixel);return [...pixel.slice(0,3)]}
    const off=await sample(); point.intensity=100;const point17=await sample();point.intensity=0;spot.intensity=100;const spot17=await sample()
    field.distances.image.data[16]=field.distances.image.data[33]=1;field.distances.needsUpdate=true
    const blockedSpot17=await sample();spot.intensity=0;point.intensity=100;const blockedPoint17=await sample()
    return { maxTextures: renderer.capabilities.maxTextures, activeSamplers, off, point17, spot17, blockedPoint17, blockedSpot17 }
  } finally {
    capture.dispose(); target.dispose(); material.dispose(); geometry.dispose(); maps.forEach(map => map.dispose()); environment.dispose(); blocker.dispose();field.dispose(); renderer.dispose()
  }
})() })
