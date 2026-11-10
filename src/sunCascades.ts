import { DirectionalLight, Matrix4, Vector3, Vector4, WebGLRenderTarget, DepthTexture,
  LessEqualCompare, PCFShadowMap, type Camera, type Material, type Object3D, type WebGLRenderer } from 'three'
import { SunShadowCache } from './sunShadowCache.ts'
import { rendererShadowSize } from './rendererRecovery.ts'

// Nested camera frustums blend into the existing whole-building shadow map.
// These lights render depth only: they never enter the scene's lighting/GI.
export const SUN_CASCADE_DISTANCES = [4, 14] as const
export const SUN_CASCADE_MAP_SIZE = rendererShadowSize

function createUniforms(renderer: WebGLRenderer) {
  const fallback = new WebGLRenderTarget(1, 1)
  fallback.depthTexture = new DepthTexture(1, 1)
  fallback.depthTexture.compareFunction = LessEqualCompare
  renderer.initRenderTarget?.(fallback)
  return {
    fallback,
    enabled: { value: 0 },
    count: { value: 3 },
    view: { value: new Matrix4() },
    maps: [{ value: fallback.depthTexture }, { value: fallback.depthTexture }],
    matrices: [{ value: new Matrix4() }, { value: new Matrix4() }],
    parameters: { value: new Vector4(0, 0, 0, 1) },
  }
}
const rendererUniforms = new WeakMap<WebGLRenderer, ReturnType<typeof createUniforms>>()
function uniformsFor(renderer: WebGLRenderer) {
  let uniforms = rendererUniforms.get(renderer)
  if (!uniforms) { uniforms = createUniforms(renderer); rendererUniforms.set(renderer, uniforms) }
  return uniforms
}

/** Fit a stable, texel-snapped square to a camera depth slice. Keep upstream
 * casters in the depth range even when they are outside the viewing frustum. */
export function fitSunCascade(light: DirectionalLight, camera: Camera, sun: DirectionalLight, distance: number, casterDepth: number) {
  const corners: Vector3[] = []
  const perspective = 'isPerspectiveCamera' in camera
  const clip = camera as Camera & { near: number; far: number }
  const far = Math.min(distance, clip.far)
  for (const depth of [clip.near, far]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const p = new Vector3(x, y, 0).applyMatrix4(camera.projectionMatrixInverse)
    if (perspective) p.multiplyScalar(depth / -p.z)
    else p.z = -depth
    corners.push(p)
  }
  const center = new Vector3()
  for (const p of corners) center.add(p)
  center.multiplyScalar(1 / corners.length)
  let radius = 0
  for (const p of corners) radius = Math.max(radius, p.distanceTo(center))
  // Quantization keeps rotation from continuously changing the texel size.
  radius = Math.ceil((radius + .02) * 16) / 16
  center.applyMatrix4(camera.matrixWorld)
  const direction = new Vector3().setFromMatrixPosition(sun.matrixWorld)
    .sub(new Vector3().setFromMatrixPosition(sun.target.matrixWorld)).normalize()
  const orientation = new Matrix4().lookAt(new Vector3(), direction.clone().negate(), new Vector3(0, 1, 0))
  const inverse = orientation.clone().invert()
  center.applyMatrix4(inverse)
  const texel = 2 * radius / light.shadow.mapSize.x
  center.x = Math.round(center.x / texel) * texel
  center.y = Math.round(center.y / texel) * texel
  center.applyMatrix4(orientation)
  light.target.position.copy(center)
  light.position.copy(center).addScaledVector(direction, casterDepth + radius)
  light.updateMatrixWorld(true); light.target.updateMatrixWorld(true)
  const shadow = light.shadow, c = shadow.camera
  c.left = c.bottom = -radius; c.right = c.top = radius
  c.near = .1; c.far = 2 * (casterDepth + radius)
  c.updateProjectionMatrix()
  shadow.bias = sun.shadow.bias
  // The old 15 mm offset would erase the very detail these maps resolve.
  shadow.normalBias = Math.min(sun.shadow.normalBias, texel * .5)
  shadow.radius = sun.shadow.radius
  shadow.intensity = sun.shadow.intensity
  return { radius, texel }
}

