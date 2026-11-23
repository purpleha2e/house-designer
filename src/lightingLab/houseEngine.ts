import { ACESFilmicToneMapping, BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, DynamicDrawUsage, FloatType, GLSL3, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Matrix3,
  DataUtils, Frustum, Matrix4, Mesh, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Raycaster, RGBAFormat, Scene, ShaderMaterial, Sphere, Triangle, UnsignedByteType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget, type Texture } from 'three'
import { MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh'
import { HOUSE_COLUMNS, HOUSE_TILE, type HouseGeometry } from './houseGeometry'
import type { HouseInput, HouseSnapshot } from './houseBridge'
import { nextHouseTileBudget, selectHouseTiles } from './houseScheduling'
import { LAB_SKY_COLOUR, LAB_SKY_RADIANCE, HOUSE_BOUNCE_RAYS, houseHistoryBlend } from './calibration'
import { houseBounceFragment, houseCaptureFragment, houseCaptureVertex, houseCopyFragment, houseDirectFragment, houseFeedbackFragment, houseFeedbackVertex, houseFilterFragment,
  houseQuadVertex, houseSurfaceFragment, houseSurfaceVertex, houseTileOrigin, houseVisibilityFragment } from './houseShaders'

const percentile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : 0
type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class HouseLightingLab {
  readonly renderer: WebGLRenderer
  readonly camera = new PerspectiveCamera(65, 1, .04, 200)
  readonly scene = new Scene()
  readonly frames: number[] = []
  readonly gpuMs: number[] = []
  private readonly gl: WebGL2RenderingContext
  private readonly timer: TimerExtension | null
  private readonly queries: { query: WebGLQuery; tiles: number }[] = []
  private lastBudgetFrame = -20
  private readonly bvh = new MeshBVHUniformStruct()
  private readonly geometry = new BufferGeometry()
  private readonly displayGeometry = new BufferGeometry()
  private readonly treeGeometry = new BufferGeometry()
  private readonly fullScene = new Scene()
  private readonly captureScene = new Scene()
  private readonly feedbackScene = new Scene()
  private readonly feedbackTarget = new WebGLRenderTarget(128, 128, { minFilter: NearestFilter, magFilter: NearestFilter })
  private readonly feedbackPixels = new Uint8Array(128 * 128 * 4)
  private readonly feedbackDependencies: Set<number>[]
  private visibleCards: Set<number> | undefined
  private feedbackPending = false
  private feedbackFailed = false
  private readonly feedbackCamera = new PerspectiveCamera()
  private readonly flatCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly plane = new PlaneGeometry(2, 2)
  private readonly tileGeometry = new InstancedBufferGeometry()
  private readonly tileOrigins = new InstancedBufferAttribute(new Float32Array(128 * 2), 2).setUsage(DynamicDrawUsage)
  private readonly tileBlends = new InstancedBufferAttribute(new Float32Array(128), 1).setUsage(DynamicDrawUsage)
  private readonly tileSamples = new InstancedBufferAttribute(new Float32Array(128), 1).setUsage(DynamicDrawUsage)
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>
  private readonly gbuffer: WebGLRenderTarget
  private readonly direct: WebGLRenderTarget
  private readonly visibility: WebGLRenderTarget
  private readonly displayDirect: WebGLRenderTarget
  private readonly history: WebGLRenderTarget[]
  private readonly scratch: WebGLRenderTarget
  private readonly filtered: WebGLRenderTarget
  private readonly vertexCharts: DataTexture
  private readonly captureData: DataTexture
  private readonly white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType)
  private readonly textures: Texture[] = []
  private readonly materials: ShaderMaterial[] = []
  private readonly directMaterial: ShaderMaterial
  private readonly visibilityMaterial: ShaderMaterial
  private readonly bounceMaterial: ShaderMaterial
  private readonly filterMaterial: ShaderMaterial
  private readonly copyMaterial: ShaderMaterial
  private readonly uniforms
  private readonly data: HouseGeometry
  private readonly host: HTMLElement
  private readonly visibilityDirty: Set<number>
  private fullDirectDirty = true
  private clearIndirectPending = false
  private readonly updated: number[]
  private readonly samples: number[]
  private readonly updatesSinceChange: number[]
  private frame = 0
  private index = 0
  private animation = 0
  private previous = 0
  private tilesPerFrame = 16
  private schedulingCursor = 0
  private readonly viewFrustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly cardSphere = new Sphere()
  private inputKey = ''
  private previousInput: HouseInput | undefined
  private started = performance.now()
  private readyAt = 0
  private firstSweepMs = 0
  private lightChangedAt = 0
  private lightSweepMs = 0
  private disposed = false
  private paused = false
  private frozenLighting = false
  readonly device: string
  private readonly daylightEmitters: number

  constructor(host: HTMLElement, snapshot: HouseSnapshot, data: HouseGeometry) {
    this.host = host; this.data = data
    this.daylightEmitters = snapshot.finishes.filter(finish => finish.daylightEmitter).length
    const displayData = data.display ?? data
    this.feedbackDependencies = data.cards.map(() => new Set<number>())
    for (let v=0;v<displayData.vertexLighting.length;v++) if(displayData.vertexLighting[v]>.5) {
      const card=Math.floor(displayData.chart[v*2]/HOUSE_TILE)+Math.floor(displayData.chart[v*2+1]/HOUSE_TILE)*HOUSE_COLUMNS
      const owner=Math.floor(displayData.vertexLightChart[v*2]/HOUSE_TILE)+Math.floor(displayData.vertexLightChart[v*2+1]/HOUSE_TILE)*HOUSE_COLUMNS
      this.feedbackDependencies[card].add(owner)
    }
    this.visibilityDirty = new Set(data.cards.map((_, i) => i)); this.updated = data.cards.map(() => -1); this.samples = data.cards.map(() => 0)
    this.updatesSinceChange = data.cards.map(() => 0)
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(window.devicePixelRatio); this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1
    host.append(this.renderer.domElement)
    this.gl = this.renderer.getContext() as WebGL2RenderingContext
    if (!this.gl.getExtension('EXT_color_buffer_float')) throw Error('The house experiment needs floating-point WebGL2 targets.')
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
    const debug = this.gl.getExtension('WEBGL_debug_renderer_info')
    this.device = this.gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? this.gl.RENDERER)
    if (data.height > this.renderer.capabilities.maxTextureSize) throw Error('Surface cache exceeds this GPU texture limit.')
    const target = () => new WebGLRenderTarget(data.width, data.height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false })
    this.gbuffer = new WebGLRenderTarget(data.width, data.height, { count: 3, type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true })
    this.visibility = new WebGLRenderTarget(data.width, data.height, { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false })
    // Small steady-state updates lose energy when repeatedly rounded to half
    // precision. Keep only accumulated history at full precision. Explicit
    // shader interpolation avoids requiring float32 linear-filter support.
    const historyLinear = this.renderer.extensions.has('OES_texture_float_linear')
    const historyFilter = historyLinear ? LinearFilter : NearestFilter
    const historyTarget = () => new WebGLRenderTarget(data.width, data.height, { type: FloatType, minFilter: historyFilter, magFilter: historyFilter, depthBuffer: false })
    this.direct = target(); this.displayDirect = target(); this.history = [historyTarget(), historyTarget()]; this.scratch = target(); this.filtered = target()
    this.geometry.setAttribute('position', new BufferAttribute(data.position, 3)); this.geometry.setAttribute('normal', new BufferAttribute(data.normal, 3))
    this.geometry.setAttribute('uv', new BufferAttribute(data.uv, 2)); this.geometry.setAttribute('cacheChart', new BufferAttribute(data.chart, 2))
    this.geometry.setAttribute('cacheDepth', new BufferAttribute(data.depth, 1))
    this.geometry.setAttribute('vertexLightChart',new BufferAttribute(data.vertexLightChart,2));this.geometry.setAttribute('vertexLighting',new BufferAttribute(data.vertexLighting,1))
    for (const group of data.groups) this.geometry.addGroup(group.start, group.count, group.material)
    for (const [attribute, key, size] of [['position', 'position', 3], ['normal', 'normal', 3], ['uv', 'uv', 2],
      ['cacheChart', 'chart', 2], ['vertexLightChart', 'vertexLightChart', 2], ['vertexLighting', 'vertexLighting', 1]] as const)
      this.displayGeometry.setAttribute(attribute, new BufferAttribute(displayData[key], size))
    for (const group of displayData.groups) this.displayGeometry.addGroup(group.start, group.count, group.material)
    this.treeGeometry.setAttribute('position', new BufferAttribute(data.position, 3))
    this.bvh.updateFrom(MeshBVH.deserialize(data.tree, this.treeGeometry))
    const vertexSize = Math.ceil(Math.sqrt(data.position.length / 3)), chartPixels = new Float32Array(vertexSize * vertexSize * 4)
    for (let i = 0; i < data.chart.length / 2; i++) { chartPixels[i * 4] = data.chart[i * 2]; chartPixels[i * 4 + 1] = data.chart[i * 2 + 1] }
    this.vertexCharts = new DataTexture(chartPixels, vertexSize, vertexSize, RGBAFormat, FloatType); this.vertexCharts.needsUpdate = true
    const captureWidth = 2048, captureHeight = Math.ceil(data.position.length / 3 * 2 / captureWidth)
    const capturePixels = new Float32Array(captureWidth * captureHeight * 4)
    for (let i = 0; i < data.position.length / 3; i++) {
      capturePixels.set(data.position.subarray(i*3,i*3+3),i*8);capturePixels[i*8+3]=data.uv[i*2]
      capturePixels.set(data.normal.subarray(i*3,i*3+3),i*8+4);capturePixels[i*8+7]=data.uv[i*2+1]
    }
    this.captureData = new DataTexture(capturePixels,captureWidth,captureHeight,RGBAFormat,FloatType);this.captureData.needsUpdate=true
    this.white.needsUpdate = true
    this.uniforms = {
      atlasSize: { value: new Vector2(data.width, data.height) }, receivers: { value: this.gbuffer.textures[0] }, normals: { value: this.gbuffer.textures[1] }, albedos: { value: this.gbuffer.textures[2] },
      bvh: { value: this.bvh }, vertexCharts: { value: this.vertexCharts }, vertexTextureSize: { value: vertexSize },
      captureData: { value: this.captureData }, captureDataWidth: { value: captureWidth }, paddingPass: { value: 0 },
      directCache: { value: this.direct.texture }, historyCache: { value: this.history[0].texture }, filteredCache: { value: this.filtered.texture },
      displayDirectCache: { value: this.displayDirect.texture },
      visibilityCache: { value: this.visibility.texture },
      filterSource: { value: this.history[0].texture }, filterDirection: { value: new Vector2(1, 0) },
      filterFootprint: { value: 0 },
      rayCount: { value: HOUSE_BOUNCE_RAYS }, useTiles: { value: 0 }, indirectEnabled: { value: 1 },
      showSurfaceCacheCards: { value: 0 },
      daylightEnabled: { value: 1 }, prototypeDaylight: { value: snapshot.prototypeDaylight ? 1 : 0 },
      lightCount: { value: 0 }, lightPositions: { value: Array.from({ length: 32 }, () => new Vector3()) }, lightColours: { value: Array.from({ length: 32 }, () => new Vector3()) },
      activeLightCount: { value: 0 }, activeLightIndices: { value: new Int32Array(32) },
      lightDirections: { value: Array.from({ length: 32 }, () => new Vector3()) }, lightParameters: { value: new Float32Array(32 * 4) },
      sunDirection: { value: new Vector3(0, 1, 0) }, sunColour: { value: new Vector3() }, skyColour: { value: new Vector3() },
    }
    const pass = (fragmentShader: string) => {
      const material = new ShaderMaterial({ glslVersion: GLSL3, defines: { BVH_STACK_DEPTH: data.bvhStackDepth, ...(historyLinear ? { HOUSE_HISTORY_LINEAR: 1 } : {}) }, uniforms: this.uniforms, vertexShader: houseQuadVertex, fragmentShader, depthTest: false, depthWrite: false })
      Object.assign(material.defaultAttributeValues, { tileOrigin: [0, 0], tileBlend: [1], tileSample: [0] })
      this.materials.push(material); return material
    }
    this.visibilityMaterial = pass(houseVisibilityFragment); this.directMaterial = pass(houseDirectFragment); this.bounceMaterial = pass(houseBounceFragment); this.filterMaterial = pass(houseFilterFragment); this.copyMaterial = pass(houseCopyFragment)
    this.tileGeometry.index = this.plane.index
    this.tileGeometry.setAttribute('position', this.plane.attributes.position); this.tileGeometry.setAttribute('tileOrigin', this.tileOrigins)
    this.tileGeometry.setAttribute('tileBlend', this.tileBlends)
    this.tileGeometry.setAttribute('tileSample', this.tileSamples)
    this.quad = new Mesh(this.plane, this.copyMaterial); this.quad.frustumCulled = false; this.fullScene.add(this.quad)
    const captures: ShaderMaterial[] = [], visible: ShaderMaterial[] = [], feedback: ShaderMaterial[] = []
    for (const finish of snapshot.finishes) {
      const map = finish.map?.clone() ?? this.white
      if (map !== this.white) { map.needsUpdate = true; this.textures.push(map) }
      map.updateMatrix()
      const uniforms = { ...this.uniforms, finishMap: { value: map }, mapMatrix: { value: new Matrix3().copy(map.matrix) },
        finishColour: { value: new Vector3().fromArray(finish.colour) }, emission: { value: new Vector3().fromArray(finish.emission) }, alphaCut: { value: finish.alphaTest }, daylightEmitter: { value: finish.daylightEmitter ? 1 : 0 } }
      const capture = new ShaderMaterial({ glslVersion: GLSL3, defines: { BVH_STACK_DEPTH: data.bvhStackDepth }, uniforms,
        vertexShader: houseCaptureVertex, fragmentShader: houseCaptureFragment, side: DoubleSide })
      const display = new ShaderMaterial({ uniforms, vertexShader: houseSurfaceVertex, fragmentShader: houseSurfaceFragment, side: finish.side as 0 | 1 | 2 })
      const identity = new ShaderMaterial({ glslVersion: GLSL3, uniforms, vertexShader: houseFeedbackVertex, fragmentShader: houseFeedbackFragment, side: finish.side as 0 | 1 | 2, toneMapped: false })
      captures.push(capture); visible.push(display); feedback.push(identity); this.materials.push(capture, display, identity)
    }
    const capture = new Mesh(this.geometry, captures); capture.frustumCulled = false; this.captureScene.add(capture)
    this.scene.add(new Mesh(this.displayGeometry, visible)); this.scene.background = new Color('#8799b0')
    this.feedbackScene.add(new Mesh(this.displayGeometry, feedback))
    this.camera.position.fromArray(snapshot.position); this.camera.quaternion.fromArray(snapshot.quaternion); this.camera.fov = snapshot.fov
    this.resize()
  }
  resize() { this.renderer.setSize(this.host.clientWidth, this.host.clientHeight); this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.camera.updateProjectionMatrix() }
  setIndirect(enabled: boolean) { this.uniforms.indirectEnabled.value = enabled ? 1 : 0 }
  setSurfaceCacheCardsVisible(visible: boolean) { this.uniforms.showSurfaceCacheCards.value = visible ? 1 : 0 }
  setExposure(stops: number) { this.renderer.toneMappingExposure = 2 ** stops }
  setPaused(paused: boolean) { this.paused = paused; this.previous = 0 }
  setLightingFrozen(frozen: boolean) { this.frozenLighting = frozen; this.gpuMs.length = 0; this.frames.length = 0 }
  preparedResources() { return { data: this.data, positions: this.gbuffer.textures[0], normals: this.gbuffer.textures[1], geometry: this.displayGeometry } }
  restoreLiveLight() { this.filterPreparedLight(this.history[this.index].texture) }
  filterPreparedLight(texture: Texture) {
    this.uniforms.filterFootprint.value = 1
    this.uniforms.filterSource.value = texture; this.uniforms.filterDirection.value.set(1, 0); this.renderPass(this.filterMaterial, this.scratch)
    this.uniforms.filterSource.value = this.scratch.texture; this.uniforms.filterDirection.value.set(0, 1); this.renderPass(this.filterMaterial, this.filtered)
    this.renderer.setRenderTarget(null)
    return this.filtered.texture
  }
  referenceInput() { return this.previousInput ? structuredClone(this.previousInput) : undefined }
  setInput(input: HouseInput) {
    const key = JSON.stringify(input)
    if (key === this.inputKey) return
    this.inputKey = key; this.updatesSinceChange.fill(0); this.lightChangedAt = performance.now(); this.lightSweepMs = 0
    const lights = input.lights.slice(0, 32); this.uniforms.lightCount.value = lights.length
    this.uniforms.activeLightCount.value = 0
    lights.forEach((light, i) => {
      this.uniforms.lightPositions.value[i].fromArray(light.position)
      const colour = new Color(light.color).multiplyScalar(light.power / (4 * Math.PI))
      this.uniforms.lightColours.value[i].set(colour.r, colour.g, colour.b)
      if (Math.max(colour.r, colour.g, colour.b) > 0) this.uniforms.activeLightIndices.value[this.uniforms.activeLightCount.value++] = i
      this.uniforms.lightDirections.value[i].fromArray(light.target).sub(this.uniforms.lightPositions.value[i]).normalize()
      this.uniforms.lightParameters.value.set([light.distance, light.falloff, light.kind === 'spot' ? Math.cos(light.angle) : -1, Math.cos(light.angle * (1 - light.penumbra))], i * 4)
    })
    this.uniforms.sunDirection.value.fromArray(input.sunDirection).normalize(); this.uniforms.sunColour.value.fromArray(input.daylight ? input.sunColour : [0, 0, 0])
    this.uniforms.skyColour.value.fromArray(LAB_SKY_COLOUR).multiplyScalar(input.daylight ? LAB_SKY_RADIANCE : 0)
    this.uniforms.daylightEnabled.value = input.daylight ? 1 : 0
    // With every source off there is no radiance to converge towards. Remove
    // old off-screen bounce history immediately, rather than waiting for a
    // complete house sweep to drain it through successive bounces.
    this.clearIndirectPending = !input.daylight && lights.every(light => light.power <= 0)
    ;(this.scene.background as Color).set(input.daylight ? '#8799b0' : '#020617')
    const layout = (value: HouseInput) => JSON.stringify([value.sunDirection, value.lights.map(light => [light.kind, light.position, light.target, light.distance, light.angle, light.penumbra])])
    if (!this.previousInput || layout(input) !== layout(this.previousInput)) this.data.cards.forEach((_, i) => this.visibilityDirty.add(i))
    this.fullDirectDirty = true
    this.previousInput = structuredClone(input)
  }
  private renderPass(material: ShaderMaterial, target: WebGLRenderTarget, tiles?: number[]) {
    if (tiles && !tiles.length) return
    this.quad.material = material; this.renderer.setRenderTarget(target)
    this.renderer.setScissorTest(false)
    this.uniforms.useTiles.value = tiles ? 1 : 0
    this.quad.geometry = tiles ? this.tileGeometry : this.plane
    if (tiles) {
      tiles.forEach((id, index) => this.tileOrigins.setXY(index, ...houseTileOrigin(id)))
      tiles.forEach((id, index) => this.tileBlends.setX(index, houseHistoryBlend(this.updatesSinceChange[id], this.samples[id])))
      tiles.forEach((id, index) => this.tileSamples.setX(index, this.samples[id] % 65536))
      this.tileSamples.needsUpdate = true
      this.tileBlends.needsUpdate = true
      this.tileOrigins.needsUpdate = true; this.tileGeometry.instanceCount = tiles.length
    }
    this.renderer.render(this.fullScene, this.flatCamera)
  }
  private step() {
    const r = this.renderer, now = this.frame
    this.camera.updateMatrixWorld()
    this.viewFrustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    const feedbackCurrent = this.visibleCards && this.camera.position.distanceToSquared(this.feedbackCamera.position)<.25
      && Math.abs(this.camera.quaternion.dot(this.feedbackCamera.quaternion))>.99
    const inView = this.data.cards.map((card,id) => {
      if(feedbackCurrent)return this.visibleCards!.has(id)
      this.cardSphere.center.fromArray(card.centre); this.cardSphere.radius = card.radius
      return this.viewFrustum.intersectsSphere(this.cardSphere)
    })
    const ids = selectHouseTiles(this.data.cards, this.updated, now, this.camera.position.toArray(), this.tilesPerFrame, this.schedulingCursor, inView)
    this.schedulingCursor += ids.length
    // Both histories contain the same completed tiles. Write this batch into
    // the other target, then synchronize only those tiles after the bounce.
    // Copying the entire house atlas each frame made a one-card update pay
    // for thousands of untouched cards.
    const previous = this.history[this.index], next = this.history[1 - this.index]
    const directIds = ids.filter(id => this.visibilityDirty.delete(id))
    r.autoClear = false
    if (this.clearIndirectPending) {
      const colour = r.getClearColor(new Color()), alpha = r.getClearAlpha()
      r.setClearColor(0, 0); r.setScissorTest(false)
      for (const target of [...this.history, this.scratch, this.filtered]) {
        r.setRenderTarget(target); r.clear(true, false, false)
      }
      r.setClearColor(colour, alpha)
      this.clearIndirectPending = false
    }
    this.renderPass(this.visibilityMaterial, this.visibility, directIds)
    // Source power/colour changes need arithmetic only. Reuse static shadow
    // visibility so direct lighting changes across the whole house next frame.
    const relight = this.fullDirectDirty ? undefined : directIds
    this.renderPass(this.directMaterial, this.direct, relight)
    if(this.fullDirectDirty)this.lightSweepMs=performance.now()-this.lightChangedAt
    this.uniforms.filterFootprint.value = 0
    this.uniforms.filterSource.value = this.direct.texture; this.uniforms.filterDirection.value.set(.5, 0); this.renderPass(this.filterMaterial, this.scratch, relight)
    this.uniforms.filterSource.value = this.scratch.texture; this.uniforms.filterDirection.value.set(0, .5); this.renderPass(this.filterMaterial, this.displayDirect, relight)
    this.fullDirectDirty = false
    this.renderPass(this.bounceMaterial, next, ids)
    for (const id of ids) { this.updated[id] = now; this.samples[id]++; this.updatesSinceChange[id]++ }
    if (!this.visibilityDirty.size) {
      this.firstSweepMs ||= performance.now() - this.readyAt
      this.lightSweepMs ||= performance.now() - this.lightChangedAt
    }
    this.index = 1 - this.index; this.uniforms.historyCache.value = this.history[this.index].texture
    this.renderPass(this.copyMaterial, previous, ids)
    // Filter only the changed cards. Unchanged filtered tiles remain intact.
    this.uniforms.filterFootprint.value = 1
    this.uniforms.filterSource.value = this.history[this.index].texture; this.uniforms.filterDirection.value.set(1, 0); this.renderPass(this.filterMaterial, this.scratch, ids)
    this.uniforms.filterSource.value = this.scratch.texture; this.uniforms.filterDirection.value.set(0, 1); this.renderPass(this.filterMaterial, this.filtered, ids)
    r.autoClear = true
  }
  private requestVisibilityFeedback() {
    if(this.feedbackPending||this.feedbackFailed)return
    this.feedbackPending=true
    const position=this.camera.position.clone(),quaternion=this.camera.quaternion.clone()
    const r=this.renderer,colour=r.getClearColor(new Color()),alpha=r.getClearAlpha()
    r.setClearColor(0,0);r.setRenderTarget(this.feedbackTarget);r.render(this.feedbackScene,this.camera)
    r.setRenderTarget(null);r.setClearColor(colour,alpha)
    // Asynchronous fence/readback: navigation never waits for the ID image.
    void r.readRenderTargetPixelsAsync(this.feedbackTarget,0,0,128,128,this.feedbackPixels).then(()=>{
      if(this.disposed)return
      const visible=new Set<number>()
      for(let i=0;i<this.feedbackPixels.length;i+=4){
        const id=this.feedbackPixels[i]+this.feedbackPixels[i+1]*256-1
        if(id<0||id>=this.data.cards.length)continue
        visible.add(id);this.feedbackDependencies[id].forEach(owner=>visible.add(owner))
      }
      this.visibleCards=visible;this.feedbackCamera.position.copy(position);this.feedbackCamera.quaternion.copy(quaternion)
    }).catch(()=>{this.feedbackFailed=true}).finally(()=>{this.feedbackPending=false})
  }
  async start(beforeFrame: (delta: number) => void, onFrame: () => void, status: (message: string) => void) {
    status('Preparing GPU programs for the house')
    for (const material of [this.copyMaterial, this.visibilityMaterial, this.directMaterial, this.bounceMaterial, this.filterMaterial]) {
      this.quad.material = material; this.quad.geometry = this.tileGeometry
      await this.renderer.compileAsync(this.fullScene, this.flatCamera)
      if (material === this.directMaterial || material === this.filterMaterial) {
        this.quad.geometry = this.plane; await this.renderer.compileAsync(this.fullScene, this.flatCamera)
      }
      if (this.disposed) return
    }
    await this.renderer.compileAsync(this.captureScene, this.flatCamera); await this.renderer.compileAsync(this.scene, this.camera)
    await this.renderer.compileAsync(this.feedbackScene, this.camera)
    if (this.disposed) return
    this.renderer.setClearColor(0, 0)
    for (const target of [this.visibility, this.direct, this.displayDirect, ...this.history, this.scratch, this.filtered]) { this.renderer.setRenderTarget(target); this.renderer.clear() }
    status('Capturing surface colours and geometry')
    this.renderer.setRenderTarget(this.gbuffer); this.renderer.render(this.captureScene, this.flatCamera)
    this.renderer.autoClear=false;this.uniforms.paddingPass.value=1;this.renderer.render(this.captureScene,this.flatCamera)
    this.uniforms.paddingPass.value=0;this.renderer.autoClear=true;this.renderer.setRenderTarget(null)
    this.captureData.dispose()
    this.captureData.image.data = new Float32Array(0)
    this.readyAt = performance.now()
    const tick = (time: number) => {
      if (this.disposed) return
      this.animation = requestAnimationFrame(tick)
      if (document.hidden || this.paused) { this.previous = 0; return }
      const delta = this.previous ? time - this.previous : 16.67; this.previous = time
      beforeFrame(Math.min(delta / 1000, .05))
      if (this.timer) {
        if (this.gl.getParameter(this.timer.GPU_DISJOINT_EXT)) { this.queries.forEach(({ query }) => this.gl.deleteQuery(query)); this.queries.length = 0 }
        let measured: { milliseconds: number; tiles: number } | undefined
        while (this.queries.length && this.gl.getQueryParameter(this.queries[0].query, this.gl.QUERY_RESULT_AVAILABLE)) {
          const { query, tiles } = this.queries.shift()!, ms = Number(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT)) / 1e6; this.gl.deleteQuery(query)
          this.gpuMs.push(ms); if (this.gpuMs.length > 300) this.gpuMs.shift()
          measured = { milliseconds: ms, tiles }
        }
        // GPU results arrive asynchronously, often between the exact frames
        // divisible by twenty. Do not miss the adjustment (or apply it several
        // times to old results), and account for the batch actually measured.
        if (measured && this.frame - this.lastBudgetFrame >= 20) {
          this.tilesPerFrame = nextHouseTileBudget(this.tilesPerFrame,
            measured.milliseconds * this.tilesPerFrame / measured.tiles, delta < 25 ? 6 : 3)
          this.lastBudgetFrame = this.frame
        }
      }
      const query = !this.frozenLighting && this.timer && this.queries.length < 6 ? this.gl.createQuery() : null
      if (query) this.gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, query)
      if (!this.frozenLighting) this.step()
      if(!this.frozenLighting && this.frame%12===0)this.requestVisibilityFeedback()
      if (query) { this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT); this.queries.push({ query, tiles: Math.min(this.tilesPerFrame, this.data.cards.length) }) }
      this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.camera)
      this.frames.push(delta); if (this.frames.length > 300) this.frames.shift(); this.frame++
      onFrame()
    }
    this.animation = requestAnimationFrame(tick)
  }
  stats() { return { frames: this.frame, frozenLighting: this.frozenLighting, cards: this.data.cards.length, triangles: (this.data.display ?? this.data).position.length / 9,
    daylightMode: !this.uniforms.daylightEnabled.value ? 'off' : this.uniforms.prototypeDaylight.value ? 'windows' : 'exterior', daylightEmitters: this.daylightEmitters,
    lightingTriangles: this.data.position.length / 9, proxyInstances: this.data.proxyInstances ?? 0, proxyGeometries: this.data.proxyGeometries ?? 0, tileResolution: HOUSE_TILE,
    geometryPreparationMs: this.data.preparationMs ?? 0,
    sharedDetailInstances: this.data.sharedDetailInstances ?? 0,
    preparedCards: this.samples.filter(Boolean).length, visibleCards: this.visibleCards?.size??0,
    visibleUnprepared: this.visibleCards?[...this.visibleCards].filter(id=>this.samples[id]===0).length:0,
    feedbackFailed: this.feedbackFailed, pendingVisibility: this.visibilityDirty.size, pendingDirect: this.fullDirectDirty ? this.data.cards.length : 0, tilesPerFrame: this.tilesPerFrame,
    fps: 1000 / (percentile(this.frames, .5) || 16.67), frameP95Ms: percentile(this.frames, .95), lightingGpuMedianMs: this.frozenLighting ? 0 : percentile(this.gpuMs, .5), lightingGpuP95Ms: this.frozenLighting ? 0 : percentile(this.gpuMs, .95),
    startupMs: this.readyAt - this.started, firstSweepMs: this.firstSweepMs, lightSweepMs: this.lightSweepMs, programs: this.renderer.info.programs?.length ?? 0, device: this.device,
    viewport: { width: this.renderer.domElement.width, height: this.renderer.domElement.height, pixelRatio: this.renderer.getPixelRatio() },
    cacheMiB: (this.data.width * this.data.height * (6 * 16 + 4 * 8 + 4) + 128*128*8) / 1048576, bvhStackDepth: this.data.bvhStackDepth, columns: HOUSE_COLUMNS } }
  /** Diagnostic only: sample the light on a visible receiver without exposure. */
  async measureView(x: number, y: number) {
    const displayData = this.data.display ?? this.data
    const ray = new Raycaster(); this.camera.updateMatrixWorld(); ray.setFromCamera(new Vector2(x, y), this.camera)
    const hit = ray.intersectObjects(this.scene.children, false)[0]
    if (!hit?.face) return null
    const ids = [hit.face.a, hit.face.b, hit.face.c]
    const vertices = ids.map(i => new Vector3().fromArray(displayData.position, i * 3))
    const bary = new Triangle(...vertices as [Vector3, Vector3, Vector3]).getBarycoord(hit.point, new Vector3())!
    const uv = new Vector2()
    ids.forEach((id, i) => uv.addScaledVector(new Vector2().fromArray(displayData.chart, id * 2), bary.getComponent(i)))
    const pixel = async (target: WebGLRenderTarget, coordinate = uv) => {
      // Match the surface shader's bilinear lookup at the actual ray hit.
      // A nearest texel can be several centimetres away on a coarse wall chart.
      const x = coordinate.x - .5, y = coordinate.y - .5, left = Math.floor(x), top = Math.floor(y)
      const fx = x - left, fy = y - top
      const fullPrecision = target.texture.type === FloatType
      const data = fullPrecision ? new Float32Array(16) : new Uint16Array(16)
      await this.renderer.readRenderTargetPixelsAsync(target, left, top, 2, 2, data)
      const value = [0, 0, 0, 0]
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy)
        for (let c = 0; c < 4; c++) {
          const sample = data[(dy * 2 + dx) * 4 + c]
          value[c] += (fullPrecision ? sample : DataUtils.fromHalfFloat(sample)) * weight
        }
      }
      return [...value.slice(0, 3).map(v => v / Math.max(value[3], .001)), value[3]]
    }
    const reconstructed = async (target: WebGLRenderTarget) => {
      if (ids.reduce((sum, id, i) => sum + displayData.vertexLighting[id] * bary.getComponent(i), 0) <= .5) return pixel(target)
      // Proxy details use interpolated vertex receivers in the display shader.
      // Reading their triangle chart instead can report light never displayed.
      const values = await Promise.all(ids.map(id => pixel(target, new Vector2().fromArray(displayData.vertexLightChart, id * 2))))
      return [0, 1, 2, 3].map(c => values.reduce((sum, value, i) => sum + value[c] * bary.getComponent(i), 0))
    }
    const chart=Math.floor(uv.y / HOUSE_TILE) * HOUSE_COLUMNS + Math.floor(uv.x / HOUSE_TILE)
      const surface = this.scene.children[0] as Mesh<BufferGeometry, ShaderMaterial[]>
      const material = surface.material[hit.face.materialIndex]
    return { point: hit.point.toArray(), chart, name:this.data.cards[chart].name, updates:this.samples[chart],
        normal: hit.face.normal.toArray(), colour: material.uniforms.finishColour.value.toArray(),
        vertexLighting: ids.map(id => displayData.vertexLighting[id]),
      direct: await pixel(this.displayDirect), bounce: await reconstructed(this.filtered), history: await reconstructed(this.history[this.index]) }
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.animation); this.queries.forEach(({ query }) => this.gl.deleteQuery(query))
    this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.white.dispose(); this.bvh.dispose(); this.vertexCharts.dispose(); this.captureData.dispose()
    ;[this.gbuffer, this.visibility, this.direct, this.displayDirect, ...this.history, this.scratch, this.filtered, this.feedbackTarget].forEach(t => t.dispose())
    this.geometry.dispose(); this.displayGeometry.dispose(); this.treeGeometry.dispose(); this.tileGeometry.dispose(); this.plane.dispose(); this.renderer.dispose(); this.renderer.domElement.remove()
  }
}
