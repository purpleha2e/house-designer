import { AlwaysDepth, Color, DataUtils, DepthTexture, FloatType, HalfFloatType, LinearSRGBColorSpace, Material, Mesh, MeshStandardMaterial, NearestFilter,
  OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderLib, ShaderMaterial, SphericalHarmonics3, Texture, Vector2,
  WebGLCubeRenderTarget, WebGLRenderTarget, type BufferAttribute, type InterleavedBufferAttribute, type Object3D, type WebGLRenderer } from 'three'
import { indirectShaderDefines, indirectLightingShaderDeclarations, indirectReceiverShaderDeclarations, indirectVolumeShaderDeclarations, type IndirectUniforms } from './indirectLightingShader.ts'
import { indirectSHCoefficientCount, indirectSHIntegrationGLSL } from './indirectSH.ts'
import { createIndirectProbeIntegrator } from './indirectProbeIntegration.ts'
import { createIndirectSurfaceRelighting, type SurfaceLight } from './indirectSurfaceRelighting.ts'
import { runViewportTask } from './viewportScheduling.ts'
import { daylightSkyGLSL } from './daylightSky.ts'
import { lightingDiagnosticGLSL } from './lightingDiagnostics.ts'

const CACHE_BUDGET = 64 * 1024 * 1024
const BYTES_PER_PIXEL = 8 + 8 + 8 + 16 + 16 + 8 + 4 // direct atlas, captured radiance, batched replay, receiver, normal, response and depth

