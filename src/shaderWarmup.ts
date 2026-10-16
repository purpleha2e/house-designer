import { BackSide, Data3DTexture, DataTexture, DoubleSide, FrontSide, Group, Light, Material, MeshDepthMaterial, MeshDistanceMaterial,
  Scene, Texture, WebGLRenderTarget, type Object3D, type Mesh, type Camera, type WebGLRenderer } from 'three'
import { waitForViewportIdle } from './viewportScheduling.ts'
import { prepareTextureUpload } from './textureUpload.ts'
import { cloneViewportObject } from './viewportObjectClone.ts'

type Renderable = Object3D & { material: Material | Material[] }

const fadeSources = new WeakMap<Material, Material>()
// Hook cache keys can contain the entire shader source. Re-escaping that text
// for every mesh made periodic feature scans take hundreds of milliseconds.
// Intern exact strings (no hash collisions); revisions are local to this runtime.
const programKeys = new Map<string, number>()
const attributeIds = new WeakMap<object,number>()
let nextAttributeId = 0
const resourceCaches = new WeakMap<WebGLRenderer,{ properties: WebGLRenderer['properties']; entries: WeakMap<Mesh['geometry'],string>; tracked: WeakSet<Mesh['geometry']> }>()
function resourceCache(renderer: WebGLRenderer) {
  let cache = resourceCaches.get(renderer)
  if (!cache || cache.properties !== renderer.properties) {
    cache = { properties: renderer.properties, entries: new WeakMap(), tracked: new WeakSet() }
    resourceCaches.set(renderer, cache)
  }
  return cache
}

/** Record an actual display upload so lighting preparation can reuse its buffers.
 * Attribute identities/versions still invalidate the entry after geometry edits. */
export function recordViewportGeometryUpload(renderer: WebGLRenderer, geometry: Mesh['geometry']) {
  const cache = resourceCache(renderer)
  cache.entries.set(geometry, geometryResourceKey(geometry))
  if (!cache.tracked.has(geometry)) {
    cache.tracked.add(geometry)
    const entries = cache.entries
    geometry.addEventListener('dispose', () => entries.delete(geometry))
  }
}
function geometryResourceKey(geometry: Mesh['geometry']) {
  const key = (attribute: object & { version?: number; data?: { version: number } }) => {
    let id=attributeIds.get(attribute)
    if(id===undefined){id=nextAttributeId++;attributeIds.set(attribute,id)}
    return `${id}:${attribute.version??attribute.data?.version??0}`
  }
  return Object.entries(geometry.attributes).map(([name,a])=>`${name}:${key(a)}`).join('|')+':'+
    (geometry.index?key(geometry.index):'')+':'+Object.entries(geometry.morphAttributes).map(([name,attrs])=>name+attrs!.map(key).join(',')).join('|')
}
function programId(key: string) {
  let id = programKeys.get(key)
  if (id === undefined) { id = programKeys.size; programKeys.set(key, id) }
  return id
}
const shaderScalarFeatures = new Set(['type', 'precision', 'vertexShader', 'fragmentShader', 'glslVersion',
  'normalMapType', 'side', 'transparent', 'blending', 'premultipliedAlpha', 'alphaHash', 'alphaToCoverage',
  'fog', 'flatShading', 'wireframe', 'vertexColors', 'sizeAttenuation', 'toneMapped', 'dithering',
  'combine', 'depthPacking', 'index0AttributeName'])
const shaderThresholdFeatures = ['alphaTest', 'anisotropy', 'clearcoat', 'dispersion', 'iridescence', 'sheen', 'transmission']
export function registerShaderFadeSource(material: Material, source: Material) {
  fadeSources.set(material, source)
}

/** Bounds and transform handles mark their parent, not every child mesh. */
export function isSelectionDecoration(object: Object3D) {
  for (let parent: Object3D | null = object; parent; parent = parent.parent) {
    if (parent.userData.selectionDecoration || ('isTransformControls' in parent && parent.isTransformControls)) return true
  }
  return false
}

/** Track program features, not material/geometry instance IDs. Rebuilt walls
 * with equivalent finishes reuse the programs retained by the warmup snapshot. */
