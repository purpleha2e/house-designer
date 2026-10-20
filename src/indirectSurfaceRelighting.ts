import { DepthTexture, DirectionalLight, LessEqualCompare, Matrix4, Mesh, OrthographicCamera, PCFShadowMap, PCFSoftShadowMap, PlaneGeometry, PointLight, Scene, ShaderMaterial, SpotLight, Vector2, Vector3, Vector4, VSMShadowMap,
  type Texture, type WebGLCubeRenderTarget, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { indirectVisibilityShaderDeclarations, type IndirectUniforms } from './indirectLightingShader.ts'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS } from './indirectLighting.ts'
import { retainResource } from './retainedViewportScene.ts'
import type { createIndirectProbeIntegrator } from './indirectProbeIntegration.ts'

const MAX_LIGHTS = 8 // Matches the bounded capture-light budget.
export type SurfaceLight = { position: number[]; direction: number[]; color: number[];
  distance: number; decay: number; cone: number; penumbra: number; index: number }
export function indirectSurfaceLights(lights: (PointLight | SpotLight)[], all: readonly { position: readonly number[] }[]): SurfaceLight[] {
  return lights.slice(0, MAX_LIGHTS).map(light => {
    const index = all.findIndex(slot => slot.position.every((value, axis) => Math.abs(value - light.position.getComponent(axis)) < .00001))
    return {
      position: light.position.toArray(), color: light.color.clone().multiplyScalar(light.intensity).toArray(),
      direction: light instanceof SpotLight ? light.target.position.clone().sub(light.position).normalize().toArray() : [0, 0, 0],
      distance: light.distance, decay: light.decay, cone: light instanceof SpotLight ? Math.cos(light.angle) : -1,
      penumbra: light instanceof SpotLight ? Math.cos(light.angle * (1 - light.penumbra)) : -1,
      index: index < INDIRECT_MAX_LOCAL_LIGHTS ? index : -1,
    }
  })
}

type Layout = { width: number; height: number; size: number; tile(probe: number, face: number): readonly [number, number] }
type Visibility = { positions: Texture; distances: Texture; layout: Vector3; users: number; release(): void }

/** Read the displayed sun after its shadow pass. Its map stays on the GPU and
 * can be reused by every cached receiver, including during a sun-control drag. */
export function indirectSurfaceSun(scene: Scene) {
  let sun: DirectionalLight | undefined
  scene.traverse(object => {
    if (object instanceof DirectionalLight && object.userData.houseDesignerRole === 'sun-light') sun = object
  })
  return sun
}

/** Re-evaluate PBR light on cached receivers. With a dynamic sun the immutable
 * capture omits that sun; its current shadowed light is added here alongside
 * the lamps. Sky/emissive terms remain cached. Original lamp subtraction always
 * uses the same baseline, so repeated edits never accumulate delta error. */