const attributeKeys = new WeakMap<BufferAttribute | InterleavedBufferAttribute, { version: number; key: string }>()
function* attributeKey(attribute: BufferAttribute | InterleavedBufferAttribute): Generator<void, string> {
  const version = 'data' in attribute ? attribute.data.version : attribute.version
  const previous = attributeKeys.get(attribute)
  if (previous?.version === version) return previous.key
  let hash = 2166136261
  for (let row = 0; row < attribute.count; row++) {
    if (row % 1024 === 0) yield
    for (let column = 0; column < attribute.itemSize; column++)
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
function* surfaceCaptureKeySteps(scene: Scene, renderer: WebGLRenderer): Generator<void, string> {
  const materialKeys = new Map<Material, string>(), objects: string[] = []
  const materialKey = (material: Material) => {
    const previous = materialKeys.get(material)
    if (previous) return previous
    const standard = material instanceof MeshStandardMaterial
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<Material['onBeforeCompile']>[0]
    if (standard) material.onBeforeCompile(shader, renderer)
    const finish = standard ? [material.color.toArray(), material.metalness, material.roughness, material.roughnessMap,
      material.emissive.toArray(), material.emissiveIntensity, material.emissiveMap, material.lightMap, material.lightMapIntensity,
      material.flatShading, material.vertexColors, material.normalMapType, material.normalScale.toArray(),
      material.bumpScale, material.aoMapIntensity, material.displacementScale, material.displacementBias,
      material.map, material.metalnessMap, material.normalMap, material.bumpMap, material.aoMap, material.displacementMap] : []
    const authored = Object.entries(shader.uniforms).filter(([name]) => !/^hd(GI|Sky|Diagnostic|LightingDiagnostic|RoomLight|PointLightRoomIds|SpotLightRoomIds)/.test(name))
      .map(([name, uniform]) => [name, surfaceValue(uniform.value)])
    const key = JSON.stringify([material.type, material.visible, material.side, material.alphaTest, material.alphaHash,
      material.opacity, surfaceValue((material as Material & { alphaMap?: Texture | null }).alphaMap),
      material.clippingPlanes, material.clipIntersection, material.customProgramCacheKey(),
      finish.map(surfaceValue), authored])
    materialKeys.set(material, key); return key
  }
  const visible: Object3D[] = []
  scene.traverseVisible(object => visible.push(object))
  for (const object of visible) {
    yield
    const mesh = object as Mesh
    if (!mesh.geometry || !mesh.material) continue
    const attributes: unknown[] = [], morphs: unknown[] = []
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) attributes.push([name, yield* attributeKey(attribute)])
    for (const [name, values] of Object.entries(mesh.geometry.morphAttributes)) {
      const keys: string[] = []
      for (const value of values ?? []) keys.push(yield* attributeKey(value))
      morphs.push([name, values && keys])
    }
    const instance = object as Object3D & { instanceMatrix?: BufferAttribute; instanceColor?: BufferAttribute; count?: number }
    objects.push(JSON.stringify([object.type, object.matrixWorld.elements, object.layers.mask, object.renderOrder, object.parent?.renderOrder,
      mesh.geometry.index && (yield* attributeKey(mesh.geometry.index)), attributes, morphs, mesh.morphTargetInfluences,
      mesh.geometry.morphTargetsRelative, mesh.geometry.groups, mesh.geometry.drawRange,
      instance.instanceMatrix && (yield* attributeKey(instance.instanceMatrix)), instance.instanceColor && (yield* attributeKey(instance.instanceColor)), instance.count,
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(materialKey)]))
  }
  return JSON.stringify([scene.fog, objects.sort()])
}

export function indirectSurfaceCaptureKey(scene: Scene, renderer: WebGLRenderer) {
  const steps = surfaceCaptureKeySteps(scene, renderer)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** Material/geometry invalidation shares the display's cooperative task budget. */
export function prepareIndirectSurfaceCaptureKey(scene: Scene, renderer: WebGLRenderer, cancelled: () => boolean) {
  return runViewportTask(surfaceCaptureKeySteps(scene, renderer), cancelled)
}

/** A bounded set of six face tiles per probe. Atlas indices need not be dense. */
export function indirectSurfaceCacheLayout(probes: number[], size: number, maxTextureSize: number, budget = CACHE_BUDGET, relighting = false) {
  if (!probes.length || new Set(probes).size !== probes.length || ![4, 8, 16].includes(size)) return null
  const tiles = probes.length * 6, columns = Math.ceil(Math.sqrt(tiles)), rows = Math.ceil(tiles / columns)
  const width = columns * size, height = rows * size, bytes = width * height * (BYTES_PER_PIXEL + (relighting ? 16 : 0))
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
    #ifdef HD_GI_CONTACT_RECEIVERS
    if(hdGIContactReceiver()>.5)hdSurfaceNormal.w=-hdGIContactReceiver();
    #endif
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
  material.customProgramCacheKey = () => key + ':surface-data-v5'
  material.onBeforeCompile = (shader, renderer) => {
    if (standard) shader.fragmentShader = surfaceFragment
    compile.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(indirectLightingShaderDeclarations, indirectReceiverShaderDeclarations)
      .replace(lightingDiagnosticGLSL,'').replace('#define HD_LIGHTING_DIAGNOSTICS','')
      .replace('#define HD_INDIRECT_VISIBILITY', '')
    shader.fragmentShader = `#define HD_GI_SURFACE_DATA
      layout(location = 1) out highp vec4 hdSurfaceNormal;
      layout(location = 2) out highp vec4 hdSurfaceResponse;
      ` + shader.fragmentShader
    // Unlit objects still occlude receivers, but have no indirect response.
    if (!standard) shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, `
      gl_FragColor = vec4(0.0); hdSurfaceNormal = vec4(0.0); hdSurfaceResponse = vec4(0.0);
    }`)
  }
}

/** At night the immutable baseline is emission alone. Record it with receiver
 * geometry instead of compiling the entire lit house shader family into MRT. */
export function applyIndirectNightSurfaceCapture(material: Material) {
  applyIndirectSurfaceCapture(material)
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey()
  const standard = material instanceof MeshStandardMaterial
  material.customProgramCacheKey = () => key + ':night-relight-v1'
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader
      .replace('layout(location = 1) out highp vec4 hdSurfaceNormal;',
        'layout(location = 1) out highp vec4 hdSurfaceReceiver;\nlayout(location = 2) out highp vec4 hdSurfaceNormal;')
      .replace('layout(location = 2) out highp vec4 hdSurfaceResponse;',
        'layout(location = 3) out highp vec4 hdSurfaceResponse;\nlayout(location = 4) out highp vec4 hdSurfaceMaterial;')
    if (standard) {
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform vec3 diffuse;', 'uniform vec3 diffuse, emissive;\n#include <emissivemap_pars_fragment>')
        .replace('vec4 diffuseColor = vec4(diffuse, opacity);',
          'vec4 diffuseColor = vec4(diffuse, opacity);\nvec3 totalEmissiveRadiance = emissive;\n#include <emissivemap_fragment>')
        .replace('gl_FragColor = vec4(hdSurfaceP, hdSurfaceId + 1.0);',
          'hdSurfaceReceiver = vec4(hdSurfaceP, hdSurfaceId + 1.0);\ngl_FragColor = vec4(totalEmissiveRadiance, 1.0);')
        .replace('hdSurfaceResponse = vec4(hdResponse, 1.0);', `
          vec3 dxy = max(abs(dFdx(nonPerturbedNormal)), abs(dFdy(nonPerturbedNormal)));
          float geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);
          hdSurfaceResponse = vec4(hdResponse, min(max(roughnessFactor, .0525) + geometryRoughness, 1.0));
          hdSurfaceMaterial = vec4(diffuseColor.rgb, metalnessFactor + 1.0);`)
    } else shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, 'hdSurfaceReceiver = vec4(0.0); hdSurfaceMaterial = vec4(0.0);\n}')
  }
}

