import { BackSide, Color, DataTexture, FloatType, Matrix4, MeshDepthMaterial, NearestFilter,
  PerspectiveCamera, RGBAFormat, RGBADepthPacking, UnsignedByteType, Vector2, Vector3,
  WebGLRenderTarget, type Scene, type Side, type WebGLRenderer } from 'three'

export type AtlasLight = { id: string; kind: 'point' | 'spot'; position: number[]; target: number[]; distance: number; angle: number }
const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
const ups = [[0,-1,0],[0,-1,0],[0,0,1],[0,0,-1],[0,-1,0],[0,-1,0]]

/** Frozen atlas geometry has only three sidedness variants. Keep their exact
 * materials alive between geometry snapshots so Three retains linked programs. */
export function createLocalShadowDepthMaterials() {
  const materials = new Map<Side, MeshDepthMaterial>()
  return {
    get(side: Side) {
      let material = materials.get(side)
      if (!material) { material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side }); materials.set(side, material) }
      return material
    },
    dispose() { materials.forEach(material => material.dispose()); materials.clear() },
  }
}

/** One padded tile per projection, six for an omnidirectional lamp. Limit the
 * atlas allocation, not the number of lights receiving persistent shadows. */
export function localShadowAtlasLayout(faces: number, maxTextureSize: number, preferredTile = 512) {
  const columns = Math.ceil(Math.sqrt(Math.max(1, faces))), rows = Math.ceil(Math.max(1, faces) / columns)
  const pitch = Math.min(preferredTile + 2, Math.floor(maxTextureSize / Math.max(columns, rows)),
    Math.floor(Math.sqrt(48 * 1024 * 1024 / (columns * rows))))
  if (pitch < 18) throw new Error('GPU texture size is too small for the local shadow atlas')
  return { columns, rows, tile: pitch - 2, pitch, width: columns * pitch, height: rows * pitch }
}

export function localShadowCamera(light: AtlasLight, face: number) {
  const camera = new PerspectiveCamera(light.kind === 'point' ? 90 : light.angle * 360 / Math.PI, 1, .05, Math.max(.1, light.distance))
  camera.position.fromArray(light.position)
  if (light.kind === 'point') {
    camera.up.fromArray(ups[face]); camera.lookAt(new Vector3().fromArray(light.position).add(new Vector3().fromArray(directions[face])))
  } else { camera.up.set(0, 0, -1); camera.lookAt(new Vector3().fromArray(light.target)) }
  camera.updateMatrixWorld(true)
  return camera
}

export function createLocalShadowAtlasUniforms() {
  const empty = new DataTexture(new Uint8Array([255,255,255,255]), 1, 1, RGBAFormat, UnsignedByteType)
  empty.needsUpdate = true
  return {
    hdLocalShadowAtlas: { value: empty as WebGLRenderTarget['texture'] },
    hdLocalShadowData: { value: empty as DataTexture },
    hdLocalShadowAtlasSize: { value: new Vector2(1, 1) },
    hdLocalShadowDataRows: { value: 1 },
    hdLocalShadowAtlasEnabled: { value: 0 },
    hdLocalShadowAtlasRequested: { value: 1 },
    hdLocalShadowRasterSteps: { value: 256 },
  }
}
export type LocalShadowAtlasUniforms = ReturnType<typeof createLocalShadowAtlasUniforms>

/** Owned, immutable shadow data. Build incrementally; publish only after every
 * face is complete. No camera-dependent eviction or per-frame shadow renders. */
export function createLocalShadowAtlas(lights: readonly AtlasLight[], maxTextureSize: number, tile = 512) {
  const faceCount = lights.reduce((n, light) => n + (light.kind === 'point' ? 6 : 1), 0)
  const layout = localShadowAtlasLayout(faceCount, maxTextureSize, tile)
  const target = new WebGLRenderTarget(layout.width, layout.height, {
    minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true, stencilBuffer: false,
    generateMipmaps: false, format: RGBAFormat, type: UnsignedByteType,
  })
  target.texture.name = 'local-shadow-atlas'
  const data = new Float32Array(Math.max(1, lights.length * 6) * 8 * 4)
  const metadata = new DataTexture(data, 8, Math.max(1, lights.length * 6), RGBAFormat, FloatType)
  metadata.minFilter = metadata.magFilter = NearestFilter; metadata.needsUpdate = true
  const jobs: { camera: PerspectiveCamera; x: number; y: number }[] = []
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i]
    for (let face = 0; face < (light.kind === 'point' ? 6 : 1); face++) {
      const camera = localShadowCamera(light, face), address = (i * 6 + face) * 32
      const x = (jobs.length % layout.columns) * layout.pitch + 1, y = Math.floor(jobs.length / layout.columns) * layout.pitch + 1
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray(data, address)
      data.set([x / layout.width, y / layout.height, layout.tile / layout.width, layout.tile / layout.height], address + 16)
      data.set([...light.position, light.kind === 'point' ? 1 : 0], address + 20)
      jobs.push({ camera, x, y })
    }
  }
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: BackSide })
  let completed = 0
  return {
    target, metadata, layout, faceCount,
    get completed() { return completed },
    renderNext(renderer: WebGLRenderer, scene: Scene, useSceneDepthMaterials = false) {
      const job = jobs[completed]
      if (!job) return false
      const previous = { target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
        autoClear: renderer.autoClear, shadows: renderer.shadowMap.enabled, xr: renderer.xr.enabled,
        color: renderer.getClearColor(new Color()), alpha: renderer.getClearAlpha(), override: scene.overrideMaterial,
        stats: { ...renderer.info.render } }
      try {
        renderer.xr.enabled = false; renderer.shadowMap.enabled = false; renderer.autoClear = false
        scene.overrideMaterial = useSceneDepthMaterials ? null : material
        // Render-target rectangles use physical pixels. The renderer setters
        // instead multiply by display DPR, corrupting tile placement at 125%,
        // Retina, or an adaptive display scale. Do not mutate display state.
        target.viewport.set(job.x, job.y, layout.tile, layout.tile)
        target.scissor.set(job.x - 1, job.y - 1, layout.pitch, layout.pitch)
        target.scissorTest = true
        renderer.setRenderTarget(target)
        renderer.setClearColor(0xffffff, 1); renderer.clear(true, true, false)
        renderer.render(scene, job.camera)
        completed++
      } finally {
        scene.overrideMaterial = previous.override
        renderer.setRenderTarget(previous.target, previous.cube, previous.mip)
        renderer.setClearColor(previous.color, previous.alpha); renderer.autoClear = previous.autoClear
        renderer.shadowMap.enabled = previous.shadows; renderer.xr.enabled = previous.xr
        Object.assign(renderer.info.render, previous.stats)
      }
      return completed < jobs.length
    },
    dispose() { target.dispose(); metadata.dispose(); material.dispose() },
  }
}

