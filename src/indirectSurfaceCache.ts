import { Color, DataUtils, FloatType, HalfFloatType, LinearSRGBColorSpace, Material, Mesh, MeshStandardMaterial, NearestFilter,
  OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderLib, ShaderMaterial, SphericalHarmonics3, Texture, Vector2,
  WebGLCubeRenderTarget, WebGLRenderTarget, type BufferAttribute, type InterleavedBufferAttribute, type Object3D, type WebGLRenderer } from 'three'
import { indirectLightingShaderDeclarations, indirectReceiverShaderDeclarations, type IndirectUniforms } from './indirectLightingShader.ts'
import { createIndirectProbeIntegrator } from './indirectProbeIntegration.ts'

const CACHE_BUDGET = 64 * 1024 * 1024
const BYTES_PER_PIXEL = 8 + 8 + 16 + 16 + 8 + 4 // direct atlas, captured radiance, receiver, normal, response and depth

const attributeKeys = new WeakMap<BufferAttribute | InterleavedBufferAttribute, { version: number; key: string }>()
function attributeKey(attribute: BufferAttribute | InterleavedBufferAttribute) {
  const version = 'data' in attribute ? attribute.data.version : attribute.version
  const previous = attributeKeys.get(attribute)
  if (previous?.version === version) return previous.key
  let hash = 2166136261
  for (let row = 0; row < attribute.count; row++) for (let column = 0; column < attribute.itemSize; column++) {
    hash = Math.imul(hash ^ Math.round(attribute.getComponent(row, column) * 100000), 16777619)
  }
  const key = `${attribute.count}:${attribute.itemSize}:${attribute.normalized}:${hash >>> 0}`
  attributeKeys.set(attribute, { version, key }); return key
}

function surfaceValue(value: unknown): unknown {
  if (value instanceof Texture) return [value.source.uuid, value.source.version, value.version, value.channel,
    value.offset.toArray(), value.repeat.toArray(), value.center.toArray(), value.rotation, value.matrixAutoUpdate,
    value.matrixAutoUpdate ? null : value.matrix.toArray(), value.wrapS, value.wrapT, value.flipY]
  if (Array.isArray(value)) return value.map(surfaceValue)
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>)
  if (value && typeof value === 'object' && 'toArray' in value && typeof value.toArray === 'function') return value.toArray()
  return value
}

/** Unlike the lighting revision, this includes normals, receiver offsets, UVs,
 * finish uniforms and fog. Those inputs may change without moving any vertices.
 * Lights and reflection maps do not affect cached diffuse surface data. */
export function indirectSurfaceCaptureKey(scene: Scene, renderer: WebGLRenderer) {
  const materialKeys = new Map<Material, string>(), objects: string[] = []
  const materialKey = (material: Material) => {
    const previous = materialKeys.get(material)
    if (previous) return previous
    const standard = material instanceof MeshStandardMaterial
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<Material['onBeforeCompile']>[0]
    if (standard) material.onBeforeCompile(shader, renderer)
    const finish = standard ? [material.color.toArray(), material.metalness, material.normalMapType, material.normalScale.toArray(),
      material.bumpScale, material.aoMapIntensity, material.displacementScale, material.displacementBias,
      material.map, material.metalnessMap, material.normalMap, material.bumpMap, material.aoMap, material.displacementMap] : []
    const authored = Object.entries(shader.uniforms).filter(([name]) => !/^hd(GI|RoomLight|PointLightRoomIds|SpotLightRoomIds)/.test(name))
      .map(([name, uniform]) => [name, surfaceValue(uniform.value)])
    const key = JSON.stringify([material.type, material.visible, material.side, material.alphaTest, material.alphaHash,
      material.opacity, surfaceValue((material as Material & { alphaMap?: Texture | null }).alphaMap),
      material.clippingPlanes, material.clipIntersection, material.customProgramCacheKey(),
      finish.map(surfaceValue), authored])
    materialKeys.set(material, key); return key
  }
  scene.traverseVisible(object => {
    const mesh = object as Mesh
    if (!mesh.geometry || !mesh.material) return
    const attributes = Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, attributeKey(attribute)])
    const morphs = Object.entries(mesh.geometry.morphAttributes).map(([name, attributes]) => [name, attributes?.map(attributeKey)])
    const instance = object as Object3D & { instanceMatrix?: BufferAttribute; instanceColor?: BufferAttribute; count?: number }
    objects.push(JSON.stringify([object.type, object.matrixWorld.elements, object.layers.mask, object.renderOrder, object.parent?.renderOrder,
      mesh.geometry.index && attributeKey(mesh.geometry.index), attributes, morphs, mesh.morphTargetInfluences,
      mesh.geometry.morphTargetsRelative, mesh.geometry.groups, mesh.geometry.drawRange,
      instance.instanceMatrix && attributeKey(instance.instanceMatrix), instance.instanceColor && attributeKey(instance.instanceColor), instance.count,
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(materialKey)]))
  })
  return JSON.stringify([scene.fog, objects.sort()])
}