export class SunCascades {
  readonly lights = SUN_CASCADE_DISTANCES.map(() => {
    const light = new DirectionalLight()
    light.castShadow = true
    light.shadow.autoUpdate = false
    light.shadow.mapSize.set(SUN_CASCADE_MAP_SIZE, SUN_CASCADE_MAP_SIZE)
    return light
  })
  private cache = new SunShadowCache()
  private uniforms: ReturnType<typeof createUniforms>

  constructor(renderer: WebGLRenderer) { this.uniforms = uniformsFor(renderer) }

  disable() { this.uniforms.enabled.value = 0 }

  prepare(camera: Camera, sun: DirectionalLight, scene: Object3D, shadowType: number) {
    this.disable()
    if (shadowType !== PCFShadowMap || !sun.castShadow || sun.shadow.intensity === 0) return []
    camera.updateWorldMatrix(true, false)
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false)
    const depth = Math.max(32, sun.shadow.camera.far)
    this.lights.forEach((light, i) => {
      fitSunCascade(light, camera, sun, SUN_CASCADE_DISTANCES[i], depth)
      this.cache.update(light, scene, camera.layers.mask, shadowType)
    })
    this.uniforms.view.value.copy(camera.matrixWorldInverse)
    return this.lights
  }

  publish() {
    if (this.lights.some(light => !light.shadow.map)) return
    this.lights.forEach((light, i) => {
      this.uniforms.maps[i].value = light.shadow.map!.depthTexture!
      this.uniforms.matrices[i].value.copy(light.shadow.matrix)
    })
    // World-space receiver bias is stored per cascade because texel sizes differ.
    this.uniforms.parameters.value.set(this.lights[0].shadow.normalBias,
      this.lights[1].shadow.normalBias, this.lights[0].shadow.bias, this.lights[0].shadow.radius)
    this.uniforms.enabled.value = 1
  }

  dispose() {
    this.disable()
    for (const light of this.lights) light.shadow.dispose()
    for (const map of this.uniforms.maps) map.value = this.uniforms.fallback.depthTexture!
  }
}

