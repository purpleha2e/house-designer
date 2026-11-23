import { DataTexture, DataUtils, FloatType, HalfFloatType, LinearFilter, Mesh, NearestFilter, NoBlending,
  OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGL3DRenderTarget, WebGLRenderTarget,
  type WebGLRenderer } from 'three'
import { INDIRECT_ATLAS_SIZE, type IndirectField } from './indirectLighting.ts'
import { createIndirectPreviewField } from './indirectLivePreview.ts'
import { INDIRECT_VOLUME_HEIGHT, INDIRECT_VOLUME_STRIDE, type IndirectInterpolationGraph } from './indirectVolume.ts'

export type IndirectGpuPreviewGraph = { volume: IndirectInterpolationGraph; floor: IndirectInterpolationGraph }

function texture(data: Float32Array, width: number, height: number) {
  const result = new DataTexture(data, width, height, RGBAFormat, FloatType)
  result.minFilter = result.magFilter = NearestFilter; result.generateMipmaps = false; result.needsUpdate = true
  return result
}
function graphTextures(graph: IndirectInterpolationGraph, n: number, sizeLimit: number) {
  const headers = new Float32Array(graph.offsets.length * 4)
  graph.offsets.forEach((offset, i) => { headers[i * 4] = offset; headers[i * 4 + 1] = graph.counts[i] })
  const preferred = Math.max(1024, Math.ceil(graph.indices.length / sizeLimit))
  const width = Math.min(sizeLimit, preferred, Math.max(1, graph.indices.length)), height = Math.max(1, Math.ceil(graph.indices.length / width))
  const links = new Float32Array(width * height * 4)
  graph.indices.forEach((index, i) => { links[i * 4] = index; links[i * 4 + 1] = graph.weights[i];links[i*4+2]=graph.supports?.[i]??graph.weights[i] })
  graph.supportOverrides?.indices.forEach((index,i)=>{links[index*4+2]=graph.supportOverrides!.weights[i]})
  return { headers: texture(headers, n, graph.offsets.length / n), links: texture(links, width, height) }
}

/** The display-only path never reads pixels or replaces the authoritative CPU bake.
 * Its interpolation links come from the bake's exact segment visibility tests. */
