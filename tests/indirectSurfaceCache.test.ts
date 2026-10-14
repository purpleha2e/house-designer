import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Color, DataUtils, DirectionalLight, Fog, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Scene, ShaderLib, ShaderMaterial, Texture,
  type WebGLRenderer } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { createMaterialVariationShader, defaultMaterialVariation } from '../src/materials/proceduralVariation.ts'
import { applyIndirectSurfaceCapture, applyIndirectSurfaceRadianceCapture, createIndirectSurfaceCache, indirectSurfaceCaptureKey, indirectSurfaceCacheLayout,
  supportsIndirectSurfaceCapture } from '../src/indirectSurfaceCache.ts'

test('surface tiles keep sparse probe indices separate and enforce texture/memory bounds', () => {
  const layout = indirectSurfaceCacheLayout([4, 900, 4095], 16, 4096)!
  const occupied = new Set<string>()
  for (const probe of [4, 900, 4095]) for (let face = 0; face < 6; face++) {
    const [x, y] = layout.tile(probe, face)
    assert.ok(x + 16 <= layout.width && y + 16 <= layout.height)
    occupied.add(`${x}:${y}`)
  }
  assert.equal(occupied.size, 18)
  assert.throws(() => layout.tile(5, 0))
  assert.throws(() => layout.tile(4, 6))
  assert.equal(indirectSurfaceCacheLayout([1, 1], 16, 4096), null)
  assert.equal(indirectSurfaceCacheLayout([1], 16, 16), null)
  assert.equal(indirectSurfaceCacheLayout([1], 16, 4096, 100), null)
})

test('unlit capture retains finish composition and receiver bias without PBR or visibility sampling', () => {
  const field = createIndirectField([], 0), material = new MeshStandardMaterial()
  Object.assign(material, createMaterialVariationShader({ ...defaultMaterialVariation, enabled: true, broadStrength: .1 }))
  const restore = applyIndirectLightingShader(material, createIndirectUniforms(field))
  applyIndirectSurfaceCapture(material)
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0]
  try {
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    assert.match(shader.fragmentShader, /layout\(location = 2\)/)
    assert.match(shader.fragmentShader, /hdSurfaceGeometricN,\s*1\.0, hdSurfaceP/)
    assert.match(shader.fragmentShader, /diffuseColor.rgb \* \(1.0 - metalnessFactor\) \/ PI/)
    assert.match(shader.fragmentShader, /texture2D\(aoMap, vAoMapUv\)/)
    assert.match(shader.fragmentShader, /hdVariationNoise\(hdVariationPosition/)
    assert.doesNotMatch(shader.fragmentShader, /lights_physical|lights_fragment|shadowmap|hdGIDirectVisibility|hdGIVolumeIrradiance|sampler3D/)
    assert.ok(material.customProgramCacheKey().endsWith(':surface-data-v4'))
  } finally { restore(); material.dispose(); field.dispose() }
})

test('surface identity survives lighting changes but invalidates texture, normal, finish-uniform and fog changes', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial(), light = new DirectionalLight()
  const normalMap = new Texture(); material.normalMap = normalMap
  scene.add(new Mesh(geometry, material), light); scene.updateMatrixWorld(true)
  const key = () => indirectSurfaceCaptureKey(scene, {} as WebGLRenderer)
  try {
    const original = key()
    light.position.x = 10; light.intensity = 4; scene.updateMatrixWorld(true)
    material.envMap = new Texture()
    assert.equal(key(), original, 'sun and reflections do not change material data')
    normalMap.repeat.x = 3; assert.notEqual(key(), original)
    const repeat = key(); normalMap.needsUpdate = true; assert.notEqual(key(), repeat)
    const texture = key()
    geometry.attributes.normal.setX(0, .5); geometry.attributes.normal.needsUpdate = true
    assert.notEqual(key(), texture, 'a normal edit with unchanged positions invalidates data')
    Object.assign(material, createMaterialVariationShader({ ...defaultMaterialVariation, enabled: true, broadStrength: .1 }))
    const finish = key()
    Object.assign(material, createMaterialVariationShader({ ...defaultMaterialVariation, enabled: true, broadStrength: .2 }))
    assert.notEqual(key(), finish, 'variation values change without changing the shader program')
    const variation = key(); scene.fog = new Fog(0, 1, 10); assert.notEqual(key(), variation)
  } finally { geometry.dispose(); material.envMap?.dispose(); normalMap.dispose(); material.dispose() }
})