function* shaderRevisionSteps(scene: Object3D) {
  const entries = new Set<string>()
  // Shared finishes occur on hundreds of meshes. Inspect each material once
  // per scan, while still noticing changes made without a version increment.
  const materialKeys = new Map<Material, string>()
  const geometryKeys = new Map<Mesh['geometry'], string>()
  const objects: Object3D[] = []
  scene.traverse(object => objects.push(object))
  for (const object of objects) {
    yield
    const source = object as Renderable
    if (!source.material || isSelectionDecoration(object)) continue
    for (const attached of Array.isArray(source.material) ? source.material : [source.material]) {
      const material = fadeSources.get(attached) ?? attached
      let materialKey = materialKeys.get(material)
      if (materialKey === undefined) {
        const features = Object.entries(material).flatMap(([key, value]) => {
          if (['uuid', 'id', 'version', 'name', 'visible'].includes(key)) return []
          if (value?.isTexture) {
            const texture = value as Texture
            return [[key, texture.channel, texture.mapping, texture.colorSpace, texture.format,
              key === 'envMap' ? (texture.image as { height?: number } | undefined)?.height : undefined]]
          }
          if (key === 'defines' || key === 'extensions') return [[key, Object.entries(value ?? {}).sort()]]
          return shaderScalarFeatures.has(key) ? [[key, value]] : []
        })
        // These values enable shader branches only when crossing zero. Opacity,
        // roughness, intensity and other uniform edits reuse the same program.
        const values = material as unknown as Record<string, unknown>
        features.push(...shaderThresholdFeatures.map(key => [key, Number(values[key] ?? 0) > 0]))
        features.push(['clippingPlanes', material.clippingPlanes?.length ?? 0], ['clipIntersection', material.clipIntersection])
        features.sort(([a], [b]) => String(a).localeCompare(String(b)))
        materialKey = JSON.stringify([programId(material.customProgramCacheKey()), features])
        materialKeys.set(material, materialKey)
      }
      const mesh = object as Mesh
      let geometryKey = geometryKeys.get(mesh.geometry)
      if (geometryKey === undefined) {
        geometryKey = JSON.stringify([
          mesh.geometry && Object.entries(mesh.geometry.attributes).map(([key, attribute]) => [key, attribute.itemSize]).sort(),
          mesh.geometry && Object.entries(mesh.geometry.morphAttributes).map(([key, values]) => [key, values.length]).sort(),
          mesh.geometry?.morphTargetsRelative,
        ])
        geometryKeys.set(mesh.geometry, geometryKey)
      }
      entries.add(JSON.stringify([object.type, materialKey, geometryKey,
        'isInstancedMesh' in object && !!object.isInstancedMesh,
        'isBatchedMesh' in object && !!object.isBatchedMesh,
        'instanceColor' in object && !!object.instanceColor,
        'morphTexture' in object && !!object.morphTexture]))
    }
  }
  return JSON.stringify([...entries].sort())
}