/** A bounded set of six face tiles per probe. Atlas indices need not be dense. */
export function indirectSurfaceCacheLayout(probes: number[], size: number, maxTextureSize: number, budget = CACHE_BUDGET) {
  if (!probes.length || new Set(probes).size !== probes.length || ![4, 8, 16].includes(size)) return null
  const tiles = probes.length * 6, columns = Math.ceil(Math.sqrt(tiles)), rows = Math.ceil(tiles / columns)
  const width = columns * size, height = rows * size, bytes = width * height * BYTES_PER_PIXEL
  if (width > maxTextureSize || height > maxTextureSize || bytes > budget) return null
  const slots = new Map(probes.map((probe, slot) => [probe, slot]))
  return { width, height, columns, bytes, slots, size,
    tile(probe: number, face: number) {
      const slot = slots.get(probe)
      if (slot === undefined || !Number.isInteger(face) || face < 0 || face > 5) throw new Error('Invalid GI surface tile')
      const tile = slot * 6 + face
      return [tile % columns * size, Math.floor(tile / columns) * size] as const
    },
  }
}

/** Capture only shader families whose diffuse response is linear in irradiance.
 * Physical transmission and arbitrary custom shaders retain the ordinary path. */
export function supportsIndirectSurfaceCapture(scene: Object3D) {
  let supported = true
  scene.traverseVisible(object => {
    const renderable = object as Object3D & { material?: Material | Material[] }
    if (!renderable.material) return
    for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) {
      if (!material.visible) continue
      if (!['MeshStandardMaterial', 'MeshBasicMaterial', 'LineBasicMaterial', 'PointsMaterial', 'SpriteMaterial'].includes(material.type) ||
        material.transparent || material.dithering || material.premultipliedAlpha) supported = false
    }
  })
  return supported
}