/** Keep the ordinary PBR result and record transport inputs in the same draw.
 * The cloned capture material owns this hook; display materials stay unchanged. */
export function applyIndirectSurfaceRadianceCapture(material: Material, relighting = false, rawReceiver = false) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey()
  const standard = material instanceof MeshStandardMaterial
  material.customProgramCacheKey = () => key + (relighting ? ':surface-radiance-v4-relight' : ':surface-radiance-v2') + (rawReceiver ? ':raw-receiver' : '')
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.fragmentShader = `
      #define HD_GI_DIRECT_CAPTURE
      layout(location = 1) out highp vec4 hdSurfaceReceiver;
      layout(location = 2) out highp vec4 hdSurfaceNormal;
      layout(location = 3) out highp vec4 hdSurfaceResponse;
      ${relighting ? 'layout(location = 4) out highp vec4 hdSurfaceMaterial;' : ''}
      ` + shader.fragmentShader
    const response = standard ? /* glsl */ `
      vec3 hdSurfaceN = normalize(transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
      vec3 hdSurfaceGeometricN = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix));
      vec3 hdSurfaceP; float hdSurfaceFloor;
      float hdSurfaceId = hdGIReceiver(hdGIWorldPosition, hdGIReceiverWorldOffset, hdSurfaceGeometricN,
        1.0, hdSurfaceP, hdSurfaceFloor);
      hdSurfaceReceiver = ${rawReceiver ? 'vec4(hdGIWorldPosition, 1.0)' : 'vec4(hdSurfaceP, hdSurfaceId + 1.0)'};
      // Preserve the exact exterior sky eligibility, including roof undersides.
      // Transport recognizes only positive indoor receiver IDs.
      ${relighting && !rawReceiver ? 'if(hdSurfaceId < 0.0 && (hdGIExteriorFootprint(hdGIWorldPosition) || (hdGIFloorCount > 0 && hdSurfaceGeometricN.y >= -.01))) hdSurfaceReceiver.a = -1.0;' : ''}
      hdSurfaceNormal = vec4(hdSurfaceN, hdSurfaceFloor);
      #ifdef HD_GI_CONTACT_RECEIVERS
      if(hdGIContactReceiver()>.5)hdSurfaceNormal.w=-hdGIContactReceiver();
      #endif
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
      hdSurfaceResponse = vec4(hdResponse, ${relighting ? 'material.roughness' : '1.0'});
      ${relighting ? 'hdSurfaceMaterial = vec4(diffuseColor.rgb, metalnessFactor + 1.0);' : ''}
      ` : 'hdSurfaceReceiver = vec4(0.0); hdSurfaceNormal = vec4(0.0); hdSurfaceResponse = vec4(0.0);' +
        (relighting ? 'hdSurfaceMaterial = vec4(0.0);' : '')
    shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, response + '\n}')
  }
}