export function createIndirectGpuPreview(renderer: WebGLRenderer, source: IndirectField, graph: IndirectGpuPreviewGraph,
  mode: 'relight' | 'coefficients' = 'relight') {
  if (source.shOrder !== 1) throw new Error('The optional legacy GPU preview supports L1 fields only')
  const coefficientsOnly = mode === 'coefficients'
  const field = coefficientsOnly
    ? { ...source, volume: { ...source.volume, maps: source.volume.maps.slice() }, floorLayer: { ...source.floorLayer } }
    : createIndirectPreviewField(source)
  const count = INDIRECT_ATLAS_SIZE ** 2
  if (graph.volume.offsets.length !== field.volume.n ** 2 * source.floors.length * INDIRECT_VOLUME_HEIGHT ||
    graph.floor.offsets.length !== field.floorLayer.n ** 2 * source.floors.length)
    throw new Error('GPU interpolation weights do not match the field layout')
  const sizeLimit = renderer.capabilities.maxTextureSize
  for (const [layer, links] of [[field.volume, graph.volume], [field.floorLayer, graph.floor]] as const) {
    if (links.offsets.length / layer.n > sizeLimit || links.indices.length > sizeLimit ** 2 || count > sizeLimit)
      throw new Error('GPU interpolation weights exceed device texture limits')
  }
  const localSupport=source.spatialInterpolation==='occluder-local'||source.probes.some(p=>p.kind==='contact')
  const current = new WebGLRenderTarget(4, count, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false })
  current.texture.minFilter = current.texture.magFilter = NearestFilter
  const oldData = new Float32Array(count * 16), finalData = new Float32Array(count * 16)
  const old = texture(oldData, 4, count), final = texture(finalData, 4, count)
  const volume = graphTextures(graph.volume, field.volume.n, sizeLimit), floor = graphTextures(graph.floor, field.floorLayer.n, sizeLimit)
  const geometry = new PlaneGeometry(2, 2), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, blending: NoBlending,
    uniforms: { current: { value: current.texture }, previous: { value: old }, final: { value: final },
      headers: { value: volume.headers }, links: { value: volume.links }, n: { value: field.volume.n },
      height: { value: field.volume.height }, z: { value: 0 }, isFloor: { value: false } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D current, previous, final, headers, links;
      uniform int n, height, z;
      uniform bool isFloor;
      void main() {
        ivec2 pixel = ivec2(gl_FragCoord.xy);
        int slab = pixel.y;
        int coefficient = slab / height, row = slab % height;
        int floorIndex = isFloor ? row : row / ${INDIRECT_VOLUME_STRIDE};
        int iy = clamp(row % ${INDIRECT_VOLUME_STRIDE} - 1, 0, ${INDIRECT_VOLUME_HEIGHT - 1});
        int voxelRow = isFloor ? floorIndex * n + z : (floorIndex * n + z) * ${INDIRECT_VOLUME_HEIGHT} + iy;
        vec2 header = texelFetch(headers, ivec2(pixel.x, voxelRow), 0).rg;
        int width = textureSize(links, 0).x;
        vec3 sum = vec3(0.0); float support = 0.0;${localSupport?'float total=0.0;':''}
        for (int i = 0; i < int(header.y); i++) {
          int address = int(header.x) + i;
          ${localSupport?'vec3':'vec2'} link = texelFetch(links, ivec2(address % width, address / width), 0).${localSupport?'rgb':'rg'};
          ivec2 p = ivec2(coefficient, int(link.x));
          vec4 before = texelFetch(final, p, 0);
          ${coefficientsOnly ? `
          if (before.a < .5) continue;
          vec3 light = before.rgb;` : `
          vec4 direct = texelFetch(current, p, 0);
          vec4 baseline = texelFetch(previous, p, 0);
          if (before.a < .5 && direct.a < .5) continue;
          vec3 light = direct.a > .5 ? before.rgb + direct.rgb - baseline.rgb : before.rgb;`}
          sum += light * link.y; support += link.${localSupport?'z':'y'};${localSupport?'total+=link.y;':''}
        }
        float confidence = isFloor ? min(1.0, support / .1) : 1.0;
        gl_FragColor = vec4(support > 0.0 ? sum * confidence / ${localSupport?'max(total,1.e-30)':'support'} : vec3(0.0), support > 0.0 ? 1.0 : 0.0);
      }`,
  })
  scene.add(new Mesh(geometry, material))
  const makeTarget = (n: number, height: number) => new WebGL3DRenderTarget(n, height * 4, n,
    { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter })
  const volumeTarget = makeTarget(field.volume.n, field.volume.height), floorTarget = makeTarget(field.floorLayer.n, field.floorLayer.height)
  if (!coefficientsOnly) { field.volume.maps[0].dispose(); field.floorLayer.texture.dispose() }
  field.volume.maps[0] = volumeTarget.texture; field.floorLayer.texture = floorTarget.texture
  // Targets belong to the display field: an old view may remain visible while
  // its relighting resources are retired for replacement geometry.
  field.dispose = () => { volumeTarget.dispose(); floorTarget.dispose() }
  const context = renderer.getContext() as WebGL2RenderingContext
  const timer = context.getExtension('EXT_disjoint_timer_query_webgl2')
  let query: WebGLQuery | null = null, measuring = false, batchSize = 4, lastMs = 0, disposed = false, initialized = false
  const pollTimer = () => {
    if (!query) return true
    if (!context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) return false
    if (!context.getParameter(timer!.GPU_DISJOINT_EXT)) {
      lastMs = context.getQueryParameter(query, context.QUERY_RESULT) / 1e6
      batchSize = Math.max(1, Math.min(16, Math.round(batchSize * Math.min(1.5, 2 / Math.max(.1, lastMs)))))
    }
    context.deleteQuery(query); query = null
    return true
  }
  const preserve = <T>(action: () => T) => {
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
    const autoClear = renderer.autoClear, stats = { ...renderer.info.render }
    try { renderer.autoClear = false; return action() }
    finally { renderer.setRenderTarget(target, face, mip); renderer.autoClear = autoClear; Object.assign(renderer.info.render, stats) }
  }
  return { field, coefficients: current,
    get batchSize() { return batchSize }, get gpuMs() { return lastMs },
    pollTimer,
    /** A pending GPU measurement also bounds the amount of queued GPU work. */
    begin() {
      if (!pollTimer()) return false
      if (timer && !context.getQuery(timer.TIME_ELAPSED_EXT, context.CURRENT_QUERY)) {
        query = context.createQuery(); context.beginQuery(timer.TIME_ELAPSED_EXT, query); measuring = true
      }
      return true
    },
    end() { if (measuring) { context.endQuery(timer!.TIME_ELAPSED_EXT); measuring = false } },
    setCoefficients(values: Float32Array, indices: ArrayLike<number>, positions: Float32Array) {
      if (!coefficientsOnly || values.length !== indices.length * 12 || positions.length !== source.positionData.length)
        throw new Error('Invalid absolute GPU probe coefficients')
      finalData.fill(0)
      for (let i = 0; i < indices.length; i++) {
        const probe = indices[i]
        if (!Number.isInteger(probe) || probe < 0 || probe >= count) throw new Error('Probe index exceeds the GI atlas')
        if (positions[probe * 4 + 3] < .5) continue
        for (let k = 0; k < 4; k++) {
          const src = i * 12 + k * 3, dst = probe * 16 + k * 4
          if (!Number.isFinite(values[src]) || !Number.isFinite(values[src + 1]) || !Number.isFinite(values[src + 2]))
            throw new Error('Nonfinite absolute GPU probe coefficients')
          finalData[dst] = values[src]
          finalData[dst + 1] = values[src + 1]
          finalData[dst + 2] = values[src + 2]
          finalData[dst + 3] = 1
        }
      }
      final.needsUpdate = true
    },
    seed(direct: Uint16Array[], settled: Uint16Array[], positions: Float32Array) {
      if (coefficientsOnly) throw new Error('Absolute GPU fields use setCoefficients')
      initialized = false
      oldData.fill(0); finalData.fill(0)
      for (const probe of source.probes) for (let coefficient = 0; coefficient < 4; coefficient++) {
        const src = probe.index * 4 + coefficient, dst = probe.index * 16 + coefficient * 4
        for (let colour = 0; colour < 3; colour++) {
          oldData[dst + colour] = DataUtils.fromHalfFloat(direct[colour][src])
          finalData[dst + colour] = DataUtils.fromHalfFloat(settled[colour][src])
        }
        oldData[dst + 3] = finalData[dst + 3] = positions[probe.index * 4 + 3]
      }
      old.needsUpdate = final.needsUpdate = true
      preserve(() => {
        current.viewport.set(0, 0, 4, count); current.scissor.set(0, 0, 4, count)
        renderer.setRenderTarget(current); context.clearBufferfv(context.COLOR, 0, new Float32Array(4))
      })
    },
    async compile() {
      return preserve(() => { renderer.setRenderTarget(volumeTarget); return renderer.compileAsync(scene, camera) })
    },
    publish(changed?: readonly number[]) {
      preserve(() => {
        for (const [layer, tables, target, isFloor] of [
          [field.volume, volume, volumeTarget, false], [field.floorLayer, floor, floorTarget, true],
        ] as const) {
          material.uniforms.headers.value = tables.headers; material.uniforms.links.value = tables.links
          material.uniforms.n.value = layer.n; material.uniforms.height.value = layer.height; material.uniforms.isFloor.value = isFloor
          let minX = 0, maxX = layer.n - 1, minZ = 0, maxZ = layer.n - 1
          if (initialized && changed?.length) {
            minX = minZ = layer.n - 1; maxX = maxZ = 0
            const radius = source.spacing * 1.75, scale = (layer.n - 1) / source.bounds.size
            for (const index of changed) {
              const x = source.positionData[index * 4] - source.bounds.minX, z = source.positionData[index * 4 + 2] - source.bounds.minZ
              minX = Math.min(minX, Math.max(0, Math.floor((x - radius) * scale)))
              maxX = Math.max(maxX, Math.min(layer.n - 1, Math.ceil((x + radius) * scale)))
              minZ = Math.min(minZ, Math.max(0, Math.floor((z - radius) * scale)))
              maxZ = Math.max(maxZ, Math.min(layer.n - 1, Math.ceil((z + radius) * scale)))
            }
          }
          target.scissorTest = true; target.scissor.set(minX, 0, maxX - minX + 1, layer.height * 4)
          // Render directly into each 3D slice; copying a 2D staging atlas into
          // a 3D texture caused expensive driver copies on integrated GPUs.
          for (let z = minZ; z <= maxZ; z++) {
            material.uniforms.z.value = z
            renderer.setRenderTarget(target, z); renderer.render(scene, camera)
          }
        }
      })
      initialized = true
      field.floorLayer.ready = true
    },
    /** The parent owns field disposal so a retained display can outlive this pipeline. */
    dispose() {
      if (disposed) return
      disposed = true
      if (measuring) context.endQuery(timer!.TIME_ELAPSED_EXT)
      if (query) context.deleteQuery(query)
      current.dispose(); old.dispose(); final.dispose()
      volume.headers.dispose(); volume.links.dispose(); floor.headers.dispose(); floor.links.dispose()
      material.dispose(); geometry.dispose()
    },
  }
}