const surfaceFragment = /* glsl */ `
  #define STANDARD
  uniform vec3 diffuse;
  uniform float opacity, roughness, metalness;
  varying vec3 vViewPosition;
  #include <common>
  #include <color_pars_fragment>
  #include <uv_pars_fragment>
  #include <map_pars_fragment>
  #include <alphamap_pars_fragment>
  #include <alphatest_pars_fragment>
  #include <alphahash_pars_fragment>
  #include <aomap_pars_fragment>
  #include <fog_pars_fragment>
  #include <normal_pars_fragment>
  #include <bumpmap_pars_fragment>
  #include <normalmap_pars_fragment>
  #include <roughnessmap_pars_fragment>
  #include <metalnessmap_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  void main() {
    vec4 diffuseColor = vec4(diffuse, opacity);
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    #include <map_fragment>
    #include <color_fragment>
    #include <alphamap_fragment>
    #include <alphatest_fragment>
    #include <alphahash_fragment>
    #include <roughnessmap_fragment>
    #include <metalnessmap_fragment>
    #include <normal_fragment_begin>
    #include <normal_fragment_maps>
    vec3 hdSurfaceN = normalize(transformNormalByInverseViewMatrix(normal, viewMatrix));
    vec3 hdSurfaceGeometricN = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix));
    vec3 hdSurfaceP; float hdSurfaceFloor;
    // The second bounce always uses the completed floor layer.
    float hdSurfaceId = hdGIReceiver(hdGIWorldPosition, hdGIReceiverWorldOffset, hdSurfaceGeometricN,
      1.0, hdSurfaceP, hdSurfaceFloor);
    gl_FragColor = vec4(hdSurfaceP, hdSurfaceId + 1.0);
    hdSurfaceNormal = vec4(hdSurfaceN, hdSurfaceFloor);
    vec3 hdResponse = diffuseColor.rgb * (1.0 - metalnessFactor) / PI;
    #ifdef USE_AOMAP
      hdResponse *= (texture2D(aoMap, vAoMapUv).r - 1.0) * aoMapIntensity + 1.0;
    #endif
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        hdResponse *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        hdResponse *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    hdSurfaceResponse = vec4(hdResponse, 1.0);
  }
`

/** Unlit geometry data only. Direct PBR radiance is copied separately, so shadow
 * and lamp visibility code never enter the MRT shader. Hooks still supply finish
 * variation, receiver offsets, instancing and texture/normal-map behavior. */
export function applyIndirectSurfaceCapture(material: Material) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey()
  const standard = material instanceof MeshStandardMaterial
  material.customProgramCacheKey = () => key + ':surface-data-v4'
  material.onBeforeCompile = (shader, renderer) => {
    if (standard) shader.fragmentShader = surfaceFragment
    compile.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(indirectLightingShaderDeclarations, indirectReceiverShaderDeclarations)
      .replace('#define HD_INDIRECT_VISIBILITY', '')
    shader.fragmentShader = `
      layout(location = 1) out highp vec4 hdSurfaceNormal;
      layout(location = 2) out highp vec4 hdSurfaceResponse;
      ` + shader.fragmentShader
    // Unlit objects still occlude receivers, but have no indirect response.
    if (!standard) shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, `
      gl_FragColor = vec4(0.0); hdSurfaceNormal = vec4(0.0); hdSurfaceResponse = vec4(0.0);
    }`)
  }
}

/** Keep the ordinary PBR result and record transport inputs in the same draw.
 * The cloned capture material owns this hook; display materials stay unchanged. */
export function applyIndirectSurfaceRadianceCapture(material: Material) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey()
  const standard = material instanceof MeshStandardMaterial
  material.customProgramCacheKey = () => key + ':surface-radiance-v2'
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.fragmentShader = `
      #define HD_GI_DIRECT_CAPTURE
      layout(location = 1) out highp vec4 hdSurfaceReceiver;
      layout(location = 2) out highp vec4 hdSurfaceNormal;
      layout(location = 3) out highp vec4 hdSurfaceResponse;
      ` + shader.fragmentShader
    const response = standard ? /* glsl */ `
      vec3 hdSurfaceN = normalize(transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
      vec3 hdSurfaceGeometricN = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix));
      vec3 hdSurfaceP; float hdSurfaceFloor;
      float hdSurfaceId = hdGIReceiver(hdGIWorldPosition, hdGIReceiverWorldOffset, hdSurfaceGeometricN,
        1.0, hdSurfaceP, hdSurfaceFloor);
      hdSurfaceReceiver = vec4(hdSurfaceP, hdSurfaceId + 1.0);
      hdSurfaceNormal = vec4(hdSurfaceN, hdSurfaceFloor);
      vec3 hdResponse = diffuseColor.rgb * (1.0 - metalnessFactor) / PI;
      #ifdef USE_AOMAP
        hdResponse *= (texture2D(aoMap, vAoMapUv).r - 1.0) * aoMapIntensity + 1.0;
      #endif
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          hdResponse *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        #else
          hdResponse *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
      #endif
      hdSurfaceResponse = vec4(hdResponse, 1.0);
      ` : 'hdSurfaceReceiver = vec4(0.0); hdSurfaceNormal = vec4(0.0); hdSurfaceResponse = vec4(0.0);'
    shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, response + '\n}')
  }
}