export const localShadowAtlasGLSL = /* glsl */ `
uniform sampler2D hdLocalShadowAtlas;
uniform sampler2D hdLocalShadowData;
uniform vec2 hdLocalShadowAtlasSize;
uniform float hdLocalShadowDataRows;
uniform float hdLocalShadowAtlasEnabled;
uniform float hdLocalShadowRasterSteps;
uniform float hdPointAtlasIds[HD_ROOM_LIGHT_CAPACITY];
uniform float hdSpotAtlasIds[HD_ROOM_LIGHT_CAPACITY];
vec4 hdShadowRecord(float row, float column) {
  return texture2D(hdLocalShadowData, vec2((column + .5) / 8.0, (row + .5) / hdLocalShadowDataRows));
}
float hdLocalAtlasVisibility(float index, vec3 receiver, vec3 worldNormal) {
  if (hdLocalShadowAtlasEnabled < .5 || index < 0.0) return -1.0;
  float row = index * 6.0;
  vec4 source = hdShadowRecord(row, 5.0);
  // Select and project the same biased position. Selecting the original
  // position can choose the neighbouring cube face, turning a thin strip at
  // every boundary fully lit when its biased projection falls outside [0,1].
  vec3 offsetReceiver = receiver + worldNormal * .004;
  vec3 direction = offsetReceiver - source.xyz, a = abs(direction);
  if (source.w > .5) {
    if (a.x >= a.y && a.x >= a.z) row += direction.x >= 0.0 ? 0.0 : 1.0;
    else if (a.y >= a.z) row += direction.y >= 0.0 ? 2.0 : 3.0;
    else row += direction.z >= 0.0 ? 4.0 : 5.0;
  }
  mat4 projection = mat4(hdShadowRecord(row, 0.0), hdShadowRecord(row, 1.0), hdShadowRecord(row, 2.0), hdShadowRecord(row, 3.0));
  vec4 projected = projection * vec4(offsetReceiver, 1.0);
  if (projected.w <= 0.0) return 1.0;
  vec3 coord = projected.xyz / projected.w * .5 + .5;
  if (coord.z < 0.0 || coord.z > 1.0) return 1.0;
  // A dominant-axis point projection is always inside its cube face; clamp
  // floating-point roundoff at exact edges instead of treating it as missing
  // shadow coverage. Spotlights still need their actual frustum bounds checked.
  if (source.w < .5 && (any(lessThan(coord.xy, vec2(0.0))) || any(greaterThan(coord.xy, vec2(1.0))))) return 1.0;
  coord.xy = clamp(coord.xy, vec2(0.0), vec2(1.0));
  vec4 tile = hdShadowRecord(row, 4.0);
  vec2 size = tile.zw * hdLocalShadowAtlasSize;
  // Analytic receiver-plane depth: screen derivatives inside the per-light
  // branch are undefined, and cube-face changes introduce discontinuities.
  // Use the actual triangle plane, not the interpolated furniture normal.
  vec3 axisX = vec3(projection[0].x, projection[1].x, projection[2].x);
  vec3 axisY = vec3(projection[0].y, projection[1].y, projection[2].y);
  float planeDistance = dot(worldNormal, offsetReceiver - source.xyz);
  float sourceDepth = (projection * vec4(source.xyz, 1.0)).z;
  vec2 gradient = abs(planeDistance) > 1e-6 ? sourceDepth / planeDistance *
    vec2(dot(worldNormal, axisX) / dot(axisX, axisX), dot(worldNormal, axisY) / dot(axisY, axisY)) : vec2(0.0);
  float rasterBias = .0000005 + dot(abs(gradient), 1.0 / size) / max(16.0, hdLocalShadowRasterSteps);
  float visibility = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 tap = clamp(floor(coord.xy * size) + vec2(float(x), float(y)) + .5, vec2(.5), size - .5) / size;
    float reference = coord.z + dot(gradient, tap - coord.xy) - rasterBias;
    vec4 packed = texture2D(hdLocalShadowAtlas, tile.xy + tap * tile.zw);
    float depth = dot(packed, vec4(255.0/256.0, 255.0/65536.0, 255.0/16777216.0, 1.0/16777216.0));
    visibility += reference < 0.0 || reference > 1.0 ? 1.0 : step(reference, depth);
  }
  return visibility / 9.0;
}
`
