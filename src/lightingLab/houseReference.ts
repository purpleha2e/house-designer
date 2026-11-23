import { ACESFilmicToneMapping, DataTexture, FloatType, PerspectiveCamera, RGBAFormat, ShaderMaterial, WebGLRenderer, type Texture } from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import type { HouseInput, HouseSnapshot } from './houseBridge'
import { createHouseReferenceScene } from './houseReferenceScene'
import { captureDenoiseGuides } from './houseDenoiseGuides'
import type { HouseDenoiser } from './houseDenoiser'

export type ReferenceOptions = { diffuse: boolean; samples: number; bounces: number; width?: number; textureSize?: number; denoise?: boolean }

/** Deliberately slow, independent renderer. The linear target is retained for
 * measurement; display exposure and tone mapping never enter its transport. */
export class HouseReference {
  readonly renderer: WebGLRenderer
  readonly tracer: WebGLPathTracer
  readonly camera: PerspectiveCamera
  private readonly source: ReturnType<typeof createHouseReferenceScene>
  private animation = 0
  private disposed = false
  private ready = false
  private phase: 'preparing' | 'rendering' | 'denoising' | 'complete' | 'error' | 'cancelled' = 'preparing'
  private failure?: string
  private denoiser?: HouseDenoiser
  private denoised?: DataTexture
  private outputQuad?: FullScreenQuad
  private outputMaterial?: ShaderMaterial
  private rawDisplayed = true
  private denoiseSeconds = 0
  private filteredPixels = 0
  private elapsedSeconds = 0
  private started = performance.now()
  private readonly input: HouseInput
  private readonly options: ReferenceOptions
  private readonly status: (message: string) => void
  private readonly exterior: boolean

  constructor(host: HTMLElement, snapshot: HouseSnapshot, input: HouseInput, camera: PerspectiveCamera,
    exposure: number, options: ReferenceOptions, status: (message: string) => void) {
    this.options = options; this.status = status; this.input = structuredClone(input)
    this.exterior = !!snapshot.exterior
    this.camera = camera.clone()
    this.renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = exposure
    const width = options.width ?? Math.min(640, host.clientWidth), height = Math.round(width / camera.aspect)
    this.renderer.setPixelRatio(1); this.renderer.setSize(width, height, false)
    this.renderer.domElement.className = 'reference-canvas'; this.renderer.domElement.setAttribute('aria-label', 'Path-traced lighting reference')
    host.append(this.renderer.domElement)
    this.source = createHouseReferenceScene(snapshot, this.input, options.diffuse)
    this.tracer = new WebGLPathTracer(this.renderer)
    this.tracer.bounces = options.bounces; this.tracer.transmissiveBounces = options.bounces
    this.tracer.multipleImportanceSampling = true; this.tracer.filterGlossyFactor = 0
    this.tracer.textureSize.setScalar(options.textureSize ?? 512)
    this.tracer.tiles.set(3, 3); this.tracer.rasterizeScene = false; this.tracer.dynamicLowRes = false
    this.tracer.renderDelay = 0; this.tracer.fadeDuration = 0; this.tracer.minSamples = 1
  }

  async start() {
    if (this.options.denoise) {
      this.status('Preparing local HQ denoiser…')
      const { HouseDenoiser } = await import('./houseDenoiser')
      if (this.disposed) return
      this.denoiser = new HouseDenoiser()
      await this.denoiser.initialize()
      if (this.disposed) return
    }
    this.status('Building the full reference scene…')
    // Let the preparing message paint before the independent BVH build.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (this.disposed) return
    this.tracer.setScene(this.source.scene, this.camera, {
      onProgress: progress => { if (!this.disposed) this.status(`Building reference geometry · ${Math.round(progress * 100)}%`) },
    })
    if (this.disposed) return
    this.ready = true; this.phase = 'rendering'
    const tick = () => {
      if (this.disposed) return
      try {
        if (this.renderer.getContext().isContextLost()) throw Error('The rendering GPU context was lost')
        if (!document.hidden && this.tracer.samples < this.options.samples) this.tracer.renderSample()
        const samples = Math.floor(this.tracer.samples)
        if (samples >= this.options.samples) {
          void this.finish().catch(error => this.fail(error))
          return
        }
        this.status(samples === 0 ? 'Compiling reference shaders…'
          : `Rendering reference · ${samples.toLocaleString()} / ${this.options.samples.toLocaleString()} samples/pixel`)
        this.animation = requestAnimationFrame(tick)
      } catch (error) { this.fail(error) }
    }
    this.animation = requestAnimationFrame(tick)
  }

  private fail(error: unknown) {
    if (this.disposed) return
    this.failure = error instanceof Error ? error.message : String(error); this.phase = 'error'
    this.denoiser?.dispose(); this.denoiser = undefined
    this.status(`Render failed: ${this.failure}${this.tracer.samples >= this.options.samples ? '. The raw render can still be saved.' : ''}`)
  }

