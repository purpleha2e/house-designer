import {
  ACESFilmicToneMapping, Color, DataTexture, DataUtils, FloatType, HalfFloatType, LinearFilter,
  Matrix4, Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, SphereGeometry, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import { cabinetCentre, COLUMNS, createCards, MAX_CARDS, TILE } from './scene'
import { bounceFragment, directFragment, filterFragment, fullscreenVertex, surfaceFragment, surfaceVertex } from './shaders'
import { labHistoryBlend } from './calibration'

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
type GpuSample = { kind: 'lighting' | 'frame'; ms: number; tiles: number }
const percentile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : null
export const rugColours = { neutral: [.62, .59, .52], red: [.68, .035, .025], blue: [.035, .12, .64] } as const

export class LightingLab {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(65, 1, .04, 50)
  readonly geometry = createCards()
  readonly cabinet = cabinetCentre.clone()
  readonly settings = { lamps: [true, true], rug: 'red' as keyof typeof rugColours, daylight: true, indirect: true }
  readonly cardPixels = new Float32Array(MAX_CARDS * 16)
  readonly cardTexture = new DataTexture(this.cardPixels, 4, MAX_CARDS, RGBAFormat, FloatType)
  readonly width = COLUMNS * TILE
  readonly height = Math.ceil(this.geometry.cards.length / COLUMNS) * TILE
  private readonly targets = [this.target(), this.target()]
  private readonly direct = this.target()
  private readonly filterScratch = this.target()
  private readonly filtered = this.target()
  private readonly fullscreen = new Scene()
  private readonly flatCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly plane = new PlaneGeometry(2, 2)
  private readonly shared = {
    cardData: { value: this.cardTexture }, directCache: { value: this.direct.texture }, historyCache: { value: this.targets[0].texture },
    filteredCache: { value: this.filtered.texture }, filterSource: { value: this.targets[0].texture }, filterDirection: { value: new Vector2(1, 0) },
    atlasSize: { value: new Vector2(this.width, this.height) }, cardCount: { value: this.geometry.cards.length },
    rugColour: { value: new Vector3(...rugColours.red) }, cabinet: { value: this.cabinet },
    lamps: { value: new Vector2(90, 90) }, sky: { value: 1 }, frame: { value: 0 }, blend: { value: .15 }, indirectEnabled: { value: 1 },
  }
  private readonly directMaterial = new ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: directFragment, uniforms: this.shared, depthTest: false, depthWrite: false })
  private readonly bounceMaterial = new ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: bounceFragment, uniforms: this.shared, depthTest: false, depthWrite: false })
  private readonly filterMaterial = new ShaderMaterial({ vertexShader: fullscreenVertex, fragmentShader: filterFragment, uniforms: this.shared, depthTest: false, depthWrite: false })
  private readonly copyMaterial = new ShaderMaterial({ vertexShader: fullscreenVertex, depthTest: false, depthWrite: false,
    fragmentShader: 'uniform sampler2D historyCache;varying vec2 vUv;void main(){gl_FragColor=texture2D(historyCache,vUv);}', uniforms: this.shared })
  private readonly quad = new Mesh(this.plane, this.copyMaterial)
  private readonly surfaces: Mesh[] = []
  private readonly bulbs: Mesh<SphereGeometry, MeshBasicMaterial>[] = []
  private readonly lastUpdated = this.geometry.cards.map(() => -100)
  private readonly histories = this.geometry.cards.map(() => 0)
  private readonly gpuQueries: { query: WebGLQuery; kind: GpuSample['kind']; tiles: number }[] = []
  private readonly gpuSamples: GpuSample[] = []
  private readonly frameTimes: number[] = []
  private readonly cpuTimes: number[] = []
  private readonly changes: { kind: string; at: number; firstUpdateMs?: number; fullSweepMs?: number; pending: Set<number> }[] = []
  private readonly gl: WebGL2RenderingContext
  private readonly timer: TimerExtension | null
  private index = 0
  private directDirty = true
  private frame = 0
  private previousTime = 0
  private lastBudgetChange = 0
  private readonly budgetMs = 2
  private tilesPerFrame = 8
  private started = false
  private readyAt = 0
  private readonly startedAt = performance.now()
  private animation = 0
  readonly host: HTMLElement
  private readonly onFrame: () => void
  readonly device: { renderer: string; vendor: string; timerQueries: boolean }

  constructor(host: HTMLElement, onFrame: () => void) {
    this.host = host; this.onFrame = onFrame
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setClearColor(new Color('#10141a'))
    host.append(this.renderer.domElement)
    this.gl = this.renderer.getContext() as WebGL2RenderingContext
    if (!this.gl.getExtension('EXT_color_buffer_float')) throw Error('This prototype requires floating-point WebGL2 render targets.')
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
    const debug = this.gl.getExtension('WEBGL_debug_renderer_info')
    this.device = { renderer: debug ? this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : this.gl.getParameter(this.gl.RENDERER),
      vendor: debug ? this.gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : this.gl.getParameter(this.gl.VENDOR), timerQueries: !!this.timer }
    this.cardTexture.minFilter = this.cardTexture.magFilter = NearestFilter
    this.uploadCards()
    this.fullscreen.add(this.quad)
    this.geometry.cards.forEach((card, id) => {
      const material = new ShaderMaterial({ vertexShader: surfaceVertex, fragmentShader: surfaceFragment,
        uniforms: { ...this.shared, surfaceId: { value: id } } })
      const mesh = new Mesh(this.plane, material)
      mesh.name = card.name; mesh.matrixAutoUpdate = false
      this.surfaces.push(mesh); this.scene.add(mesh)
    })
    this.syncSurfaces()
    for (const x of [-2, 2]) {
      const bulb = new Mesh(new SphereGeometry(.07, 16, 8), new MeshBasicMaterial({ color: '#fff3c7' }))
      bulb.position.set(x, 2.65, 0); this.bulbs.push(bulb); this.scene.add(bulb)
    }
    this.camera.position.set(-2.7, 1.55, 2.2); this.camera.lookAt(.25, 1.2, -.5)
    this.resize()
  }

  private target() {
    return new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false })
  }
  private uploadCards() {
    this.geometry.cards.forEach((c, i) => {
      this.cardPixels.set([...c.centre.toArray(), 0, ...c.u.toArray(), 0, ...c.v.toArray(), 0, ...c.colour.toArray(), c.kind], i * 16)
    })
    this.cardTexture.needsUpdate = true
  }
  private syncSurfaces() {
    this.geometry.cards.forEach((c, i) => {
      const normal = new Vector3().crossVectors(c.u, c.v).normalize()
      this.surfaces[i].matrix.copy(new Matrix4().makeBasis(c.u, c.v, normal).setPosition(c.centre))
      this.surfaces[i].matrixWorldNeedsUpdate = true
    })
  }
  resize() {
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight)
    this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.camera.updateProjectionMatrix()
  }
  private changed(kind: string) {
    this.directDirty = true
    this.histories.fill(0)
    this.changes.push({ kind, at: performance.now(), pending: new Set(this.geometry.cards.map((_, i) => i)) })
    if (this.changes.length > 30) this.changes.shift()
  }
  setLamp(id: number, enabled: boolean) {
    this.settings.lamps[id] = enabled
    this.shared.lamps.value.set(this.settings.lamps[0] ? 90 : 0, this.settings.lamps[1] ? 90 : 0)
    this.bulbs[id].material.color.set(enabled ? '#fff3c7' : '#333333')
    this.changed(`lamp-${id}-${enabled ? 'on' : 'off'}`)
  }
  setRug(colour: keyof typeof rugColours) {
    this.settings.rug = colour; this.shared.rugColour.value.fromArray(rugColours[colour]); this.changed(`rug-${colour}`)
  }
  setDaylight(enabled: boolean) { this.settings.daylight = enabled; this.shared.sky.value = enabled ? 1 : 0; this.changed(`daylight-${enabled}`) }
  setIndirect(enabled: boolean) { this.settings.indirect = enabled; this.shared.indirectEnabled.value = enabled ? 1 : 0 }
  setCabinet(x: number) {
    this.cabinet.x = Math.max(-3.3, Math.min(3.3, x))
    this.geometry.moveCabinet(this.cabinet); this.uploadCards(); this.syncSurfaces(); this.changed('cabinet')
  }
  private pollTimers() {
    if (!this.timer) return
    if (this.gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      this.gpuQueries.forEach(({ query }) => this.gl.deleteQuery(query)); this.gpuQueries.length = 0; return
    }
    while (this.gpuQueries.length && this.gl.getQueryParameter(this.gpuQueries[0].query, this.gl.QUERY_RESULT_AVAILABLE)) {
      const sample = this.gpuQueries.shift()!
      const ms = Number(this.gl.getQueryParameter(sample.query, this.gl.QUERY_RESULT)) / 1e6
      this.gl.deleteQuery(sample.query)
      this.gpuSamples.push({ kind: sample.kind, ms, tiles: sample.tiles })
      if (this.gpuSamples.length > 600) this.gpuSamples.shift()
      if (sample.kind === 'lighting' && this.frame - this.lastBudgetChange > 30 && ms > 0) {
        // A measured work target, not a guarantee. Change only the number of
        // lighting tiles, never camera resolution or visible geometry.
        const wanted = Math.max(1, Math.min(16, Math.floor(sample.tiles * this.budgetMs / ms)))
        this.tilesPerFrame += Math.sign(wanted - this.tilesPerFrame)
        this.lastBudgetChange = this.frame
      }
    }
  }
  private beginTimer(kind: GpuSample['kind']) {
    if (!this.timer || this.gpuQueries.length >= 8) return null
    const query = this.gl.createQuery()!
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query)
    return { query, kind, tiles: this.tilesPerFrame }
  }
  private endTimer(query: ReturnType<LightingLab['beginTimer']>) {
    if (!query || !this.timer) return
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.gpuQueries.push(query)
  }
  private lightingStep() {
    const r = this.renderer
    if (this.directDirty) {
      this.quad.material = this.directMaterial; r.setRenderTarget(this.direct); r.render(this.fullscreen, this.flatCamera); this.directDirty = false
    }
    const next = this.targets[1 - this.index]
    this.quad.material = this.copyMaterial; r.setRenderTarget(next); r.render(this.fullscreen, this.flatCamera)
    const ranked = this.geometry.cards.map((c, id) => {
      const near = Math.max(0, 3 - c.centre.distanceTo(this.camera.position) * .35)
      return { id, priority: this.frame - this.lastUpdated[id] + near }
    }).sort((a, b) => b.priority - a.priority).slice(0, this.tilesPerFrame)
    r.setScissorTest(true)
    this.quad.material = this.bounceMaterial
    for (const { id } of ranked) {
      this.shared.frame.value = this.frame
      this.shared.blend.value = labHistoryBlend(this.histories[id])
      if (this.histories[id]++ === 0 && this.frame < 10) this.shared.blend.value = 1
      const ratio = r.getPixelRatio()
      r.setScissor((id % COLUMNS) * TILE / ratio, Math.floor(id / COLUMNS) * TILE / ratio, TILE / ratio, TILE / ratio)
      r.render(this.fullscreen, this.flatCamera)
      this.lastUpdated[id] = this.frame
      for (const change of this.changes) {
        if (!change.pending.delete(id)) continue
        change.firstUpdateMs ??= performance.now() - change.at
        if (!change.pending.size) change.fullSweepMs = performance.now() - change.at
      }
    }
    r.setScissorTest(false)
    this.index = 1 - this.index
    this.shared.historyCache.value = this.targets[this.index].texture
    this.quad.material = this.filterMaterial
    this.shared.filterSource.value = this.targets[this.index].texture
    this.shared.filterDirection.value.set(1, 0)
    r.setRenderTarget(this.filterScratch); r.render(this.fullscreen, this.flatCamera)
    this.shared.filterSource.value = this.filterScratch.texture
    this.shared.filterDirection.value.set(0, 1)
    r.setRenderTarget(this.filtered); r.render(this.fullscreen, this.flatCamera)
  }
  async start(beforeFrame: (delta: number) => void) {
    for (const target of [...this.targets, this.direct, this.filterScratch, this.filtered]) {
      this.renderer.setRenderTarget(target); this.renderer.setClearColor(0, 0); this.renderer.clear()
    }
    // Prepare every program before accepting input; toggles change uniforms.
    for (const material of [this.copyMaterial, this.directMaterial, this.bounceMaterial, this.filterMaterial]) {
      this.quad.material = material
      await this.renderer.compileAsync(this.fullscreen, this.flatCamera)
    }
    this.renderer.setRenderTarget(null)
    await this.renderer.compileAsync(this.scene, this.camera)
    this.readyAt = performance.now(); this.started = true
    const tick = (now: number) => {
      this.animation = requestAnimationFrame(tick)
      if (document.hidden) { this.previousTime = 0; return }
      const delta = this.previousTime ? now - this.previousTime : 16.67
      this.previousTime = now
      beforeFrame(Math.min(delta / 1000, .05))
      this.camera.updateMatrixWorld()
      this.pollTimers()
      const start = performance.now()
      const wholeFrame = this.frame % 4 === 0
      const query = this.beginTimer(wholeFrame ? 'frame' : 'lighting')
      this.lightingStep()
      if (!wholeFrame) this.endTimer(query)
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.scene, this.camera)
      if (wholeFrame) this.endTimer(query)
      this.frameTimes.push(delta); this.cpuTimes.push(performance.now() - start)
      if (this.frameTimes.length > 600) { this.frameTimes.shift(); this.cpuTimes.shift() }
      this.frame++
      this.onFrame()
    }
    this.animation = requestAnimationFrame(tick)
  }
  stats() {
    const gpu = (kind: GpuSample['kind']) => this.gpuSamples.filter(s => s.kind === kind).map(s => s.ms)
    const cadence = percentile(this.frameTimes, .5)
    return { ready: this.started, frames: this.frame, startupMs: this.readyAt - this.startedAt,
      fps: cadence ? 1000 / cadence : null, frameMedianMs: cadence, frameP95Ms: percentile(this.frameTimes, .95), frameMaxMs: Math.max(0, ...this.frameTimes),
      cpuP95Ms: percentile(this.cpuTimes, .95), lightingGpuMedianMs: percentile(gpu('lighting'), .5), lightingGpuP95Ms: percentile(gpu('lighting'), .95),
      frameGpuMedianMs: percentile(gpu('frame'), .5), frameGpuP95Ms: percentile(gpu('frame'), .95),
      viewport: { width: this.renderer.domElement.width, height: this.renderer.domElement.height, pixelRatio: this.renderer.getPixelRatio() },
      cards: this.geometry.cards.length, tileResolution: TILE, raysPerTexel: 8, tilesPerFrame: this.tilesPerFrame, lightingBudgetMs: this.budgetMs,
      programs: this.renderer.info.programs?.length ?? 0, device: this.device, settings: { ...this.settings, cabinetX: this.cabinet.x },
      changes: this.changes.map(({ kind, firstUpdateMs, fullSweepMs, pending }) => ({ kind, firstUpdateMs, fullSweepMs, pendingCards: pending.size })),
    }
  }
  resetMeasurements() { this.frameTimes.length = 0; this.cpuTimes.length = 0; this.gpuSamples.length = 0; this.changes.length = 0 }
  /** Explicit diagnostic readback only. Rendering never waits for CPU pixels. */
  async measureCard(name: string, kind: 'indirect' | 'direct' | 'filtered' = 'indirect', patch = { x: 8, y: 4, width: 8, height: 6 }) {
    const id = this.geometry.cards.findIndex(c => c.name === name)
    if (id < 0) throw Error(`Unknown surface: ${name}`)
    const { x, y, width, height } = patch
    const pixels = new Uint16Array(width * height * 4)
    const target = kind === 'direct' ? this.direct : kind === 'filtered' ? this.filtered : this.targets[this.index]
    await this.renderer.readRenderTargetPixelsAsync(target, (id % COLUMNS) * TILE + x, Math.floor(id / COLUMNS) * TILE + y, width, height, pixels)
    const mean = [0, 0, 0]
    for (let p = 0; p < pixels.length; p += 4) for (let c = 0; c < 3; c++) mean[c] += DataUtils.fromHalfFloat(pixels[p + c]) / (width * height)
    // High-frequency variation in a flat wall patch, excluding its border.
    // Diagnostic only, so tests can distinguish smoothing from darkening.
    const light = (x: number, y: number) => {
      const p = (y * width + x) * 4
      return DataUtils.fromHalfFloat(pixels[p]) * .2126 + DataUtils.fromHalfFloat(pixels[p + 1]) * .7152 + DataUtils.fromHalfFloat(pixels[p + 2]) * .0722
    }
    let residual = 0, count = 0
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const difference = light(x, y) - (light(x - 1, y) + light(x + 1, y) + light(x, y - 1) + light(x, y + 1)) / 4
      residual += difference * difference; count++
    }
    return { name, kind, rgb: mean, roughness: count ? Math.sqrt(residual / count) : 0 }
  }
  dispose() {
    cancelAnimationFrame(this.animation)
    this.gpuQueries.forEach(({ query }) => this.gl.deleteQuery(query))
    this.targets.forEach(target => target.dispose()); this.direct.dispose(); this.filterScratch.dispose(); this.filtered.dispose(); this.cardTexture.dispose(); this.plane.dispose()
    this.surfaces.forEach(mesh => (mesh.material as ShaderMaterial).dispose())
    this.bulbs.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose() })
    this.directMaterial.dispose(); this.bounceMaterial.dispose(); this.filterMaterial.dispose(); this.copyMaterial.dispose(); this.renderer.dispose()
  }
}