/** Geometry/material samples are captured once; pass two evaluates their diffuse
 * transport against the completed first-bounce volume without scene draws. */
export function createIndirectSurfaceCache(renderer: WebGLRenderer, probes: number[], size: number, uniforms: IndirectUniforms) {
  const context = renderer.getContext()
  if (!('clearBufferfv' in context)) return null
  if (!renderer.extensions.has('EXT_color_buffer_float') || context.getParameter(context.MAX_DRAW_BUFFERS) < 4) return null
  const layout = indirectSurfaceCacheLayout(probes, size, renderer.capabilities.maxTextureSize)
  if (!layout) return null
  const target = new WebGLRenderTarget(layout.width, layout.height, { count: 4, type: HalfFloatType,
    format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false })
  target.textures[1].type = FloatType; target.textures[2].type = FloatType
  target.scissorTest = true
  const radiance = new WebGLRenderTarget(layout.width, layout.height, { type: HalfFloatType, depthBuffer: false,
    format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
    colorSpace: LinearSRGBColorSpace })
  radiance.scissorTest = true
  const tile = { value: new Vector2() }, ready = new Set<number>()
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1), geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { hdSurfaceRadiance: { value: radiance.texture },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) }, hdSurfaceSlot: { value: 0 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D hdSurfaceRadiance;
      uniform vec2 hdSurfaceAtlas;
      uniform float hdSurfaceSlot;
      void main() {
        int coefficient = int(gl_FragCoord.x);
        vec3 sum = vec3(0.0); float totalWeight = 0.0;
        for (int face = 0; face < 6; face++) {
          float tileIndex = hdSurfaceSlot * 6.0 + float(face);
          vec2 origin = vec2(mod(tileIndex, ${layout.columns}.0), floor(tileIndex / ${layout.columns}.0)) * ${size}.0;
          for (int y = 0; y < ${size}; y++) for (int x = 0; x < ${size}; x++) {
            float col = -1.0 + (float(x) + .5) * ${2 / size};
            float row = 1.0 - (float(y) + .5) * ${2 / size};
            vec3 p;
            if (face == 0) p = vec3(1.0, row, -col);
            else if (face == 1) p = vec3(-1.0, row, col);
            else if (face == 2) p = vec3(col, 1.0, -row);
            else if (face == 3) p = vec3(col, -1.0, row);
            else if (face == 4) p = vec3(col, row, 1.0);
            else p = vec3(-col, row, -1.0);
            float lengthSquared = dot(p, p), weight = 4.0 / (sqrt(lengthSquared) * lengthSquared);
            vec3 direction = normalize(p);
            float basis = coefficient == 0 ? .2820947918 : .4886025119 *
              (coefficient == 1 ? direction.y : coefficient == 2 ? direction.z : direction.x);
            vec2 uv = (origin + vec2(float(x), float(y)) + .5) / hdSurfaceAtlas;
            sum += texture2D(hdSurfaceRadiance, uv).rgb * basis * weight; totalWeight += weight;
          }
        }
        gl_FragColor = vec4(sum * (12.5663706144 / totalWeight), 1.0);
      }`,
  })
  scene.add(new Mesh(geometry, material))
  // Relight each texel once, then reuse the existing inexpensive SH reduction.
  // Putting volume sampling inside the SH loop duplicates it four times and
  // makes driver compilation of the fixed-size loops excessively expensive.
  const replayScene = new Scene(), replay = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { ...uniforms, hdSurfaceRadiance: { value: radiance.texture }, hdSurfacePositions: { value: target.textures[1] },
      hdSurfaceNormals: { value: target.textures[2] }, hdSurfaceResponses: { value: target.textures[3] },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) }, hdSurfaceOrigin: { value: new Vector2() } },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      #include <common>
      ${indirectLightingShaderDeclarations}
      uniform sampler2D hdSurfaceRadiance, hdSurfacePositions, hdSurfaceNormals, hdSurfaceResponses;
      uniform vec2 hdSurfaceAtlas, hdSurfaceOrigin;
      void main() {
        vec2 uv = (hdSurfaceOrigin + gl_FragCoord.xy) / hdSurfaceAtlas;
        vec3 light = texture2D(hdSurfaceRadiance, uv).rgb;
        vec4 position = texture2D(hdSurfacePositions, uv);
        if (position.a > .5) {
          vec4 normal = texture2D(hdSurfaceNormals, uv); vec3 mean;
          light += texture2D(hdSurfaceResponses, uv).rgb *
            hdGIVolumeIrradiance(position.a - 1.0, position.xyz, normal.xyz, normal.a, mean);
        }
        gl_FragColor = vec4(light, 1.0);
      }`,
  })
  replayScene.add(new Mesh(geometry, replay))
  const copyScene = new Scene(), copy = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { hdSurfaceCube: { value: null }, hdSurfaceTile: tile, hdSurfaceFace: { value: 0 },
      hdSurfaceCaptured: { value: target.textures[0] }, hdSurfaceCombined: { value: 0 },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) } },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform samplerCube hdSurfaceCube;
      uniform sampler2D hdSurfaceCaptured;
      uniform float hdSurfaceCombined;
      uniform vec2 hdSurfaceAtlas;
      uniform vec2 hdSurfaceTile;
      uniform int hdSurfaceFace;
      void main() {
        if (hdSurfaceCombined > .5) {
          gl_FragColor = texture2D(hdSurfaceCaptured, gl_FragCoord.xy / hdSurfaceAtlas);
          return;
        }
        vec2 pixel = gl_FragCoord.xy - hdSurfaceTile;
        float col = -1.0 + pixel.x * ${2 / size};
        float row = 1.0 - pixel.y * ${2 / size};
        vec3 p;
        if (hdSurfaceFace == 0) p = vec3(1.0, row, -col);
        else if (hdSurfaceFace == 1) p = vec3(-1.0, row, col);
        else if (hdSurfaceFace == 2) p = vec3(col, 1.0, -row);
        else if (hdSurfaceFace == 3) p = vec3(col, -1.0, row);
        else if (hdSurfaceFace == 4) p = vec3(col, row, 1.0);
        else p = vec3(-col, row, -1.0);
        gl_FragColor = textureCube(hdSurfaceCube, p);
      }`,
  })
  copyScene.add(new Mesh(geometry, copy))
  const replayTarget = new WebGLCubeRenderTarget(size, { type: HalfFloatType, format: RGBAFormat,
    generateMipmaps: false, colorSpace: LinearSRGBColorSpace, depthBuffer: false })
  const replayIntegrator = createIndirectProbeIntegrator(size)
  const integrated = new WebGLRenderTarget(4, 1, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false })
  const zero = new Float32Array(4), skyPixel = new Float32Array(4), skyColor = new Color()
  let disposed = false, compiled = false, compilation: Promise<unknown> | undefined
  const reads = new Set<Promise<unknown>>()
  const release = () => { target.dispose(); radiance.dispose(); integrated.dispose(); replayTarget.dispose(); replayIntegrator.dispose();
    geometry.dispose(); material.dispose(); replay.dispose(); copy.dispose(); ready.clear() }
  return { target, tile, layout, ready, sky: skyColor,
    get compiled() { return compiled },
    compile() {
      if (compilation) return compilation
      const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
      try {
        renderer.setRenderTarget(integrated)
        const direct = renderer.compileAsync(scene, camera)
        renderer.setRenderTarget(replayTarget)
        const bounce = renderer.compileAsync(replayScene, camera)
        const reduce = replayIntegrator.compile(renderer, replayTarget)
        renderer.setRenderTarget(radiance)
        const copying = renderer.compileAsync(copyScene, camera)
        return compilation = Promise.allSettled([direct, bounce, reduce, copying]).then(results => {
          // A rejected shader must not release targets while another variant is
          // still compiling against them during cancellation/fallback.
          const failure = results.find(result => result.status === 'rejected')
          if (failure?.status === 'rejected') throw failure.reason
          compiled = true
        })
      } finally { renderer.setRenderTarget(previous, face, mip) }
    },
    beginFace(probe: number, face: number, sky = skyColor) {
      const [x, y] = layout.tile(probe, face)
      tile.value.set(x, y); target.viewport.set(x, y, size, size); target.scissor.set(x, y, size, size)
      renderer.setRenderTarget(target)
      renderer.clear(false, true, false)
      skyColor.copy(sky); skyPixel.set([sky.r, sky.g, sky.b, 1])
      context.clearBufferfv(context.COLOR, 0, skyPixel)
      for (let attachment = 1; attachment < 4; attachment++) context.clearBufferfv(context.COLOR, attachment, zero)
    },
    copyFace(probe: number, face: number, sky: Color, cube: WebGLCubeRenderTarget, combined = false) {
      const [x, y] = layout.tile(probe, face), stats = { ...renderer.info.render }, autoClear = renderer.autoClear
      tile.value.set(x, y); radiance.viewport.set(x, y, size, size); radiance.scissor.set(x, y, size, size)
      skyColor.copy(sky); copy.uniforms.hdSurfaceCube.value = cube.texture; copy.uniforms.hdSurfaceFace.value = face
      copy.uniforms.hdSurfaceCombined.value = combined ? 1 : 0
      try { renderer.autoClear = false; renderer.setRenderTarget(radiance); renderer.render(copyScene, camera) }
      finally { renderer.autoClear = autoClear; Object.assign(renderer.info.render, stats) }
    },
    async read(probe: number, bounce: number) {
      const slot = layout.slots.get(probe)
      if (slot === undefined) throw new Error('Missing GI surface probe')
      const pixels = new Uint16Array(16), previous = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), stats = { ...renderer.info.render }
      if (bounce === 2) {
        let result: ReturnType<typeof replayIntegrator.read>
        try {
          for (let cubeFace = 0; cubeFace < 6; cubeFace++) {
            replay.uniforms.hdSurfaceOrigin.value.set(...layout.tile(probe, cubeFace))
            renderer.setRenderTarget(replayTarget, cubeFace); renderer.render(replayScene, camera)
          }
          // Avoid Three's cube-framebuffer-array restoration in async reads.
          renderer.setRenderTarget(null); result = replayIntegrator.read(renderer, replayTarget)
        } finally { renderer.setRenderTarget(previous, face, mip); Object.assign(renderer.info.render, stats) }
        reads.add(result)
        try { return await result } finally { reads.delete(result) }
      }
      material.uniforms.hdSurfaceSlot.value = slot
      try { renderer.setRenderTarget(integrated); renderer.render(scene, camera) }
      finally { renderer.setRenderTarget(previous, face, mip); Object.assign(renderer.info.render, stats) }
      const read = renderer.readRenderTargetPixelsAsync(integrated, 0, 0, 4, 1, pixels)
      reads.add(read)
      try { await read } finally { reads.delete(read) }
      const sh = new SphericalHarmonics3()
      for (let i = 0; i < 4; i++) sh.coefficients[i].set(...Array.from(pixels.slice(i * 4, i * 4 + 3), DataUtils.fromHalfFloat) as [number, number, number])
      return sh
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (reads.size || (compilation && !compiled)) void Promise.allSettled([...reads, ...(compilation ? [compilation] : [])]).then(release)
      else release()
    },
  }
}