test('combined capture preserves direct PBR lighting and records the same diffuse transport response', () => {
  const field = createIndirectField([], 0), material = new MeshStandardMaterial()
  Object.assign(material, createMaterialVariationShader({ ...defaultMaterialVariation, enabled: true, broadStrength: .1 }))
  const restore = applyIndirectLightingShader(material, createIndirectUniforms(field))
  applyIndirectSurfaceRadianceCapture(material)
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0]
  try {
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    assert.match(shader.fragmentShader, /lights_physical_fragment/)
    assert.match(shader.fragmentShader, /shadowmap_pars_fragment/)
    assert.match(shader.fragmentShader, /opaque_fragment/)
    assert.match(shader.fragmentShader, /layout\(location = 3\)/)
    assert.match(shader.fragmentShader, /#define HD_GI_DIRECT_CAPTURE/)
    assert.match(shader.fragmentShader, /hdSurfaceReceiver = vec4\(hdSurfaceP, hdSurfaceId \+ 1.0\)/)
    assert.match(shader.fragmentShader, /hdVariationNoise\(hdVariationPosition/)
    assert.match(shader.fragmentShader, /diffuseColor.rgb \* \(1.0 - metalnessFactor\) \/ PI/)
    assert.ok(shader.fragmentShader.indexOf('hdSurfaceReceiver =') > shader.fragmentShader.indexOf('#include <fog_fragment>'))
  } finally { restore(); material.dispose(); field.dispose() }
})

test('hardware with fewer than four colour attachments retains ordinary captures', () => {
  const field = createIndirectField([], 0)
  const renderer = { extensions: { has: () => true }, getContext: () => ({
    MAX_DRAW_BUFFERS: 1, getParameter: () => 3, clearBufferfv() {},
  }) } as unknown as WebGLRenderer
  try { assert.equal(createIndirectSurfaceCache(renderer, [0], 4, createIndirectUniforms(field)), null) }
  finally { field.dispose() }
})

test('physical transmission and custom shaders fall back while invisible helpers do not disable the cache', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const custom = new ShaderMaterial(); custom.visible = false
  scene.add(new Mesh(geometry, material), new Mesh(geometry, custom))
  const physical = new MeshPhysicalMaterial({ transmission: .5 })
  try {
    assert.ok(supportsIndirectSurfaceCapture(scene))
    custom.visible = true; assert.equal(supportsIndirectSurfaceCapture(scene), false)
    custom.visible = false; scene.add(new Mesh(geometry, physical))
    assert.equal(supportsIndirectSurfaceCapture(scene), false)
  } finally { geometry.dispose(); material.dispose(); custom.dispose(); physical.dispose() }
})

test('surface integrations own asynchronous buffers and retain targets until cancelled reads finish', async () => {
  const field = createIndirectField([], 0), copies: { pixels: Uint16Array; resolve: () => void }[] = []
  const clears: number[] = []
  const renderer = { extensions: { has: () => true }, capabilities: { maxTextureSize: 4096 },
    info: { render: { calls: 0 } }, getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getContext: () => ({ MAX_DRAW_BUFFERS: 1, COLOR: 2, getParameter: () => 4, clearBufferfv: (_: number, attachment: number) => clears.push(attachment) }),
    setRenderTarget() {}, clear() {}, render() {},
    readRenderTargetPixelsAsync(_target: unknown, _x: number, _y: number, _w: number, _h: number, pixels: Uint16Array) {
      return new Promise<void>(resolve => copies.push({ pixels, resolve }))
    },
  } as unknown as WebGLRenderer
  const cache = createIndirectSurfaceCache(renderer, [10], 4, createIndirectUniforms(field))!
  let released = false
  cache.target.addEventListener('dispose', () => { released = true })
  try {
    cache.beginFace(10, 5)
    assert.deepEqual(clears, [0, 1, 2, 3], 'background radiance and empty surface inputs are cleared independently')
    cache.ready.add(10)
    cache.copyFace(10, 5, new Color(.65, .72, .82), { texture: new Texture() } as Parameters<typeof cache.copyFace>[3])
    assert.deepEqual(clears, [0, 1, 2, 3], 'replacing direct radiance never clears cached geometry attachments')
    assert.ok(cache.ready.has(10))
    const first = cache.read(10, 1), second = cache.read(10, 2)
    assert.notEqual(copies[0].pixels, copies[1].pixels)
    cache.dispose(); assert.equal(released, false)
    copies[1].pixels.fill(DataUtils.toHalfFloat(.5)); copies[1].resolve()
    assert.deepEqual((await second).coefficients[0].toArray(), [.5, .5, .5])
    assert.equal(released, false)
    copies[0].pixels.fill(DataUtils.toHalfFloat(.25)); copies[0].resolve()
    assert.deepEqual((await first).coefficients[0].toArray(), [.25, .25, .25])
    await Promise.resolve(); assert.equal(released, true)
  } finally { cache.dispose(); field.dispose() }
})

test('a shader failure retains cache targets until every outstanding compilation settles', async () => {
  const field = createIndirectField([], 0), pending: { resolve: () => void; reject: (error: Error) => void }[] = []
  const renderer = { extensions: { has: () => true }, capabilities: { maxTextureSize: 4096 },
    getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getContext: () => ({ MAX_DRAW_BUFFERS: 1, getParameter: () => 4, clearBufferfv() {} }),
    setRenderTarget() {}, compileAsync() { return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })) },
  } as unknown as WebGLRenderer
  const cache = createIndirectSurfaceCache(renderer, [0], 4, createIndirectUniforms(field))!
  let released = false
  cache.target.addEventListener('dispose', () => { released = true })
  const compiling = cache.compile()
  const failed = assert.rejects(compiling, /shader unavailable/)
  try {
    pending[0].reject(Error('shader unavailable')); cache.dispose()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(released, false)
    pending.slice(1).forEach(job => job.resolve())
    await failed; await Promise.resolve()
    assert.equal(released, true)
  } finally { cache.dispose(); field.dispose() }
})