/** Geometry/material samples are captured once; pass two evaluates their diffuse
 * transport against the completed first-bounce volume without scene draws. */
export function createIndirectSurfaceCache(renderer: WebGLRenderer, probes: number[], size: number, uniforms: IndirectUniforms, relight = false,nearForProbe:(probe:number)=>number=()=>.03) {
  const shOrder = uniforms.hdGISHOrder.value === 2 ? 2 : 1
  const coefficientCount = indirectSHCoefficientCount(shOrder)
  const context = renderer.getContext()
  if (!('clearBufferfv' in context)) return null
  if (!renderer.extensions.has('EXT_color_buffer_float') || context.getParameter(context.MAX_DRAW_BUFFERS) < 4) return null
  const relighting = relight && context.getParameter(context.MAX_DRAW_BUFFERS) >= 5 && !renderer.capabilities.logarithmicDepthBuffer && !renderer.capabilities.reversedDepthBuffer
  const layout = indirectSurfaceCacheLayout(probes, size, renderer.capabilities.maxTextureSize, CACHE_BUDGET, relighting)
  if (!layout) return null
  const target = new WebGLRenderTarget(layout.width, layout.height, { count: relighting ? 5 : 4, type: HalfFloatType,
    format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false })
  target.textures[1].type = FloatType; target.textures[2].type = FloatType
  if (relighting) target.depthTexture = new DepthTexture(layout.width, layout.height)
  target.scissorTest = true
  const radiance = new WebGLRenderTarget(layout.width, layout.height, { type: HalfFloatType, depthBuffer: false,
    format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
    colorSpace: LinearSRGBColorSpace })
  radiance.scissorTest = true
  // The immutable baseline supplies relighting deltas; bounce two must read
  // the latest direct radiance, including every edit since that baseline.
  const currentRadiance = relighting ? radiance.clone() : radiance
  const tile = { value: new Vector2() }, ready = new Set<number>()
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1), geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { hdSurfaceRadiance: { value: radiance.texture }, hdSurfaceNormal: { value: target.textures[2] },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) }, hdSurfaceSlot: { value: 0 },hdSurfaceBatch:{value:0}, hdGISampleSize: { value: size } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D hdSurfaceRadiance;
      uniform sampler2D hdSurfaceNormal;
      uniform vec2 hdSurfaceAtlas;
      uniform float hdSurfaceSlot;
      uniform float hdSurfaceBatch;
      uniform int hdGISampleSize;
      ${indirectSHIntegrationGLSL(shOrder)}
      void main() {
        int coefficient = int(gl_FragCoord.x) % ${coefficientCount};
        bool skyOnly = gl_FragCoord.x > ${coefficientCount}.0;
        vec3 sum = vec3(0.0); float totalWeight = 0.0;
        for (int face = 0; face < 6; face++) {
          float slot=hdSurfaceBatch>.5?floor(gl_FragCoord.y):hdSurfaceSlot;
          float tileIndex = slot * 6.0 + float(face);
          vec2 origin = vec2(mod(tileIndex, ${layout.columns}.0), floor(tileIndex / ${layout.columns}.0)) * ${size}.0;
          for (int y = 0; y < hdGISampleSize; y++) for (int x = 0; x < hdGISampleSize; x++) {
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
            float basis = hdSHRadianceBasis(coefficient, direction);
            vec2 uv = (origin + vec2(float(x), float(y)) + .5) / hdSurfaceAtlas;
            vec3 value=texture2D(hdSurfaceRadiance,uv).rgb;
            if(skyOnly&&length(texture2D(hdSurfaceNormal,uv).xyz)>.5)value=vec3(0.0);
            sum += value * basis * weight; totalWeight += weight;
          }
        }
        gl_FragColor = vec4(sum * (12.5663706144 / totalWeight), 1.0);
      }`,
  })
  scene.add(new Mesh(geometry, material))
  // Relight each texel once, then reuse the existing inexpensive SH reduction.
  // Putting volume sampling inside the SH loop duplicates it four times and
  // makes driver compilation of the fixed-size loops excessively expensive.
  const replayScene = new Scene(), replay = new ShaderMaterial({ defines: indirectShaderDefines(uniforms), depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { ...uniforms, hdSurfaceRadiance: { value: currentRadiance.texture }, hdSurfacePositions: { value: target.textures[1] },
      hdSurfaceNormals: { value: target.textures[2] }, hdSurfaceResponses: { value: target.textures[3] },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) }, hdSurfaceOrigin: { value: new Vector2() } },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      #include <common>
      ${indirectVolumeShaderDeclarations}
      uniform sampler2D hdSurfaceRadiance, hdSurfacePositions, hdSurfaceNormals, hdSurfaceResponses;
      uniform vec2 hdSurfaceAtlas, hdSurfaceOrigin;
      void main() {
        vec2 uv = (hdSurfaceOrigin + gl_FragCoord.xy) / hdSurfaceAtlas;
        vec3 light = texture2D(hdSurfaceRadiance, uv).rgb;
        vec4 position = texture2D(hdSurfacePositions, uv);
        if (position.a > .5) {
          vec4 normal = texture2D(hdSurfaceNormals, uv); vec3 mean;
          vec3 bounce;
          #ifdef HD_GI_CONTACT_RECEIVERS
          if(normal.a<-.5)bounce=hdGIContactIrradiance(-normal.a,normal.xyz,mean);else
          #endif
          bounce=hdGIVolumeIrradiance(position.a - 1.0, position.xyz, normal.xyz, normal.a, mean);
          light += texture2D(hdSurfaceResponses, uv).rgb * bounce;
        }
        gl_FragColor = vec4(light, 1.0);
      }`,
  })
  replayScene.add(new Mesh(geometry, replay))
  const copyScene = new Scene(), copy = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { ...uniforms, hdSurfaceCube: { value: null }, hdSurfaceTile: tile, hdSurfaceFace: { value: 0 },
      hdSurfaceCaptured: { value: target.textures[0] }, hdSurfaceCombined: { value: 0 },
      hdSurfaceNormal: { value: target.textures[2] },
      hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) } },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform samplerCube hdSurfaceCube;
      uniform sampler2D hdSurfaceCaptured;
      uniform sampler2D hdSurfaceNormal;
      uniform vec3 hdSkyRadianceBase;
      ${daylightSkyGLSL}
      uniform float hdSurfaceCombined;
      uniform vec2 hdSurfaceAtlas;
      uniform vec2 hdSurfaceTile;
      uniform int hdSurfaceFace;
      void main() {
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
        vec2 uv=gl_FragCoord.xy/hdSurfaceAtlas;
        if(hdSurfaceCombined>.5){
          vec3 value=texture2D(hdSurfaceCaptured,uv).rgb;
          if(length(texture2D(hdSurfaceNormal,uv).xyz)<.5)value=hdSkyRadiance(normalize(p),hdSkyRadianceBase);
          gl_FragColor=vec4(value,1.0);
        }else gl_FragColor = textureCube(hdSurfaceCube, p);
      }`,
  })
  copyScene.add(new Mesh(geometry, copy))
  const replayTarget = new WebGLCubeRenderTarget(size, { type: HalfFloatType, format: RGBAFormat,
    generateMipmaps: false, colorSpace: LinearSRGBColorSpace, depthBuffer: false })
  const replayIntegrator = createIndirectProbeIntegrator(size, 'cube', [0,1,2,3,4,5], false, shOrder)
  const relightIntegrator = createIndirectProbeIntegrator(size,'cube',[0,1,2,3,4,5],true,shOrder)
  const integrated = new WebGLRenderTarget(coefficientCount * 2, 1, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false })
  const batchRadiance=radiance.clone(),batchIntegrated=new WebGLRenderTarget(coefficientCount,probes.length,{type:HalfFloatType,format:RGBAFormat,depthBuffer:false})
  batchRadiance.scissorTest=true;batchIntegrated.scissorTest=true
  const zero = new Float32Array(4), skyPixel = new Float32Array(4), skyColor = new Color()
  let disposed = false, compiled = false, compilation: Promise<unknown> | undefined
  const reads = new Set<Promise<unknown>>()
  const copyPrograms=new Map<number,{material:ShaderMaterial;scene:Scene}>(),retained=new Set<number>()
  const relighter = relighting ? createIndirectSurfaceRelighting(renderer, target, radiance.texture, layout, uniforms, replayTarget, relightIntegrator) : null
  let lightingKey = ''
  const copyFace = (probe: number, face: number, cube: WebGLCubeRenderTarget, combined: boolean, destinations: WebGLRenderTarget[]) => {
    const [x, y] = layout.tile(probe, face), stats = { ...renderer.info.render }, autoClear = renderer.autoClear
    tile.value.set(x, y); copy.uniforms.hdSurfaceCube.value = cube.texture; copy.uniforms.hdSurfaceFace.value = face
    copy.uniforms.hdSurfaceCombined.value = combined ? 1 : 0
    try {
      renderer.autoClear = false
      for (const destination of destinations) {
        destination.viewport.set(x, y, size, size); destination.scissor.set(x, y, size, size)
        renderer.setRenderTarget(destination); renderer.render(copyScene, camera)
      }
    } finally { renderer.autoClear = autoClear; Object.assign(renderer.info.render, stats) }
  }
  const release = () => { target.dispose(); radiance.dispose(); if (currentRadiance !== radiance) currentRadiance.dispose(); integrated.dispose();batchRadiance.dispose();batchIntegrated.dispose(); replayTarget.dispose(); replayIntegrator.dispose();relightIntegrator.dispose();
    geometry.dispose(); material.dispose(); replay.dispose(); copy.dispose();copyPrograms.forEach(p=>p.material.dispose()); relighter?.dispose(); ready.clear() }
  return { target, tile, layout, ready, sky: skyColor, relighting,radiance,currentRadiance,captureNear:nearForProbe,
    /** Regional edits retain unaffected receiver tiles. Their original and
     * current direct radiance are immutable inputs to subsequent Jacobi passes. */
    async retainFrom(previous:{target:WebGLRenderTarget;radiance:WebGLRenderTarget;currentRadiance:WebGLRenderTarget;layout:typeof layout;ready:Set<number>;relighting:boolean;captureNear?:(probe:number)=>number},indices:readonly number[],cancelled:()=>boolean){
      if(!relighting||!previous.relighting||layout.width!==previous.layout.width||layout.height!==previous.layout.height||
        [...layout.slots].some(([index,slot])=>previous.layout.slots.get(index)!==slot))return 0
      const reusable=indices.filter(index=>previous.ready.has(index)&&(previous.captureNear?.(index)??.03)===nearForProbe(index));if(!reusable.length)return 0
      const work=(async()=>{
      const pairs=[[previous.target,target],[previous.radiance,radiance],[previous.currentRadiance,currentRadiance]] as const
      for(const [source,destination]of pairs){
        if(cancelled()||disposed)return 0
        const count=destination.textures.length
        let program=copyPrograms.get(count)
        if(!program){
          const withDepth=!!destination.depthTexture
          const material=new ShaderMaterial({depthTest:withDepth,depthWrite:withDepth,depthFunc:AlwaysDepth,toneMapped:false,
            uniforms:{...Object.fromEntries(source.textures.map((texture,index)=>[`source${index}`,{value:texture}])),sourceDepth:{value:source.depthTexture}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
            fragmentShader:`${withDepth?'uniform sampler2D sourceDepth;':''}${Array.from({length:count},(_,i)=>`uniform sampler2D source${i};${i?`layout(location=${i})out highp vec4 copied${i};`:''}`).join('\n')}
              void main(){vec2 uv=gl_FragCoord.xy/vec2(${layout.width}.0,${layout.height}.0);
              ${Array.from({length:count},(_,i)=>`${i?`copied${i}`:'gl_FragColor'}=texture2D(source${i},uv);`).join('\n')}${withDepth?'gl_FragDepth=texture2D(sourceDepth,uv).r;':''}}`})
          const scene=new Scene();scene.add(new Mesh(geometry,material));program={material,scene};copyPrograms.set(count,program)
        }
        source.textures.forEach((texture,index)=>{program!.material.uniforms[`source${index}`].value=texture})
        program.material.uniforms.sourceDepth.value=source.depthTexture
        const targetBefore=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),auto=renderer.autoClear,stats={...renderer.info.render}
        let linking:Promise<unknown>
        try{destination.viewport.set(0,0,destination.width,destination.height);destination.scissor.set(0,0,destination.width,destination.height);renderer.setRenderTarget(destination);linking=renderer.compileAsync(program.scene,camera)}
        finally{renderer.setRenderTarget(targetBefore,face,mip)}
        await linking
        if(cancelled()||disposed)return 0
        try{renderer.autoClear=false;renderer.setRenderTarget(destination);renderer.render(program.scene,camera)}
        finally{renderer.setRenderTarget(targetBefore,face,mip);renderer.autoClear=auto;Object.assign(renderer.info.render,stats)}
      }
      reusable.forEach(index=>{ready.add(index);retained.add(index)});return reusable.length
      })()
      reads.add(work);try{return await work}finally{reads.delete(work)}
    },
    hydrateRetained(){if(relighter){retained.forEach(index=>relighter.record(index,[],nearForProbe(index)));retained.clear()}},
    /** Same Jacobi replay and SH integration as read(), submitted in bounded
     * atlas chunks. One small asynchronous read replaces a read per probe. */
    async readBatch(indices:readonly number[],cancelled:()=>boolean,measure:(name:string,draw:()=>void,wallMs?:number)=>void=(_,draw)=>draw()){
      if(indices.some(index=>!ready.has(index)))throw Error('Batch requested uncaptured probe surfaces')
      const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
      const draw=(destination:WebGLRenderTarget,y:number,height:number,operation:()=>void)=>{
        const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),stats={...renderer.info.render},auto=renderer.autoClear
        try{renderer.autoClear=false;destination.viewport.set(0,y,destination.width,height);destination.scissor.set(0,y,destination.width,height);renderer.setRenderTarget(destination);operation()}
        finally{renderer.setRenderTarget(previous,face,mip);renderer.autoClear=auto;Object.assign(renderer.info.render,stats)}
      }
      const work=(async()=>{
        try{
          for(let y=0;y<layout.height;y+=64){if(disposed||cancelled())return
            replay.uniforms.hdSurfaceOrigin.value.set(0,0)
            draw(batchRadiance,y,Math.min(64,layout.height-y),()=>measure('cached atlas diffuse relighting',()=>renderer.render(replayScene,camera)))
            await tick()
          }
          material.uniforms.hdSurfaceRadiance.value=batchRadiance.texture;material.uniforms.hdSurfaceBatch.value=1
          for(let row=0;row<probes.length;row+=32){if(disposed||cancelled())return
            draw(batchIntegrated,row,Math.min(32,probes.length-row),()=>measure('batched SH integration',()=>renderer.render(scene,camera)))
            await tick()
          }
          if(disposed||cancelled())return
          const pixels=new Uint16Array(probes.length*coefficientCount*4),previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
          let reading:Promise<unknown>|undefined
          const readAt=performance.now()
          try{renderer.setRenderTarget(null);measure('batched probe readback submission',()=>{reading=renderer.readRenderTargetPixelsAsync(batchIntegrated,0,0,coefficientCount,probes.length,pixels)})}
          finally{renderer.setRenderTarget(previous,face,mip)}
          await reading
          measure('batched probe readback wall wait',()=>{},performance.now()-readAt)
          if(disposed||cancelled())return
          return new Map(indices.map(index=>{const slot=layout.slots.get(index)!,sh=new SphericalHarmonics3()
            for(let c=0;c<coefficientCount;c++)sh.coefficients[c].set(DataUtils.fromHalfFloat(pixels[slot*coefficientCount*4+c*4]),DataUtils.fromHalfFloat(pixels[slot*coefficientCount*4+c*4+1]),DataUtils.fromHalfFloat(pixels[slot*coefficientCount*4+c*4+2]))
            return [index,sh] as const
          }))
        }finally{material.uniforms.hdSurfaceRadiance.value=radiance.texture;material.uniforms.hdSurfaceBatch.value=0}
      })()
      reads.add(work);try{return await work}finally{reads.delete(work)}
    },
    setLightingKey(key: string) { if (key !== lightingKey) { relighter?.clear(); ready.clear(); lightingKey = key } },
    recordLights(probe: number, lights: SurfaceLight[]) { relighter?.record(probe, lights,nearForProbe(probe)) },
    canRelight(probe: number) { return ready.has(probe) && !!relighter?.has(probe) },
    relightGPU(probe: number, position: number[], lights: SurfaceLight[], destination: WebGLRenderTarget, row: number,
      sun?: import('three').DirectionalLight, sunStrength = 1) {
      if (!relighter || !ready.has(probe)) throw new Error('Surface relighting is unavailable')
      relighter.render(probe, position, lights, destination, row, sun, sunStrength)
    },
    relight(probe: number, position: number[], lights: SurfaceLight[], sun?: import('three').DirectionalLight, sunStrength = 1) {
      if (!relighter) throw new Error('Surface relighting is unavailable')
      const result = relighter.read(probe, position, lights, () => {
        // All six relit faces are queued before reduction/readback. Preserve
        // them for the second bounce without modifying the original baseline.
        for (let face = 0; face < 6; face++) copyFace(probe, face, replayTarget, false, [currentRadiance])
      }, sun, sunStrength)
      reads.add(result); return result.finally(() => reads.delete(result))
    },
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
        const relighting = relighter?.compile()
        return compilation = Promise.allSettled([direct, bounce, reduce, copying, relighting]).then(results => {
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
      for (let attachment = 1; attachment < target.textures.length; attachment++) context.clearBufferfv(context.COLOR, attachment, zero)
    },
    copyFace(probe: number, face: number, sky: Color, cube: WebGLCubeRenderTarget, combined = false) {
      skyColor.copy(sky)
      copyFace(probe, face, cube, combined, currentRadiance === radiance ? [radiance] : [radiance, currentRadiance])
    },
    async read(probe: number, bounce: number) {
      const slot = layout.slots.get(probe)
      if (slot === undefined) throw new Error('Missing GI surface probe')
      const pixels = new Uint16Array(coefficientCount * 8), previous = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), stats = { ...renderer.info.render }
      if (bounce >= 2) {
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
      const read = renderer.readRenderTargetPixelsAsync(integrated, 0, 0, coefficientCount * 2, 1, pixels)
      reads.add(read)
      try { await read } finally { reads.delete(read) }
      const sh = new SphericalHarmonics3()
      for (let i = 0; i < coefficientCount; i++) sh.coefficients[i].set(...Array.from(pixels.slice(i * 4, i * 4 + 3), DataUtils.fromHalfFloat) as [number, number, number])
      const sky=new SphericalHarmonics3()
      for(let i=0;i<coefficientCount;i++)sky.coefficients[i].set(...Array.from(pixels.slice(coefficientCount*4+i*4,coefficientCount*4+i*4+3),DataUtils.fromHalfFloat) as [number,number,number])
      return Object.assign(sh,{sky})
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (reads.size || (compilation && !compiled)) void Promise.allSettled([...reads, ...(compilation ? [compilation] : [])]).then(release)
      else release()
    },
  }
}