export function getShaderWarmupSceneRevision(scene: Object3D) {
  const steps = shaderRevisionSteps(scene)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
export async function prepareShaderWarmupSceneRevision(scene: Object3D, cancelled: () => boolean) {
  while (scene.userData.indirectScanPending && !cancelled()) await waitForViewportIdle(cancelled)
  const steps = shaderRevisionSteps(scene)
  while (await waitForViewportIdle(cancelled)) {
    const start = performance.now()
    do {
      const next = steps.next()
      if (next.done) return next.value
    } while (performance.now() - start < 3)
  }
  return undefined
}

/** A retained snapshot keeps programs for temporarily hidden/removed batches.
 * Selecting a model can remove an instanced batch without requiring new shaders. */
export function shaderWarmupRevisionIsCovered(prepared: string, current: string) {
  if (prepared === current) return true
  try {
    const available = new Set(JSON.parse(prepared) as string[])
    return (JSON.parse(current) as string[]).every(entry => available.has(entry))
  } catch { return false }
}

const fadingRoofRoles = new Set([
  'roof-top', 'roof-shell', 'roof-eaves', 'roof-soffit', 'roof-infill',
  'dormer-roof-top', 'dormer-roof-shell', 'dormer-soffit',
])

/** Own the materials while compileAsync polls them, even if an edit disposes
 * the live scene. Geometry/textures remain shared and are never disposed here.
 * Retaining this snapshot also keeps off-screen/fade programs in the GPU cache. */
function* shaderSnapshotSteps(scene: Object3D, options: {
  fadeWalls: boolean
  fadeRoofs: boolean
  createExtraMaterials?: (source: Material, object: Object3D) => Material[]
  /** Stable helper prototypes, compiled even before anything is selected. */
  helpers?: Object3D[]
  shadows?: boolean
}) {
  const root = new Group()
  const materials = new Map<Material, Map<string, Material>>()
  const extraMaterials = new Set<Material>()
  const objectDisposers: (() => void)[] = []
  const clone = (source: Object3D) => {
    const copy=cloneViewportObject(source);objectDisposers.push(copy.dispose);return copy.object as Renderable
  }
  let disposed = false, completed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    objectDisposers.forEach(dispose => dispose())
    materials.forEach(variants => variants.forEach(material => material.dispose()))
    extraMaterials.forEach(material => material.dispose())
    root.clear()
  }
  try {
  const cloneMaterial = (source: Material, variant: 'original' | 'wall-fade' | 'roof-fade', features: string) => {
    let variants = materials.get(source)
    if (!variants) materials.set(source, variants = new Map())
    // compileAsync waits for currentProgram on each material. Reusing one clone
    // across geometry/instancing variants makes it wait only for the last one,
    // leaving other programs to stall the first real draw.
    const variantKey = variant + ':' + features
    const cached = variants.get(variantKey)
    if (cached) return cached
    const material = source.clone()
    if ('defines' in source) Object.assign(material, { defines: { ...(source.defines as Record<string, unknown>) } })
    // Material.clone deliberately omits application shader hooks.
    material.onBeforeCompile = source.onBeforeCompile.bind(source)
    const cacheKey = source.customProgramCacheKey()
    material.customProgramCacheKey = () => cacheKey
    if (variant !== 'original') {
      material.transparent = true
      material.opacity = 0.5
      material.alphaHash = false
      material.depthWrite = false
      material.forceSinglePass = true
      if (variant === 'wall-fade') material.side = FrontSide
    }
    variants.set(variantKey, material)
    return material
  }
  for (const sourceRoot of [scene, ...(options.helpers ?? [])]) {
    sourceRoot.updateMatrixWorld(true)
    const objects: Object3D[] = []
    sourceRoot.traverse(object => objects.push(object))
    for (const object of objects) {
      yield
      const source = object as Renderable
      if (sourceRoot === scene && isSelectionDecoration(object)) continue
      if (!source.material || !(source.material instanceof Material || Array.isArray(source.material))) continue
      const role = object.userData.houseDesignerRole
      const mesh = object as Mesh
      const features = JSON.stringify([object.type,
        'isInstancedMesh' in object && !!object.isInstancedMesh,
        'isBatchedMesh' in object && !!object.isBatchedMesh,
        'isSkinnedMesh' in object && !!object.isSkinnedMesh,
        'instanceColor' in object && !!object.instanceColor,
        'morphTexture' in object && !!object.morphTexture,
        mesh.geometry && Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [name, attribute.itemSize]).sort(),
        mesh.geometry && Object.entries(mesh.geometry.morphAttributes).map(([name, attributes]) => [name, attributes.length]).sort(),
        mesh.geometry?.morphTargetsRelative])
      const variants: Array<'original' | 'wall-fade' | 'roof-fade'> = ['original']
      if (options.fadeWalls && role === 'wall-engine-render') variants.push('wall-fade')
      if (options.fadeRoofs && fadingRoofRoles.has(role)) variants.push('roof-fade')
      for (const variant of variants) {
        const proxy = clone(source)
        proxy.matrix.copy(source.matrixWorld)
        proxy.matrixWorld.copy(source.matrixWorld)
        proxy.matrixAutoUpdate = false
        proxy.material = Array.isArray(source.material)
          ? source.material.map(material => cloneMaterial(material, variant, features))
          : cloneMaterial(source.material, variant, features)
        root.add(proxy)
      }
      const extras = options.createExtraMaterials?.(Array.isArray(source.material) ? source.material[0] : source.material, object)
      if (extras?.length) {
        // Extra variants use the same geometry/transform without touching live materials.
        const originals = Array.isArray(source.material) ? source.material : [source.material]
        const highlightMaterials = originals.map((material, index) => index === 0 ? extras :
          options.createExtraMaterials?.(material, object) ?? [])
        for (let variant = 0; variant < extras.length; variant++) {
          const proxy = clone(source)
          proxy.matrix.copy(source.matrixWorld)
          proxy.matrixWorld.copy(source.matrixWorld)
          proxy.matrixAutoUpdate = false
          proxy.visible = true
          const entries = highlightMaterials.map(variants => variants[variant])
          entries.forEach(material => extraMaterials.add(material))
          proxy.material = Array.isArray(source.material) ? entries : entries[0]
          root.add(proxy)
        }
      }
      if (options.shadows && source.castShadow) {
        for (const original of Array.isArray(source.material) ? source.material : [source.material]) {
          for (const Template of [MeshDepthMaterial, MeshDistanceMaterial]) {
            const material = new Template()
            const values = original as Material & Record<string, unknown>
            for (const key of ['map', 'alphaMap', 'displacementMap', 'displacementScale', 'displacementBias',
              'wireframe', 'clipShadows', 'clippingPlanes', 'clipIntersection']) {
              if (key in values) Object.assign(material, { [key]: values[key] })
            }
            material.alphaTest = original.alphaToCoverage ? .5 : original.alphaTest
            material.side = original.shadowSide ?? (original.side === DoubleSide ? DoubleSide : original.side === FrontSide ? BackSide : FrontSide)
            const proxy = clone(source)
            proxy.material = material; proxy.matrixAutoUpdate = false
            proxy.matrix.copy(source.matrixWorld); proxy.matrixWorld.copy(source.matrixWorld)
            extraMaterials.add(material); root.add(proxy)
          }
        }
      }
    }
  }
  // Three compiles both sides of transparent double-sided materials but polls
  // only their final currentProgram. Retain one material per side so neither
  // side can still be compiling when the first real display draw starts.
  for (const object of [...root.children]) {
    yield
    const source = object as Renderable
    const originals = Array.isArray(source.material) ? source.material : [source.material]
    if (!originals.some(material => material.transparent && material.side === DoubleSide && !material.forceSinglePass)) continue
    for (const side of [FrontSide, BackSide]) {
      const entries = originals.map(original => {
        if (!original.transparent || original.side !== DoubleSide || original.forceSinglePass) return original
        const material = original.clone()
        if ('defines' in original) Object.assign(material, { defines: { ...(original.defines as Record<string, unknown>) } })
        material.onBeforeCompile = original.onBeforeCompile.bind(original)
        const key = original.customProgramCacheKey(); material.customProgramCacheKey = () => key
        material.side = side; material.forceSinglePass = true; extraMaterials.add(material)
        return material
      })
      const proxy = clone(source)
      proxy.material = Array.isArray(source.material) ? entries : entries[0]
      root.add(proxy)
    }
  }
  completed = true
  return { root, dispose }
  } finally { if (!completed) dispose() }
}

