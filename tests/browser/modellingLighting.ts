import { AmbientLight, Box3, BoxGeometry, DataTexture, DataUtils, DirectionalLight, Group, HemisphereLight, LightProbe, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, Scene, SphereGeometry, SpotLight, Vector3, WebGLRenderer } from 'three'
import { createFastGI, fastGIRoom } from '../../src/fastGI'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms } from '../../src/indirectLightingShader'
import { prepareFastCaptureScene } from '../../src/indirectCaptureScene'
import { isModellingLightingArchitecture } from '../../src/modellingLightingGeometry'
import { snapshotFastGIGeometry } from '../../src/fastGIGeometry'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'

// Deliberately inspect actual WebGL compilation calls, not compileAsync calls:
// asking Three to attach a cached program must not be mistaken for recompilation.
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(800, 500); document.body.append(renderer.domElement)
const gl = renderer.getContext(), nativeCompile = gl.compileShader.bind(gl), nativeLink = gl.linkProgram.bind(gl)
const shaderFailures: { log: string | null; fragment: string | null }[] = []
renderer.debug.onShaderError = (context, program, _vertex, fragment) => {
  shaderFailures.push({ log: context.getProgramInfoLog(program), fragment: context.getShaderSource(fragment) })
}
let shaderCompiles = 0, programLinks = 0
gl.compileShader = shader => { shaderCompiles++; nativeCompile(shader) }
gl.linkProgram = program => { programLinks++; nativeLink(program) }
const scene = new Scene(), materials: MeshStandardMaterial[] = [], meshes: Mesh[] = []
const wall = new MeshStandardMaterial({ color: '#db5140', roughness: 1 }), floor = new MeshStandardMaterial({ color: '#dddddd', roughness: 1 })
materials.push(wall, floor)
function box(x: number, y: number, z: number, w: number, h: number, d: number, material = wall) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true
  mesh.userData.houseDesignerRole = 'wall-engine'
  meshes.push(mesh); scene.add(mesh); return mesh
}
box(4, -.05, 2, 8, .1, 4, floor); box(4, 3.05, 2, 8, .1, 4)
box(-.05, 1.5, 2, .1, 3, 4); box(8.05, 1.5, 2, .1, 3, 4)
box(4, 1.5, -.05, 8, 3, .1); box(4, 1.5, 4.05, 8, 3, .1)
const partition = box(4, 1.5, 2, .1, 3, 4)
const point = new PointLight('white', 50, 16, 2); point.position.set(2, 2, 2); scene.add(point)
const spot = new SpotLight('#9bc5ff', 0, 16, Math.PI / 3, .4, 2)
spot.position.set(6, 2.5, 2); spot.target.position.set(6, 0, 2); scene.add(spot, spot.target)
const field = createIndirectField([]), uniforms = createIndirectUniforms(field)
uniforms.hdGIIndoorFill.value = 0; uniforms.hdFastFeature.value = 1
const production = new URLSearchParams(location.search).has('production'), n = production ? 32 : 16, captureSize = production ? 64 : 32
const textured = new URLSearchParams(location.search).has('textured')
if (textured) {
  // Match the editor's composed lighting hooks and a fully textured finish,
  // not just plain PBR materials. With eight fixed local shadow samplers and
  // the whole-building sun map this reaches the WebGL2 minimum of sixteen.
  const pixel = (rgb: number[]) => { const t = new DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.needsUpdate = true; return t }
  for (const material of materials) {
    material.map = pixel([255,255,255]); material.alphaMap = pixel([255,255,255])
    material.normalMap = pixel([128,128,255]); material.roughnessMap = pixel([255,255,255])
    material.metalnessMap = pixel([0,0,0]); material.aoMap = pixel([255,255,255]); material.emissiveMap = pixel([0,0,0])
    applyRoomLightShader(material, createRoomLightShaderUniforms(material.map, undefined, true))
    applyIndirectLightingShader(material, uniforms)
  }
  const sun = new DirectionalLight('white', 0); sun.castShadow = true
  sun.position.set(8,12,6); sun.target.position.set(4,0,2); sun.userData.houseDesignerRole = 'sun-light'
  scene.add(sun, sun.target)
}
const engine = createFastGI(renderer, scene, uniforms, n, captureSize,
  { stableCaptureLights: true, retainPassPrograms: true, lightSlotsPerKind: 4, architectureOnly: true })
const room = fastGIRoom([{ id: 'floor', elevation: 0, height: 3, rooms: [{ signature: 'right', polygon: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }] }] }], new Vector3(6, 1.5, 2))!
const samples: Record<string, unknown>[] = []