export function createIndirectSurfaceRelighting(renderer: WebGLRenderer, surface: WebGLRenderTarget, radiance: Texture,
  layout: Layout, uniforms: IndirectUniforms, cube: WebGLCubeRenderTarget, integrator: ReturnType<typeof createIndirectProbeIntegrator>) {
  const geometry = new PlaneGeometry(2, 2), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const records = new Map<number, { lights: SurfaceLight[]; visibility: Visibility; near: number; far: number }>()
  const visibility = new Map<string, Visibility>()
  const bank = () => ({ positions: Array.from({ length: MAX_LIGHTS }, () => new Vector3()),
    colors: Array.from({ length: MAX_LIGHTS }, () => new Vector3()), axes: Array.from({ length: MAX_LIGHTS }, () => new Vector4()),
    parameters: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) })
  const old = bank(), current = bank()
  const pcf = renderer.shadowMap.type === PCFShadowMap || renderer.shadowMap.type === PCFSoftShadowMap
  const vsm = renderer.shadowMap.type === VSMShadowMap
  // A shadow sampler needs a valid comparison depth texture even when its
  // branch is disabled. A null/colour fallback fails WebGL draw validation.
  const emptySunShadow = pcf ? new DepthTexture(1, 1) : null
  if (emptySunShadow) { emptySunShadow.compareFunction = LessEqualCompare; emptySunShadow.needsUpdate = true }
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    defines: { STANDARD: 1, HD_GI_CAPTURE_VISIBILITY: 1, USE_SHADOWMAP: 1,
      [pcf ? 'SHADOWMAP_TYPE_PCF' : vsm ? 'SHADOWMAP_TYPE_VSM' : 'SHADOWMAP_TYPE_BASIC']: 1 },
    uniforms: { ...uniforms, dfgLUT: { value: null },
      hdSurfaceRadiance: { value: radiance }, hdSurfaceNormal: { value: surface.textures[2] },
      hdSurfaceResponse: { value: surface.textures[3] }, hdSurfaceMaterial: { value: surface.textures[4] },
      hdSurfaceDepth: { value: surface.depthTexture }, hdSurfaceAtlas: { value: new Vector2(layout.width, layout.height) },
      hdSurfaceOrigin: { value: new Vector2() }, hdSurfaceClip: { value: new Vector2(.03, 80) },
      hdSurfaceProbe: { value: new Vector3() }, hdSurfaceFace: { value: 0 },
      hdOldPositions: { value: uniforms.hdGIPositions.value }, hdOldDistances: { value: uniforms.hdGIDistances.value },
      hdOldLayout: { value: new Vector3() }, hdOldCount: { value: 0 }, hdNewCount: { value: 0 },
      hdOldLightPositions: { value: old.positions }, hdOldLightColors: { value: old.colors },
      hdOldLightAxes: { value: old.axes }, hdOldLightParameters: { value: old.parameters },
      hdNewLightPositions: { value: current.positions }, hdNewLightColors: { value: current.colors },
      hdNewLightAxes: { value: current.axes }, hdNewLightParameters: { value: current.parameters },
      hdSunDirection: { value: new Vector3() }, hdSunColor: { value: new Vector3() },
      hdSunMatrix: { value: new Matrix4() }, hdSunMap: { value: emptySunShadow as Texture | null },
      hdSunMapSize: { value: new Vector2(1, 1) }, hdSunShadow: { value: new Vector4() },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      #include <common>
      #include <bsdfs>
      #include <lights_physical_pars_fragment>
      #include <shadowmap_pars_fragment>
      ${indirectVisibilityShaderDeclarations}
      uniform sampler2D hdSurfaceRadiance, hdSurfaceNormal, hdSurfaceResponse, hdSurfaceMaterial, hdSurfaceDepth;
      uniform sampler2D hdOldPositions, hdOldDistances;
      uniform vec2 hdSurfaceAtlas, hdSurfaceOrigin, hdSurfaceClip;
      uniform vec3 hdSurfaceProbe, hdOldLayout;
      uniform int hdSurfaceFace, hdOldCount, hdNewCount;
      uniform vec3 hdOldLightPositions[${MAX_LIGHTS}], hdOldLightColors[${MAX_LIGHTS}];
      uniform vec4 hdOldLightAxes[${MAX_LIGHTS}], hdOldLightParameters[${MAX_LIGHTS}];
      uniform vec3 hdNewLightPositions[${MAX_LIGHTS}], hdNewLightColors[${MAX_LIGHTS}];
      uniform vec4 hdNewLightAxes[${MAX_LIGHTS}], hdNewLightParameters[${MAX_LIGHTS}];
      uniform vec3 hdSunDirection, hdSunColor;
      uniform mat4 hdSunMatrix;
      uniform vec2 hdSunMapSize;
      uniform vec4 hdSunShadow;
      uniform ${pcf ? 'highp sampler2DShadow' : 'sampler2D'} hdSunMap;

      vec3 hdSunRadiance(vec3 p, vec3 n, vec3 viewDir, PhysicalMaterial material) {
        if (max3(hdSunColor) <= 0.0 || dot(n, hdSunDirection) <= 0.0) return vec3(0.0);
        float visibility = 1.0;
        if (hdSunShadow.x > 0.0) visibility = getShadow(hdSunMap, hdSunMapSize,
          hdSunShadow.x, hdSunShadow.y, hdSunShadow.w, hdSunMatrix * vec4(p + n * hdSunShadow.z, 1.0));
        IncidentLight light; light.direction = hdSunDirection; light.color = hdSunColor * visibility; light.visible = true;
        ReflectedLight result = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
        RE_Direct_Physical(light, p, n, viewDir, n, material, result);
        return result.directDiffuse + result.directSpecular;
      }

      vec3 hdLocalRadiance(bool previous, vec3 p, vec3 n, vec3 viewDir, PhysicalMaterial material) {
        ReflectedLight result = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
        for (int i = 0; i < ${MAX_LIGHTS}; i++) {
          if (i >= (previous ? hdOldCount : hdNewCount)) break;
          vec4 parameters = previous ? hdOldLightParameters[i] : hdNewLightParameters[i];
          vec3 position = previous ? hdOldLightPositions[i] : hdNewLightPositions[i];
          vec4 axis = previous ? hdOldLightAxes[i] : hdNewLightAxes[i];
          vec3 color = previous ? hdOldLightColors[i] : hdNewLightColors[i];
          vec3 delta = position - p; float distance = length(delta);
          vec3 direction = delta / max(distance, .000001);
          float falloff = 1.0 / max(pow(distance, parameters.y), .01);
          if (parameters.x > 0.0) falloff *= pow2(saturate(1.0 - pow4(distance / parameters.x)));
          if (parameters.z >= 0.0) falloff *= smoothstep(parameters.z, axis.w, dot(-direction, axis.xyz));
          if (falloff <= 0.0 || dot(n, direction) <= 0.0 || max3(color) <= 0.0) continue;
          vec3 origin; float visible = 1.0;
          if (parameters.w >= 0.0) {
            float index = ${INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS}.0 + parameters.w;
            // The endpoint exclusion in the exact visibility test prevents the
            // receiver from blocking itself, without normal-map displacements.
            visible = previous ? hdGIVisibilityFrom(hdOldPositions, hdOldDistances, hdOldLayout, index, p, origin)
              : hdGIVisibility(index, p, origin);
          }
          IncidentLight light; light.direction = direction; light.color = color * falloff * max(0.0, visible); light.visible = true;
          RE_Direct_Physical(light, p, n, viewDir, n, material, result);
        }
        return result.directDiffuse + result.directSpecular;
      }
      void main() {
        vec2 uv = (hdSurfaceOrigin + gl_FragCoord.xy) / hdSurfaceAtlas;
        vec3 base = texture2D(hdSurfaceRadiance, uv).rgb;
        vec4 finish = texture2D(hdSurfaceMaterial, uv);
        if (finish.a < .5) { gl_FragColor = vec4(base, 1.0); return; }
        vec2 pixel = gl_FragCoord.xy / ${layout.size}.0;
        float col = pixel.x * 2.0 - 1.0, row = 1.0 - pixel.y * 2.0;
        vec3 direction;
        if (hdSurfaceFace == 0) direction = vec3(1.0, row, -col);
        else if (hdSurfaceFace == 1) direction = vec3(-1.0, row, col);
        else if (hdSurfaceFace == 2) direction = vec3(col, 1.0, -row);
        else if (hdSurfaceFace == 3) direction = vec3(col, -1.0, row);
        else if (hdSurfaceFace == 4) direction = vec3(col, row, 1.0);
        else direction = vec3(-col, row, -1.0);
        float depth = texture2D(hdSurfaceDepth, uv).r;
        float distance = hdSurfaceClip.x * hdSurfaceClip.y /
          (hdSurfaceClip.y - depth * (hdSurfaceClip.y - hdSurfaceClip.x));
        vec3 p = hdSurfaceProbe + direction * distance;
        vec3 n = normalize(texture2D(hdSurfaceNormal, uv).xyz);
        vec3 viewDir = normalize(-direction);
        PhysicalMaterial material;
        material.diffuseColor = finish.rgb; material.metalness = finish.a - 1.0;
        material.diffuseContribution = finish.rgb * (1.0 - material.metalness);
        material.roughness = texture2D(hdSurfaceResponse, uv).a;
        material.specularColor = vec3(.04); material.specularF90 = 1.0;
        material.specularColorBlended = mix(material.specularColor, finish.rgb, material.metalness);
        vec3 before = hdLocalRadiance(true, p, n, viewDir, material);
        vec3 after = hdLocalRadiance(false, p, n, viewDir, material);
        gl_FragColor = vec4(max(base + after - before + hdSunRadiance(p, n, viewDir, material), vec3(0.0)), 1.0);
      }`,
  })
  scene.add(new Mesh(geometry, material))
  const releaseRecord = (probe: number) => {
    const record = records.get(probe)
    if (!record) return
    if (--record.visibility.users === 0) {
      record.visibility.release()
      for (const [key, value] of visibility) if (value === record.visibility) visibility.delete(key)
    }
    records.delete(probe)
  }
  const populate = (data: ReturnType<typeof bank>, lights: SurfaceLight[]) => lights.forEach((light, i) => {
    data.positions[i].fromArray(light.position); data.colors[i].fromArray(light.color)
    data.axes[i].set(...light.direction as [number, number, number], light.penumbra)
    data.parameters[i].set(light.distance, light.decay, light.cone, light.index)
  })
  return {
    clear() { for (const probe of records.keys()) releaseRecord(probe) },
    has: (probe: number) => records.has(probe),
    record(probe: number, lights: SurfaceLight[], near = .03, far = 80) {
      releaseRecord(probe)
      const positions = uniforms.hdGIPositions.value, distances = uniforms.hdGIDistances.value
      const key = positions.uuid + ':' + distances.uuid
      let data = visibility.get(key)
      if (!data) {
        const releasePositions = retainResource(positions), releaseDistances = retainResource(distances)
        data = { positions, distances, layout: uniforms.hdGIDistanceLayout.value.clone(), users: 0,
          release() { releasePositions(); releaseDistances() } }
        visibility.set(key, data)
      }
      data.users++; records.set(probe, { lights: structuredClone(lights), visibility: data, near, far })
      // Interrupted cold captures may span several lamp layouts. Bound retained
      // visibility atlases; evicted samples use a fresh ordinary capture.
      while (visibility.size > 4) {
        const oldest = visibility.values().next().value!
        for (const [index, record] of records) if (record.visibility === oldest) releaseRecord(index)
      }
    },
    compile() { return renderer.compileAsync(scene, camera) },
    async read(probe: number, position: number[], lights: SurfaceLight[], captured?: () => void, sun?: DirectionalLight, sunStrength = 1) {
      const record = records.get(probe)
      if (!record) throw new Error('Missing surface lighting baseline')
      populate(old, record.lights); populate(current, lights)
      material.uniforms.hdOldCount.value = record.lights.length; material.uniforms.hdNewCount.value = lights.length
      material.uniforms.hdOldPositions.value = record.visibility.positions; material.uniforms.hdOldDistances.value = record.visibility.distances
      material.uniforms.hdOldLayout.value.copy(record.visibility.layout)
      material.uniforms.hdSurfaceClip.value.set(record.near, record.far)
      material.uniforms.hdSurfaceProbe.value.fromArray(position)
      material.uniforms.hdSunColor.value.set(0, 0, 0)
      material.uniforms.hdSunShadow.value.set(0, 0, 0, 0)
      material.uniforms.hdSunMap.value = emptySunShadow
      if (sun) {
        sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false)
        material.uniforms.hdSunDirection.value.setFromMatrixPosition(sun.matrixWorld)
          .sub(new Vector3().setFromMatrixPosition(sun.target.matrixWorld)).normalize()
        if (sun.visible) material.uniforms.hdSunColor.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity * sunStrength)
        const shadow = sun.shadow
        if (renderer.shadowMap.enabled && sun.castShadow && shadow.map) {
          material.uniforms.hdSunMap.value = vsm ? shadow.map.texture : shadow.map.depthTexture
          material.uniforms.hdSunMatrix.value.copy(shadow.matrix)
          material.uniforms.hdSunMapSize.value.copy(shadow.mapSize)
          material.uniforms.hdSunShadow.value.set(shadow.intensity, shadow.bias, shadow.normalBias, shadow.radius)
        }
      }
      const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
      const autoClear = renderer.autoClear, stats = { ...renderer.info.render }
      let result: ReturnType<typeof integrator.read>
      try {
        renderer.autoClear = true
        for (let face = 0; face < 6; face++) {
          material.uniforms.hdSurfaceOrigin.value.set(...layout.tile(probe, face))
          material.uniforms.hdSurfaceFace.value = face; material.uniformsNeedUpdate = true
          renderer.setRenderTarget(cube, face); renderer.render(scene, camera)
        }
        captured?.()
        renderer.setRenderTarget(null)
        result = integrator.read(renderer, cube)
      } finally {
        renderer.setRenderTarget(target, face, mip); renderer.autoClear = autoClear; Object.assign(renderer.info.render, stats)
      }
      return await result
    },
    dispose() { for (const probe of records.keys()) releaseRecord(probe); geometry.dispose(); material.dispose(); emptySunShadow?.dispose() },
  }
}