const cascadePars = /* glsl */ `
#if defined(USE_SHADOWMAP) && defined(SHADOWMAP_TYPE_PCF) && !defined(HD_GI_CAPTURE_VISIBILITY)
uniform float hdSunCascadesEnabled;
uniform int hdSunCascadeCount;
uniform mat4 hdSunCascadeView;
uniform sampler2DShadow hdSunCascadeMap0;
uniform sampler2DShadow hdSunCascadeMap1;
uniform mat4 hdSunCascadeMatrix0;
uniform mat4 hdSunCascadeMatrix1;
uniform vec4 hdSunCascadeParameters;
float hdSunCascadeWeight(vec4 coord, float depth, float farDepth) {
  vec3 p = coord.xyz / coord.w;
  float edge = min(min(p.x, p.y), min(1.0-p.x, 1.0-p.y));
  return (p.z > 0.0 && p.z < 1.0) ?
    (1.0-smoothstep(farDepth*.85, farDepth, depth))*smoothstep(0.0, .02, edge) : 0.0;
}
float hdSunCascadeCompare(int cascade, sampler2DShadow farMap, vec3 coord) {
  if (cascade == 0) return texture(farMap, coord);
  if (cascade == 1) return texture(hdSunCascadeMap1, coord);
  return texture(hdSunCascadeMap0, coord);
}
float hdSunCascadeVisibility(sampler2DShadow farMap, vec2 farSize, float intensity,
    float bias, float radius, vec4 farCoord, vec3 position, vec3 normal) {
  if (intensity <= 0.0) return 1.0;
  float depth = -(hdSunCascadeView * vec4(position, 1.0)).z;
  vec4 p0 = hdSunCascadeMatrix0 * vec4(position+normal*hdSunCascadeParameters.x, 1.0);
  vec4 p1 = hdSunCascadeMatrix1 * vec4(position+normal*hdSunCascadeParameters.y, 1.0);
  float result = 1.0;
  // A uniform loop keeps one receiver/filter implementation in the driver's
  // compiler, instead of inlining the large getShadow function three times
  // into every PBR/finish/fade variant. Every fragment runs the same iterations
  // so the receiver derivatives remain well-defined across cascade boundaries.
  int count = hdSunCascadesEnabled > .5 ? hdSunCascadeCount : 1;
  for (int cascade = 0; cascade < count; cascade++) {
    vec4 coord = cascade == 0 ? farCoord : cascade == 1 ? p1 : p0;
    vec2 size = cascade == 0 ? farSize : vec2(${SUN_CASCADE_MAP_SIZE}.0);
    vec3 p = coord.xyz / coord.w;
    vec3 dx = dFdx(p), dy = dFdy(p);
    float determinant = dx.x * dy.y - dx.y * dy.x;
    vec2 gradient = abs(determinant) > 1e-16 ?
      vec2(dy.y*dx.z-dx.y*dy.z, dx.x*dy.z-dy.x*dx.z)/determinant : vec2(0.0);
    float rasterBias = .000001 + dot(abs(gradient), 1.0/size)/hdShadowRasterSteps;
    float visibility = 1.0;
    if (all(greaterThanEqual(p, vec3(0.0))) && all(lessThanEqual(p, vec3(1.0)))) {
      vec2 centre = (floor(p.xy*size)+.5)/size;
      float reference = p.z + dot(gradient, centre-p.xy);
      #ifdef USE_REVERSED_DEPTH_BUFFER
        reference -= bias-rasterBias;
      #else
        reference += bias-rasterBias;
      #endif
      float centreShadow = reference < 0.0 || reference > 1.0 ? 1.0 :
        hdSunCascadeCompare(cascade, farMap, vec3(centre, reference));
      float phi = interleavedGradientNoise(gl_FragCoord.xy)*PI2;
      float filtered = 0.0;
      for (int tap = 0; tap < 5; tap++) {
        vec2 offset = vogelDiskSample(tap, 5, phi)*radius/size;
        vec2 uv = (floor((p.xy+offset)*size)+.5)/size;
        float z = p.z + dot(gradient, uv-p.xy);
        #ifdef USE_REVERSED_DEPTH_BUFFER
          z -= bias-rasterBias;
        #else
          z += bias-rasterBias;
        #endif
        filtered += z < 0.0 || z > 1.0 ? 1.0 : hdSunCascadeCompare(cascade, farMap, vec3(uv, z));
      }
      visibility = mix(1.0, min(centreShadow, filtered*.2), intensity);
    }
    float weight = cascade == 0 ? 1.0 : hdSunCascadeWeight(coord, depth,
      cascade == 1 ? ${SUN_CASCADE_DISTANCES[1]}.0 : ${SUN_CASCADE_DISTANCES[0]}.0);
    result = mix(result, visibility, weight);
  }
  return result;
}
#else
#define hdSunCascadeVisibility(map, size, intensity, bias, radius, coord, position, normal) getShadow(map, size, intensity, bias, radius, coord)
#endif
`

/** Compose after the room/portal shader so finish and GI hooks stay intact. */
export function applySunCascadeShader(shader: Parameters<Material['onBeforeCompile']>[0], renderer: WebGLRenderer) {
  const u = uniformsFor(renderer)
  Object.assign(shader.uniforms, { hdSunCascadesEnabled: u.enabled, hdSunCascadeView: u.view,
    hdSunCascadeCount: u.count,
    hdSunCascadeMap0: u.maps[0], hdSunCascadeMap1: u.maps[1],
    hdSunCascadeMatrix0: u.matrices[0], hdSunCascadeMatrix1: u.matrices[1], hdSunCascadeParameters: u.parameters })
  shader.fragmentShader = shader.fragmentShader.replace('void main()', `${cascadePars}\nvoid main()`)
  const lookup = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )'
  // The scene has one physical directional sun. Extra shadow cameras never
  // become lights, so daylight intensity and captured lighting remain unchanged.
  shader.fragmentShader = shader.fragmentShader.replace(lookup,
    'hdSunCascadeVisibility(directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ], hdRoomLightWorldPosition, inverseTransformDirection(nonPerturbedNormal, viewMatrix))')
}