async function capture(name: string, lights: (PointLight | SpotLight)[] = [point, spot],
  volume: typeof room & { additionalAnchors?: Vector3[] } = room) {
  if (!engine) throw Error('WebGL2 float MRT unavailable')
  scene.updateMatrixWorld(true)
  const start = performance.now(), beforeCompiles = shaderCompiles, beforeLinks = programLinks
  const id = engine.request(volume, true, false)
  let captureMeshes = 0
  await engine.prepare(id, async () => {
    const capture = await prepareFastCaptureScene(scene, () => false, isModellingLightingArchitecture)
    captureMeshes = capture?.sourceMeshes ?? 0
    return capture
  }, lights)
  await new Promise<void>((resolve, reject) => {
    const deadline = performance.now() + 60000
    const frame = () => {
      engine.step({ enabled: true, hybrid: true, mode: 'fast', viewsPerFrame: 1, bounces: 3, frameBudgetMs: 2 }, false, 1 / 60)
      if (engine.stats.error) reject(Error(engine.stats.error))
      else if (engine.stats.state === 'ready') resolve()
      else if (performance.now() > deadline) reject(Error(`Capture ${name} timed out: ${engine.stats.state}`))
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const elapsedMs = performance.now() - start
  const target = engine.lighting[engine.bank], data = new Uint16Array(target.width * target.height * 4)
  const readbackStarted = performance.now()
  await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, data)
  const readbackMs = performance.now() - readbackStarted
  // The last GPU timer queries are not ready on the publication frame. Poll
  // after readback completion so reported GPU timings cover all 16 batches.
  for (let i = 0; i < 8 && engine.stats.gpuBatches < 16; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    engine.step({ enabled: true, hybrid: true, mode: 'fast', viewsPerFrame: 1, bounces: 3, frameBudgetMs: 2 }, false, 1 / 60)
  }
  const rgb = [0, 0, 0]
  let rightSideEnergy = 0
  for (let pixel = 0; pixel < n ** 3; pixel++) for (let c = 0; c < 3; c++) {
    const energy = Math.max(0, DataUtils.fromHalfFloat(data[pixel * 4 + c])) / n ** 3
    rgb[c] += energy
    if (pixel % n >= n / 2) rightSideEnergy += energy * 2 / 3
  }
  const sample = { name, rgb, energy: (rgb[0] + rgb[1] + rgb[2]) / 3, elapsedMs, readbackMs,
    rightSideEnergy, captureMeshes, occupancyParts: snapshotFastGIGeometry(scene, volume.bounds, isModellingLightingArchitecture).length,
    shaderCompiles: shaderCompiles - beforeCompiles, programLinks: programLinks - beforeLinks,
    programs: renderer.info.programs?.length, stats: { ...engine.stats }, glError: gl.getError() }
  samples.push(sample); Object.assign(window, { modellingLightingProgress: samples }); return sample
}

try {
  await capture('closed')
  scene.remove(partition); await capture('open')
  // An expensive imported object may receive GI, but must not participate in
  // this architecture-only transport pass, even if a nested mesh claims a wall role.
  const decoy = new Group(); decoy.name = 'model-transform-complex-decoy'
  const green = new MeshStandardMaterial({ color: '#00ff00', emissive: '#00ff00', emissiveIntensity: 20 })
  const decoyGeometry = new SphereGeometry(1.7, 96, 64)
  const decoyMesh = new Mesh(decoyGeometry, green); decoyMesh.position.set(6, 1.5, 2)
  decoyMesh.userData.houseDesignerRole = 'wall-engine'; decoy.add(decoyMesh); scene.add(decoy)
  await capture('model-excluded')
  scene.remove(decoy); decoyGeometry.dispose(); green.dispose()
  // Build view uses an unoccluded visibility fill, including a stronger
  // temporary fill before a legacy room field is ready. None of that display
  // lighting may become an extra energy source for architectural transport.
  const ambient = new AmbientLight('#ffffff', 10)
  const hemisphere = new HemisphereLight('#ffffff', '#ff0000', 10)
  const probe = new LightProbe(); probe.sh.coefficients[0].set(10, 10, 10)
  scene.add(ambient, hemisphere, probe)
  await capture('editor-fill-excluded')
  scene.remove(ambient, hemisphere, probe)
  point.intensity = 0; await capture('off')
  point.intensity = 50; await capture('on')
  spot.intensity = 25; await capture('spot-added')
  spot.intensity = 0; await capture('spot-removed', [point])
  scene.add(partition); await capture('wall-added')
  partition.position.x = 7; await capture('wall-moved')
  scene.remove(partition); await capture('wall-removed')
  const publishedTexture = uniforms.hdFastLight.value
  const publishedMin = uniforms.hdFastMin.value.clone(), publishedSize = uniforms.hdFastSize.value.clone()
  // Rapid edits cancel requests before a replacement field is published.
  // Neither request may choose the currently displayed texture as its output.
  let cancellationSafe = true
  for (let i = 0; i < 3; i++) {
    engine!.request(room, true, false)
    cancellationSafe &&= engine!.lighting[engine!.bank].texture !== publishedTexture &&
      uniforms.hdFastLight.value === publishedTexture && uniforms.hdFastMin.value.equals(publishedMin) && uniforms.hdFastSize.value.equals(publishedSize)
  }
  await capture('cancel-recovered')
  // A mode switch can occur while proxy preparation is awaiting work. Its
  // obsolete rejection must not clear uniforms now owned by the other mode,
  // and returning to modelling must reuse resident transport programs.
  const pauseTexture = uniforms.hdFastLight.value, pauseReady = uniforms.hdFastReady.value
  const pauseMin = uniforms.hdFastMin.value.clone(), pauseSize = uniforms.hdFastSize.value.clone()
  const pausePassCompilations = engine!.stats.passCompilations
  const pausePrograms = renderer.info.programs?.length
  const interrupted = engine!.request(room, true, false)
  let rejectPreparation: (error: Error) => void = () => { throw Error('Preparation did not start') }
  const interruptedPreparation = engine!.prepare(interrupted, () => new Promise<Awaited<ReturnType<typeof prepareFastCaptureScene>>>((_resolve, reject) => {
    rejectPreparation = reject
  }))
  engine!.pause()
  const pausedRevision = engine!.stats.revision
  rejectPreparation(Error('Expected obsolete preparation failure'))
  await interruptedPreparation
  const pauseSafe = pausedRevision > interrupted && engine!.stats.revision === pausedRevision && engine!.stats.state === 'idle' &&
    uniforms.hdFastReady.value === pauseReady && uniforms.hdFastLight.value === pauseTexture &&
    uniforms.hdFastMin.value.equals(pauseMin) && uniforms.hdFastSize.value.equals(pauseSize) &&
    engine!.stats.passCompilations === pausePassCompilations && renderer.info.programs?.length === pausePrograms
  await capture('pause-recovered')
  // More bright lamps in the left room than the renderer can shadow at once.
  // With the partition sealed, the right room must retain bounce from its own
  // weaker lamp, without requiring an extra shader variant or extra samplers.
  partition.position.x = 4; scene.add(partition)
  const storey = { ...room, bounds: new Box3(new Vector3(-.15, -.015, -.15), new Vector3(8.15, 3.015, 4.15)),
    anchor: new Vector3(2, 1.2, 2),
    polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    additionalAnchors: [new Vector3(6, 1.2, 2)] }
  const brightLamps = Array.from({ length: 4 }, () => point.clone())
  const rightLamp = new PointLight('white', 20, 16); rightLamp.position.set(6, 2, 2)
  await capture('storey-no-right-lamp', brightLamps, storey)
  renderer.setPixelRatio(.5)
  await capture('storey-right-lamp', [...brightLamps, rightLamp], storey)
  renderer.setPixelRatio(1)
  // Exercise the final receiver shader once for a visual artifact. All counted
  // compilation regressions above concern the repeatedly updated GPU transport.
  if (!textured) materials.forEach(material => applyIndirectLightingShader(material, uniforms))
  const camera = new PerspectiveCamera(65, 800 / 500, .03, 50)
  camera.position.set(7.6, 1.6, 3.6); camera.lookAt(2, 1.2, 1.7)
  renderer.setRenderTarget(null); if (!textured) renderer.render(scene, camera)
  const samplerTypes = new Set<number>([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.SAMPLER_3D])
  const captureSamplers = (renderer.info.programs ?? []).flatMap(program => {
    if (!gl.getShaderSource(program.fragmentShader)?.includes('#define HD_GI_NATIVE_CAPTURE')) return []
    const samplers = [] as { name: string; size: number }[]
    for (let i=0; i<gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS); i++) {
      const uniform = gl.getActiveUniform(program.program, i)
      if (uniform && samplerTypes.has(uniform.type)) samplers.push({ name: uniform.name, size: uniform.size })
    }
    return [{ count: samplers.reduce((sum, uniform) => sum + uniform.size, 0), samplers }]
  })
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  Object.assign(window, { modellingLightingResult: { n, captureSize, textured, maxTextures: renderer.capabilities.maxTextures, captureSamplers, shaderFailures, samples, cancellationSafe, pauseSafe, shaderCompiles, programLinks, glError: gl.getError(),
    renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) } })
} catch (error) {
  Object.assign(window, { modellingLightingResult: { error: String(error), samples } })
}