  private async finish() {
    if (this.denoiser) {
      this.phase = 'denoising'; const started = performance.now()
      this.status('Finishing HQ image · capturing surface detail…')
      const { width, height, values } = await this.pixels()
      const guides = await captureDenoiseGuides(this.renderer, this.source.scene, this.camera, width, height)
      if (this.disposed) return
      const clean = await this.denoiser.denoise(values, guides.albedo, guides.normal, width, height,
        fraction => { if (!this.disposed) this.status(`Finishing HQ image · denoising ${Math.min(100, Math.round(fraction * 100))}%`) })
      if (this.disposed) return
      this.denoised = new DataTexture(clean, width, height, RGBAFormat, FloatType)
      this.denoised.needsUpdate = true
      this.denoiseSeconds = (performance.now() - started) / 1000
      this.filteredPixels = this.denoiser.filteredPixels
      this.denoiser.dispose(); this.denoiser = undefined
      this.showRaw(false)
    }
    if (this.disposed) return
    this.phase = 'complete'; this.elapsedSeconds = (performance.now() - this.started) / 1000
    this.status(`${this.denoised ? 'HQ render complete · denoised' : 'Raw reference complete'} · ${Math.floor(this.tracer.samples).toLocaleString()} samples/pixel`)
  }

  get hasDenoisedImage() { return !!this.denoised }
  get showingRaw() { return this.rawDisplayed }
  get canSave() { return this.phase === 'complete' || (this.phase === 'error' && this.tracer.samples >= this.options.samples) }
  showRaw(raw: boolean) {
    if (this.disposed) return
    if (!raw && !this.denoised) throw Error('The denoised image is not ready')
    const texture: Texture = raw ? this.tracer.target.texture : this.denoised!
    if (!this.outputMaterial) {
      this.outputMaterial = new ShaderMaterial({
        uniforms: { image: { value: texture } }, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 imageUV;void main(){imageUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: `uniform sampler2D image;varying vec2 imageUV;
          void main(){gl_FragColor=vec4(texture2D(image,imageUV).rgb,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      })
      this.outputQuad = new FullScreenQuad(this.outputMaterial)
    }
    this.outputMaterial.uniforms.image.value = texture
    this.renderer.setRenderTarget(null); this.outputQuad!.render(this.renderer); this.rawDisplayed = raw
  }

  stats() {
    return { renderer: 'three-gpu-pathtracer 0.0.24', samples: this.tracer.samples, targetSamples: this.options.samples,
      bounces: this.options.bounces, materials: this.options.diffuse ? 'Diffuse comparison' : 'Authored PBR',
      triangles: this.source.triangles, windowEmitterTriangles: this.source.windowEmitterTriangles,
      textures: this.source.textureCount, textureResolution: this.tracer.textureSize.x,
      width: this.renderer.domElement.width, height: this.renderer.domElement.height,
      exposure: this.renderer.toneMappingExposure, toneMapping: 'ACESFilmic', elapsedSeconds: this.elapsedSeconds || (performance.now() - this.started) / 1000,
      phase: this.phase, error: this.failure, denoising: { requested: !!this.options.denoise, complete: !!this.denoised,
        method: this.options.denoise ? 'OIDN HDR with clean albedo and normal guides, oidn-webgpu 0.6.0' : 'None', seconds: this.denoiseSeconds,
        isolatedFirefliesFiltered: this.filteredPixels },
      displayedImage: this.rawDisplayed ? 'raw' : 'denoised',
      camera: { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray(), fov: this.camera.fov, aspect: this.camera.aspect },
      input: this.input, exteriorView: this.exterior, limitations: ['Uniform prototype sky supplies indirect lighting; the designer background supplies the visible distant view. Not calibrated real-world weather.',
        'Surface meshes block and reflect on both sides; raster face culling is not treated as a physical opening.',
        'Emissive windows use unbiased path hits, not explicit light sampling. Environment and analytic lights use MIS.',
        'Textures resampled to the recorded resolution; no surface-lighting atlas.',
        this.exterior ? 'Clear glazing uses thin glass, IOR 1.5; original frames, leaves and exterior geometry occlude light. Designer sun is retained.' : 'Clear glazing follows the prototype opening/emitter model; glass refraction is not compared.',
        'Finite sample and bounce limits; no glossy filtering. Final-image denoising includes isolated HDR outlier suppression and can soften fine detail; use the unfiltered raw comparison and linear HDR for validation.'] }
  }

  async pixels() {
    if (!this.ready || this.tracer.samples < 1) throw Error('Wait for a complete reference sample')
    const target = this.tracer.target, values = new Float32Array(target.width * target.height * 4)
    await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, values)
    return { width: target.width, height: target.height, values }
  }

  async measure(x: number, y: number, radius = 2) {
    const { width, height, values } = await this.pixels()
    const px = Math.floor((x + 1) * .5 * width), py = Math.floor((y + 1) * .5 * height), rgb = [0, 0, 0]
    let count = 0
    for (let row = Math.max(0, py - radius); row <= Math.min(height - 1, py + radius); row++)
      for (let col = Math.max(0, px - radius); col <= Math.min(width - 1, px + radius); col++) {
        const at = (row * width + col) * 4
        for (let c = 0; c < 3; c++) rgb[c] += values[at + c]
        count++
      }
    return rgb.map(v => v / Math.max(1, count))
  }

  dispose() {
    this.disposed = true; this.phase = 'cancelled'; cancelAnimationFrame(this.animation)
    this.denoiser?.dispose(); this.denoised?.dispose(); this.outputQuad?.dispose(); this.outputMaterial?.dispose()
    this.tracer.dispose(); this.source.dispose(); this.renderer.dispose(); this.renderer.domElement.remove()
  }
}