export function createShaderWarmupSnapshot(scene: Object3D, options: Parameters<typeof shaderSnapshotSteps>[1]) {
  const steps = shaderSnapshotSteps(scene, options)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
export async function prepareShaderWarmupSnapshot(scene: Object3D, options: Parameters<typeof shaderSnapshotSteps>[1], cancelled: () => boolean) {
  const steps = shaderSnapshotSteps(scene, options)
  while (await waitForViewportIdle(cancelled)) {
    const start = performance.now()
    do {
      const next = steps.next()
      if (next.done) return next.value
    } while (performance.now() - start < 3)
  }
  steps.return(undefined!)
  return undefined
}

/** compileAsync submits all programs synchronously before it returns a Promise.
 * Submit small batches in separate tasks, retaining every variant until ready. */
export async function compileShaderWarmup(renderer: WebGLRenderer, root: Object3D, camera: Camera, targetScene: Scene,
  options: { cancelled?: () => boolean; compile?: (batch: Object3D) => Promise<unknown> } = {}) {
  const cancelled = options.cancelled ?? (() => false)
  // Transform/vertex positions do not create shader variants. One representative
  // of each material + geometry feature combination is enough to prepare it.
  const seen = new Set<string>(), children: Object3D[] = []
  let scanStarted = performance.now()
  for (const object of root.children) {
    if (performance.now() - scanStarted > 3) {
      if (!await waitForViewportIdle(cancelled)) return false
      scanStarted = performance.now()
    }
    const key = getShaderWarmupSceneRevision(object)
    if (!seen.has(key)) { seen.add(key); children.push(object) }
  }
  // Yield between submissions, but do not serialize driver compilation behind
  // the slowest program in every batch. Keep a bounded queue in flight.
  const inFlight = new Set<Promise<void>>()
  const submitted: Promise<void>[] = []
  let failure: unknown, failed = false
  try {
    for (let offset = 0; offset < children.length;) {
      if (!await waitForViewportIdle(cancelled) || failed) break
      const part = new Group(); part.children = children.slice(offset, offset + 4)
      const compile = options.compile ? options.compile(part) : renderer.compileAsync(part, camera, targetScene)
      const pending = compile.then(() => {}, error => { failed = true; failure = error })
      submitted.push(pending); inFlight.add(pending)
      void pending.then(() => inFlight.delete(pending))
      offset += 4
      if (inFlight.size >= 4) await Promise.race(inFlight)
    }
  } finally {
    // Three keeps polling the snapshot materials. Cancellation or an error
    // must drain outstanding work before the caller can dispose those materials.
    await Promise.all(submitted)
  }
  if (failed) throw failure
  return !cancelled()

}

/** Shader readiness alone does not upload textures/vertex buffers. Warm one
 * geometry at a time with a zero-length draw, yielding between short batches. */
export async function prepareShaderWarmupResources(renderer: WebGLRenderer, root: Object3D, camera: Camera, targetScene: Scene,
  offscreen: boolean, cancelled: () => boolean, render?: (scene: Scene) => void, renderTarget?: WebGLRenderTarget | null) {
  const textures = new Set<Texture>(), geometries = new Set<Mesh['geometry']>(), proxies: Mesh[] = []
  const cache = resourceCache(renderer)
  let started = performance.now()
  for (const object of root.children) {
    if (performance.now()-started>3) { if (!await waitForViewportIdle(cancelled)) return false; started=performance.now() }
    const mesh=object as Mesh
    if (!mesh.geometry || !mesh.material) continue
    for (const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
    if (!geometries.has(mesh.geometry)) { geometries.add(mesh.geometry); proxies.push(mesh) }
  }
  for (const texture of textures) {
    if(performance.now()-started>3){if(!await waitForViewportIdle(cancelled))return false;started=performance.now()}
    if(cancelled())return false
    if (texture instanceof DataTexture || texture instanceof Data3DTexture) {
      if (!await prepareTextureUpload(renderer,texture,cancelled)) return false
    } else renderer.initTexture(texture)
  }
  const scene=new Scene(), target=renderTarget!==undefined?renderTarget:offscreen?new WebGLRenderTarget(1,1):null
  scene.environment=targetScene.environment;scene.environmentIntensity=targetScene.environmentIntensity
  scene.environmentRotation.copy(targetScene.environmentRotation);scene.fog=targetScene.fog
  targetScene.traverseVisible(object=>{if(object instanceof Light)scene.add(object.clone(false))})
  try {
    for (const source of proxies) {
      if(performance.now()-started>3){if(!await waitForViewportIdle(cancelled))return false;started=performance.now()}
      if(cancelled())return false
      const resourceKey=geometryResourceKey(source.geometry)
      if(cache.entries.get(source.geometry)===resourceKey)continue
      const materials=Array.isArray(source.material)?source.material:[source.material]
      if(materials.some(m=>'transmission' in m&&Number(m.transmission)>0))continue
      const copy=cloneViewportObject(source),proxy=copy.object
      proxy.visible=true;proxy.frustumCulled=false;proxy.layers.enableAll();scene.add(proxy)
      const range={...proxy.geometry.drawRange},previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
      const autoClear=renderer.autoClear,autoUpdate=renderer.shadowMap.autoUpdate,needsUpdate=renderer.shadowMap.needsUpdate,stats={...renderer.info.render}
      try {
        // A negative count exits Three before issuing a GL draw. A count of
        // zero still calls drawElements, which validates not-yet-created
        // shadow samplers and multiview framebuffer state on a cold scene.
        proxy.geometry.setDrawRange(0,-1)
        renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false
        renderer.setRenderTarget(target)
        if(render)render(scene);else renderer.render(scene,camera)
        recordViewportGeometryUpload(renderer, source.geometry)
      } finally {
        proxy.geometry.setDrawRange(range.start,range.count);scene.remove(proxy);copy.dispose()
        renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=autoUpdate;renderer.shadowMap.needsUpdate=needsUpdate
        renderer.setRenderTarget(previous,face,mip);Object.assign(renderer.info.render,stats)
      }
    }
    return !cancelled()
  } finally { if(renderTarget===undefined)target?.dispose() }
}
