/* eslint-disable react-hooks/immutability -- Cached Three.js resources are updated imperatively. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Color, CubeCamera, HalfFloatType, LinearSRGBColorSpace, Material, Matrix4, Mesh,
  MeshStandardMaterial, PointLight, SpotLight, RGBAFormat, DataTexture, FloatType, NearestFilter, Vector3,
  WebGLCubeRenderTarget, Light, Scene, type Camera, type Texture, type WebGLRenderTarget } from 'three'
import { createIndirectProbeIntegrator } from '../indirectProbeIntegration'
import { createIndirectSurfaceCache, prepareIndirectSurfaceCaptureKey, supportsIndirectSurfaceCapture } from '../indirectSurfaceCache'
import { indirectSurfaceLights, indirectSurfaceSun } from '../indirectSurfaceRelighting'
import { createIndirectLightingUpdates, indirectLightingStructureKey, prioritizeIndirectLighting } from '../indirectContinuousLighting'
import { indirectContentKey, indirectLightingSettingsKey, loadIndirectLighting, loadIndirectReflections, saveIndirectLighting, savedIndirectLightingMatches,
  type IndirectLightingSettings, type SavedIndirectLighting } from '../indirectLightingPersistence'
import { createIndirectField, restoreIndirectField, serializeIndirectField, INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, indirectGeometryFingerprintSteps, writeIndirectProbe, type IndirectFloor, type IndirectRegion } from '../indirectLighting'
import { indirectGeometryRanges, snapshotIndirectGeometry } from '../indirectVisibility'
import { IndirectLightingClient } from '../indirectLightingClient'
import { applyIndirectLightingShader, createIndirectUniforms, setIndirectLocalReflection, updateIndirectUniforms } from '../indirectLightingShader'
import { applySpecularOnlyImageBasedLighting } from '../materials/imageBasedLighting'
import { pointIsInsideRoomPolygon } from '../roomLightMask'
import { roomLightCaptureUniform } from '../roomLightShader'
import { compileShaderWarmup, createShaderWarmupSnapshot, prepareShaderWarmupSnapshot, prepareShaderWarmupResources, isSelectionDecoration } from '../shaderWarmup'
import { createIndirectBounceField, createIndirectPreviewField, indirectPreviewCoefficients, liveIndirectFaceBudget, liveIndirectTimeBudget, shouldPublishLivePreview } from '../indirectLivePreview'
import { IndirectLightingProbes } from './IndirectLightingProbes'
import { IndirectLightingInspector } from './IndirectLightingInspector'
import { DIFFUSE_PROBE_RESOLUTIONS, type DiffuseProbeResolution } from '../indirectProbeResolution'
import { indirectLocalChanges, indirectRegionKey, indirectZoneProbes, type IndirectZonePlan, type IndirectModelBounds } from '../indirectLightingZones'
import { INDIRECT_FURNITURE_PROBE_VERSION } from '../indirectFurnitureProbes'
import { prepareIndirectCaptureScene } from '../indirectCaptureScene'
import { isViewportNavigating, markViewportNavigation, runViewportTask, yieldToViewport } from '../viewportScheduling'
import { IndirectReflectionClient } from '../indirectReflectionClient'
import { setViewportEnvironmentMap } from '../shaderWarmupState'
import { prepareTextureReplacement, prepareTextureUpload } from '../textureUpload'
import { createIndirectMultiview } from '../indirectMultiview'
import { INDIRECT_VOLUME_SAMPLING_VERSION } from '../indirectVolume'

type Sample = { region: IndirectRegion; position: Vector3; probe?: number; pass: number; reflection?: boolean }
export type IndirectLocalLight = { position: [number, number, number]; target: [number, number, number];
  kind: 'point' | 'spot'; color: string; power: number; distance: number; falloff: number; angle: number; penumbra: number }
const NO_LOCAL_LIGHTS: IndirectLocalLight[] = []

/** Progressive world-space GI with bounded capture batches and portable completed lighting. */
export function IndirectLighting({ floors, revision, blocked, enabled, indoorFill, daylight, daylightBounceStrength = 1, localLights: inputLights = NO_LOCAL_LIGHTS, showProbes = false,
  savedCache, cacheProjectKey = '', cacheAssetKey = '', cacheSettings, cacheExportable = false, onCacheReady, requireSavedCache = false,
  diffuseProbeResolution = 16, diffuseEnabled = true, inspectPoint = false, cacheBlocked = blocked, effectsEnabled = true }: {
  cacheBlocked?: boolean; effectsEnabled?: boolean
  inspectPoint?: boolean
  diffuseEnabled?: boolean
  diffuseProbeResolution?: DiffuseProbeResolution
  floors: IndirectFloor[]; revision: string; blocked: boolean; enabled: boolean; indoorFill: number; daylight: boolean
  localLights?: IndirectLocalLight[]
  daylightBounceStrength?: number
  showProbes?: boolean
  savedCache?: SavedIndirectLighting; cacheProjectKey?: string; cacheAssetKey?: string
  cacheSettings?: IndirectLightingSettings; cacheExportable?: boolean
  onCacheReady?: (cache: SavedIndirectLighting | undefined) => void
  requireSavedCache?: boolean
}) {
  const { camera, gl, invalidate, scene } = useThree()
  const effectsAllowed = useRef(effectsEnabled)
  useEffect(() => { effectsAllowed.current = effectsEnabled }, [effectsEnabled])
  const layoutKey = JSON.stringify(floors)
  const lightKey = JSON.stringify(inputLights)
  const localLights = useMemo(() => JSON.parse(lightKey) as IndirectLocalLight[], [lightKey])
  const [initialField] = useState(() => createIndirectField([], 0))
  const workField = useRef(initialField), displayField = useRef(initialField)
  const bounceField = useRef<typeof initialField | null>(null)
  const ownedFields = useRef(new Set([initialField]))
  const client = useMemo(() => new IndirectLightingClient(), [])
  const [uniforms] = useState(() => createIndirectUniforms(initialField))
  const pendingUpdate = useRef(true), preparing = useRef(false), preparedKey = useRef(''), geometrySignature = useRef('')
  const preparingVersion = useRef(-1), interactionUntil = useRef(0), warming = useRef(false)
  const preparedLightPositions = useRef('')
  const sceneUpdateRequested = useRef(false)
  const lastSceneReplacement = useRef(-Infinity)
  const liveUpdates = useRef(createIndirectLightingUpdates())
  const liveSweep = useRef(false), liveSunKey = useRef('')
  const sourceSun = useRef<ReturnType<typeof indirectSurfaceSun>>(undefined)
  const globalLiveChange = useRef(false)
  const requestedStructure = useRef('')
  const capturePrograms = useRef(new Map<string, { signature: string; snapshot: ReturnType<typeof createShaderWarmupSnapshot> }>())
  const captureScene = useRef<Awaited<ReturnType<typeof prepareIndirectCaptureScene>>>(null)
  const multiview = useRef<ReturnType<typeof createIndirectMultiview>>(null)
  const multiviewProbe = useRef(false)
  const surfaceScene = useRef<Awaited<ReturnType<typeof prepareIndirectCaptureScene>>>(null)
  const surfaceCache = useRef<ReturnType<typeof createIndirectSurfaceCache>>(null), surfaceCacheKey = useRef('')
  const surfaceSunEnabled = useRef(false)
  const bakeTriangles = useRef<DataTexture | null>(null), volumePending = useRef(false), bakeVolumeReady = useRef(false)
  const floorAttempted = useRef(new WeakSet<typeof initialField>())
  const floorPreparing = useRef(false), floorVersion = useRef(-1)
  const furnitureProbeUpgrade = useRef(false)
  const capturedProbes = useRef(new Set<number>())
  const previewField = useRef<typeof initialField | null>(null)
  const previewFields = useRef(new Set<typeof initialField>())
  const previewRequest = useRef<object | null>(null), previewUpdated = useRef(new Set<number>())
  const lastPreview = useRef({ completed: 0, time: -Infinity }), lastCapture = useRef(-Infinity)
  const navigationUntil = useRef(0)
  const reflectionClient = useMemo(() => new IndirectReflectionClient(), [])
  const reflectionPending = useRef(false)
  const restorers = useRef(new Map<Material, () => void>())
  const refreshedHelpers = useRef(new WeakSet<Material>())
  const generation = useRef(0), signature = useRef('')
  const geometryBuilds = useRef(0)
  const queue = useRef<Sample[]>([]), face = useRef(0), reading = useRef(false), waitUntil = useRef(0)
  const readbacks = useRef(new Set<{ pass: number; promise?: Promise<void> }>())
  const cameraMatrix = useRef(new Matrix4())
  const obstacles = useRef<{ bounds: Box3; geometry: boolean }[]>([])
  const modelBounds = useRef<IndirectModelBounds>(new Map()), captureModelBounds = useRef<IndirectModelBounds>(new Map())
  const reflections = useRef(new Map<string, { texture: Texture; dispose(): void }>())
  const baseline = useRef<{ generation: number; revision: string; settingsKey: string; field: typeof initialField;
    direct?: Uint16Array[]; final: Uint16Array[]; bounds?: IndirectModelBounds } | null>(null)
  const directCoefficients = useRef<Uint16Array[] | undefined>(undefined)
  const partialBake = useRef(false), captureRevision = useRef(revision)
  const updatedProbes = useRef(new Set<number>())
  const refinedProbes = useRef(new Set<number>())
  const exportedCache = useRef<SavedIndirectLighting | undefined>(undefined), saving = useRef(false), savedGeneration = useRef(-1)
  const attemptedCache = useRef(''), loadedCacheKey = useRef('')
  const settingsKey = indirectLightingSettingsKey(cacheSettings && { ...cacheSettings, daylightBounceStrength }) + ':' + daylightBounceStrength
  const captureSettingsKey = useRef(settingsKey)
  const cacheIdentity = `${cacheProjectKey}:${cacheAssetKey}:${settingsKey}`
  const probeSnapshot = useCallback(() => ({ field: workField.current, captured: capturedProbes.current,
    active: queue.current[0]?.probe, completed: scene.userData.indirectLighting?.completed ?? 0,
    generation: generation.current }), [scene])
  const reflectionMaterials = useRef(new Map<MeshStandardMaterial, { original: Texture; assigned: Texture }>())
  const disposeUnusedPreviews = useCallback(() => {
    for (const field of previewFields.current) {
      if (field === displayField.current || field === previewField.current) continue
      field.dispose(); ownedFields.current.delete(field); previewFields.current.delete(field)
    }
  }, [])
  const resources = useMemo(() => {
    const diffuse = new Map(DIFFUSE_PROBE_RESOLUTIONS.map(size => {
      const target = new WebGLCubeRenderTarget(size, { type: HalfFloatType, format: RGBAFormat,
        generateMipmaps: false, colorSpace: LinearSRGBColorSpace })
      const camera = new CubeCamera(.03, 80, target)
      camera.coordinateSystem = gl.coordinateSystem; camera.updateCoordinateSystem()
      const capture = { target, camera, integrator: createIndirectProbeIntegrator(size), ready: false }
      return [size, capture] as const
    }))
    const reflectionTarget = new WebGLCubeRenderTarget(64, { type: HalfFloatType, format: RGBAFormat,
      generateMipmaps: false, colorSpace: LinearSRGBColorSpace })
    const reflectionCamera = new CubeCamera(.03, 80, reflectionTarget)
    reflectionCamera.coordinateSystem = gl.coordinateSystem; reflectionCamera.updateCoordinateSystem()
    return { diffuse, reflectionTarget, reflectionCamera,
      sky: new Color(), centre: new Vector3() }
  }, [gl])
  const uploadDisplayVolume = useCallback(async (field: typeof initialField, cancelled: () => boolean) => {
    const previousVolume=field.volume.maps[0],previousFloor=field.floorLayer.texture
    const volume=await prepareTextureReplacement(gl,previousVolume,cancelled,field.volume.data)
    if(!volume)return false
    const floor=await prepareTextureReplacement(gl,previousFloor,cancelled,field.floorLayer.data)
    if(!floor){volume.dispose();return false}
    if(cancelled()){volume.dispose();floor.dispose();return false}
    field.volume.maps[0]=volume;field.floorLayer.texture=floor;field.floorLayer.ready=true
    previousVolume.dispose();previousFloor.dispose()
    return true
  },[gl])
  const captureLights = useMemo(() => localLights.map(slot => {
      const light = slot.kind === 'spot' ? new SpotLight(slot.color) : new PointLight(slot.color)
      light.position.set(...slot.position); light.power = slot.power; light.distance = slot.distance; light.decay = slot.falloff
      if (light instanceof SpotLight) { light.angle = slot.angle; light.penumbra = slot.penumbra; light.target.position.set(...slot.target) }
      return light
    }), [localLights])

  useEffect(() => {
    scene.userData.getBakedIndirectLighting = () => exportedCache.current
    scene.userData.getIndirectCaptureScene = () => captureScene.current
    scene.userData.getIndirectMultiview = () => multiview.current
    scene.userData.getIndirectSurfaceCache = () => surfaceCache.current
    scene.userData.getIndirectSurfaceCaptureScene = () => surfaceScene.current
    return () => { delete scene.userData.getBakedIndirectLighting; delete scene.userData.getIndirectCaptureScene; delete scene.userData.getIndirectMultiview;
      delete scene.userData.getIndirectSurfaceCache; delete scene.userData.getIndirectSurfaceCaptureScene }
  }, [scene])

  const restoreReflections = useCallback(() => {
    reflectionMaterials.current.forEach((state, material) => {
      if (material.envMap === state.assigned) setViewportEnvironmentMap(scene, material, state.original)
      setIndirectLocalReflection(material, false)
    })
    reflectionMaterials.current.clear()
    reflections.current.forEach(target => target.dispose()); reflections.current.clear()
  }, [scene])

  const assignReflections = useCallback(() => {
    const field = displayField.current
    const assignments = new Map<MeshStandardMaterial, Set<number>>()
    scene.traverse(object => {
      if (!(object instanceof Mesh) || object.userData.houseDesignerRole === 'model-batch') return
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      if (!object.geometry.boundingBox) return
      new Box3().copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld).getCenter(resources.centre)
      const p = resources.centre
      const region = field.regions.find(region => p.y >= region.bottom - .1 && p.y <= region.top + .1 &&
        [[0, 0], [.2, 0], [-.2, 0], [0, .2], [0, -.2]].some(([x, z]) =>
          pointIsInsideRoomPolygon({ x: p.x + x, y: p.z + z }, region.polygon)))
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof MeshStandardMaterial) || !material.envMap) continue
        const rooms = assignments.get(material) ?? new Set<number>(); rooms.add(region?.id ?? 0); assignments.set(material, rooms)
      }
    })
    assignments.forEach((rooms, material) => {
      // Shared render batches spanning rooms retain their spatially attenuated
      // fallback. Splitting those batches for reflections would add draw calls.
      const region = rooms.size === 1 ? field.regions.find(region => region.id === [...rooms][0]) : undefined
      const target = region ? reflections.current.get(indirectRegionKey(region)) : null
      if (!target) {
        const previous = reflectionMaterials.current.get(material)
        if (previous && material.envMap === previous.assigned) {
          setViewportEnvironmentMap(scene, material, previous.original)
          setIndirectLocalReflection(material, false); reflectionMaterials.current.delete(material)
        }
        return
      }
      if (material.envMap === target.texture) { setIndirectLocalReflection(material, true); return }
      const existing = reflectionMaterials.current.get(material)
      reflectionMaterials.current.set(material, { original: existing?.original ?? material.envMap!, assigned: target.texture })
      setViewportEnvironmentMap(scene, material, target.texture)
      setIndirectLocalReflection(material, true)
    })
  }, [resources, scene])

  useLayoutEffect(() => {
    updateIndirectUniforms(uniforms, displayField.current)
    uniforms.hdGIEnabled.value = enabled ? 1 : 0
    uniforms.hdGIIndoorFill.value = indoorFill
    uniforms.hdGIProbeStrength.value = diffuseEnabled ? 1 : 0
    invalidate()
  }, [enabled, diffuseEnabled, indoorFill, invalidate, uniforms])

  const scan = useCallback(function* () {
    const geometry: string[] = []
    const liveMaterials = new Set<Material>()
    const furniture: typeof obstacles.current = []
    const boundsByModel = new Map<string, { min: number[]; max: number[] }>()
    const finishes = new Set<string>()
    scene.updateMatrixWorld(true)
    let pointIndex = 0, spotIndex = 0
    uniforms.hdGIPointIndices.value.fill(-1); uniforms.hdGISpotIndices.value.fill(-1)
    const objects: typeof scene.children = []
    scene.traverse(object => objects.push(object))
    for (const object of objects) {
      yield
      if (isSelectionDecoration(object)) continue
      if (object instanceof PointLight || object instanceof SpotLight) {
        const lightIndex = localLights.findIndex(light => object.position.distanceToSquared(new Vector3(...light.position)) < .00001)
        const indices = object instanceof SpotLight ? uniforms.hdGISpotIndices.value : uniforms.hdGIPointIndices.value
        const index = object instanceof SpotLight ? spotIndex++ : pointIndex++
        if (index < indices.length && lightIndex >= 0 && lightIndex < INDIRECT_MAX_LOCAL_LIGHTS) {
          indices[index] = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + lightIndex
        }
      }
      if (object.name.startsWith('model-transform-')) {
        // Editor lamp markers are not furniture. Keep the same point bounds
        // whether selected or hidden so selecting a lamp preserves probe layout.
        const bounds = object.userData.indirectLightModel
          ? new Box3().setFromCenterAndSize(object.getWorldPosition(new Vector3()), new Vector3())
          : new Box3().setFromObject(object)
        const size = bounds.getSize(new Vector3())
        if (!bounds.isEmpty()) boundsByModel.set(object.name.slice('model-transform-'.length), { min: bounds.min.toArray(), max: bounds.max.toArray() })
        if (size.x > .3 && size.y > .3 && size.z > .3) furniture.push({ bounds, geometry: !!object.userData.indirectStairModel })
      }
      if (!(object instanceof Mesh) || object.userData.selectionDecoration) continue
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        liveMaterials.add(material)
        // A running editor can retain an OPAQUE helper program from an earlier
        // capture after hot reload. Refresh it once without changing scene state.
        if (!(material instanceof MeshStandardMaterial) && material.transparent && material.opacity === 0 &&
          !refreshedHelpers.current.has(material)) {
          refreshedHelpers.current.add(material); material.needsUpdate = true
        }
        if (material instanceof MeshStandardMaterial) {
          finishes.add(`${material.color.getHexString()}:${material.emissive.getHexString()}:${material.roughness}:${material.metalness}:${material.map?.source.uuid}:${material.map?.source.version}`)
        }
        if (!(material instanceof MeshStandardMaterial) || restorers.current.has(material)) continue
        applySpecularOnlyImageBasedLighting(material)
        restorers.current.set(material, applyIndirectLightingShader(material, uniforms))
      }
      // Sources remain authoritative when render batching hides them. Fading,
      // camera movement, and helper objects must never invalidate lighting.
      if (object.userData.houseDesignerRole === 'model-batch' || object.userData.selectionDecoration ||
        !materials.some(m => m instanceof MeshStandardMaterial) ||
        (object.userData.houseDesignerRole === 'ground-image')) continue
      const p = object.geometry.attributes.position
      if (!p?.count) continue
      const ranges = indirectGeometryRanges(object)
      if (ranges.length) geometry.push(`${yield* indirectGeometryFingerprintSteps(object.geometry, ranges)}:${object.matrixWorld.elements.map(value => Math.round(value * 100000)).join(',')}`)
    }
    obstacles.current = furniture
    modelBounds.current = boundsByModel
    restorers.current.forEach((restore, material) => {
      if (!liveMaterials.has(material)) { restore(); restorers.current.delete(material); reflectionMaterials.current.delete(material as MeshStandardMaterial) }
    })
    if (reflections.current.size) assignReflections()
    geometrySignature.current = geometry.sort().join('|')
    return geometrySignature.current + '::' + [...finishes].sort().join('|')
  }, [assignReflections, localLights, scene, uniforms])

  const requestSceneUpdate = useCallback(() => {
    // Coalesce all edits, including materials and structure. Finish an atomic
    // read/upload/preparation before replacing its inputs with the latest scene.
    sceneUpdateRequested.current = true
    exportedCache.current = undefined
    onCacheReady?.(undefined)
    invalidate()
  }, [invalidate, onCacheReady])

  const requestLiveUpdate = useCallback(() => {
    liveUpdates.current.request()
    if (scene.userData.indirectLighting) {
      scene.userData.indirectLighting.pendingLighting = true
      if (scene.userData.indirectLighting.state === 'ready') scene.userData.indirectLighting.state = 'updating'
    }
    exportedCache.current = undefined
    onCacheReady?.(undefined)
    invalidate()
  }, [invalidate, onCacheReady, scene])

  const scheduleUpdate = useCallback(() => {
    sceneUpdateRequested.current = false
    lastSceneReplacement.current = performance.now()
    liveUpdates.current.reset(); liveUpdates.current.request(); liveSweep.current = false
    generation.current++
    scene.userData.indirectReflectionPending = false
    furnitureProbeUpgrade.current = false
    // A superseded decode must not prevent a later stable scene from restoring the same cache.
    attemptedCache.current = ''
    if (preparing.current || volumePending.current) {
      client.dispose(); preparedKey.current = ''; preparing.current = false; volumePending.current = false; preparingVersion.current = -1
    }
    pendingUpdate.current = true
    loadedCacheKey.current = ''; exportedCache.current = undefined
    onCacheReady?.(undefined)
    queue.current = []; face.current = 0
    previewRequest.current = null
    waitUntil.current = performance.now()
    const previous = scene.userData.indirectLighting
    scene.userData.indirectLighting = { ...previous, generation: generation.current, completed: 0, state: 'updating',
      previewUpdates: 0, firstPreviewMs: undefined, lastPreviewCompleted: undefined }
    invalidate()
  }, [client, invalidate, onCacheReady, scene])

  const restart = useCallback(async (field: typeof initialField, plan?: IndirectZonePlan) => {
    const version = generation.current
    ownedFields.current.add(field)
    preparing.current = true; preparingVersion.current = version
    const captureSceneStart = performance.now()
    const nextCaptureScene = await prepareIndirectCaptureScene(scene, localLights.length > 0, () => version !== generation.current)
    if (!nextCaptureScene) return
    if (version !== generation.current) { nextCaptureScene.dispose(); return }
    const cancelled = () => version !== generation.current
    for (const texture of [field.mask, field.positions, field.distances, ...field.maps, ...field.volume.maps, field.floorLayer.texture]) {
      if (!await prepareTextureUpload(gl, texture, cancelled)) { nextCaptureScene.dispose(); return }
    }
    if (bakeTriangles.current && !await prepareTextureUpload(gl, bakeTriangles.current, cancelled)) { nextCaptureScene.dispose(); return }
    const context = gl.getContext() as WebGL2RenderingContext
    const relightingSupported = !nextCaptureScene.scene.fog &&
      !gl.capabilities.logarithmicDepthBuffer && !gl.capabilities.reversedDepthBuffer &&
      gl.capabilities.maxTextures >= 16 && context.getParameter(context.MAX_DRAW_BUFFERS) >= 5
    const transportEnabled = scene.userData.indirectSurfaceCacheEnabled === true ||
      (scene.userData.indirectSurfaceCacheEnabled !== false && relightingSupported)
    const transportSupported = transportEnabled && supportsIndirectSurfaceCapture(nextCaptureScene.scene)
    const dynamicSun = relightingSupported && !!indirectSurfaceSun(scene)
    const staticLights = nextCaptureScene.scene.children.filter(object => object instanceof Light &&
      !(dynamicSun && object.userData.houseDesignerRole === 'sun-light')).map(object => {
      const light = object as Light
      return [light.type, light.position.toArray(), light.color.toArray(), light.intensity,
        'target' in light ? (light.target as { position: Vector3 }).position.toArray() : null]
    })
    const surfaceKey = transportSupported ? await prepareIndirectSurfaceCaptureKey(nextCaptureScene.scene, gl, cancelled) : ''
    if (cancelled() || surfaceKey === undefined) { nextCaptureScene.dispose(); return }
    const transportKey = transportSupported ? signature.current + ':' + surfaceKey + ':' +
      diffuseProbeResolution + ':' + dynamicSun + ':' + daylightBounceStrength + ':' + JSON.stringify([field.bounds, field.ranges, field.volume.n,
        field.probes.map(probe => [probe.index, probe.region.floorId, probe.position.toArray()])]) : ''
    if (transportKey !== surfaceCacheKey.current || !transportEnabled) {
      surfaceCache.current?.dispose(); surfaceCache.current = null; surfaceCacheKey.current = transportKey
    }
    if (transportSupported) {
      surfaceCache.current ??= createIndirectSurfaceCache(gl, field.probes.map(probe => probe.index), diffuseProbeResolution, uniforms, relightingSupported)
      surfaceCache.current?.setLightingKey(settingsKey + ':' + daylightBounceStrength + ':' + bakeTriangles.current?.uuid + ':' + JSON.stringify(staticLights))
    } else { surfaceCache.current?.dispose(); surfaceCache.current = null }
    surfaceSunEnabled.current = dynamicSun && !!surfaceCache.current?.relighting
    surfaceScene.current?.dispose(); surfaceScene.current = null
    if (surfaceCache.current) {
      surfaceScene.current = await prepareIndirectCaptureScene(scene, localLights.length > 0, cancelled)
      if (!surfaceScene.current || cancelled()) { nextCaptureScene.dispose(); return }
      surfaceScene.current.enableSurfaceRadianceCapture(surfaceCache.current.relighting)
      // Sun and lamps are evaluated by the shared relighter. The immutable
      // capture contains sky/emissive terms and never needs recapturing for a drag.
      if (dynamicSun && surfaceCache.current.relighting) {
        const sun = indirectSurfaceSun(surfaceScene.current.scene)
        if (sun) sun.intensity = 0
      }
    }
    captureScene.current?.dispose(); captureScene.current = nextCaptureScene
    multiview.current?.dispose(); multiview.current = null; multiviewProbe.current = false
    if (scene.userData.indirectMultiviewEnabled !== false && !surfaceCache.current) {
      try { multiview.current = createIndirectMultiview(gl, diffuseProbeResolution, nextCaptureScene.scene,
        scene.userData.indirectMultiviewViews === 2 ? 2 : 3) }
      catch (error) { console.warn('GI multiview unavailable; using cube captures:', error) }
    }
    const captureSceneMs = performance.now() - captureSceneStart
    workField.current = field; ownedFields.current.add(field)
    bakeVolumeReady.current = false
    partialBake.current = !!plan && !!baseline.current?.direct && plan.first.length > 0
    const previous = baseline.current, partial = partialBake.current
    captureRevision.current = revision; captureSettingsKey.current = settingsKey
    captureModelBounds.current = modelBounds.current
    directCoefficients.current = field.coefficients.map((data, colour) => previous?.direct?.[colour]?.slice() ?? new Uint16Array(data.length))
    bounceField.current?.dispose()
    if (bounceField.current) ownedFields.current.delete(bounceField.current)
    bounceField.current = createIndirectBounceField(field); ownedFields.current.add(bounceField.current)
    previewField.current = createIndirectPreviewField(field); ownedFields.current.add(previewField.current)
    previewFields.current.add(previewField.current); disposeUnusedPreviews()
    previewUpdated.current.clear(); refinedProbes.current.clear(); lastPreview.current = { completed: 0, time: -Infinity }
    capturedProbes.current.clear()
    face.current = 0
    field.coefficients.forEach(data => data.fill(0))
    const retained = new Map(previous?.field.probes.map(probe => [probe.index, probe]) ?? [])
    if (partial) for (const probe of field.probes) {
      const before = retained.get(probe.index)
      if (before?.region.floorId !== probe.region.floorId || before.position.distanceToSquared(probe.position) >= 1e-8) continue
      field.coefficients.forEach((data, colour) => data.set(previous!.final[colour].subarray(probe.index * 4, probe.index * 4 + 4), probe.index * 4))
      capturedProbes.current.add(probe.index)
    }
    const first = new Set(partial ? plan!.first : field.probes.map(probe => probe.index))
    const second = new Set(partial ? plan!.second : field.probes.map(probe => probe.index))
    updatedProbes.current = second
    const samples = field.probes.map(probe => ({ region: probe.region, position: probe.position, probe: probe.index, pass: 1 }))
      .sort((a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position))
    queue.current = prioritizeIndirectLighting<Sample>(samples.filter(sample => first.has(sample.probe)),
      samples.filter(sample => second.has(sample.probe)).map(sample => ({ ...sample, pass: 2 })),
      field.regions.filter(region => !partial || plan!.reflections.includes(region.id))
        .map(region => ({ region, position: region.centre, pass: 2, reflection: true })), !!previous?.direct && field.probes.every(probe => {
          const before = retained.get(probe.index)
          return before?.region.floorId === probe.region.floorId && before.position.distanceToSquared(probe.position) < 1e-8
        }))
    field.maps.forEach(map => { map.needsUpdate = true })
    // Keep the completed display volume and reflections while replacement light
    // is captured. The worker's geometry and lamp visibility survive sun edits.
    if (!displayField.current.floors.length) {
      displayField.current = field; updateIndirectUniforms(uniforms, field)
    }
    scene.userData.indirectLighting = { generation: generation.current, completed: 0, total: queue.current.length,
      rooms: field.regions.length, probes: field.probes.length, floorProbes: field.probes.filter(probe => probe.kind === 'floor').length,
      state: queue.current.length ? 'refining' : 'ready',
      multiviewViews: multiview.current?.views ?? 0, multiviewBatches: 0, multiviewProbes: 0,
      firstProbes: first.size, secondProbes: second.size, reusedProbes: partial ? plan!.reused : 0,
      zones: partial ? plan!.reflections.length : field.regions.length, partial,
      capturedFaces: 0, captureMs: 0, maxFaceMs: 0, maxInFlight: 0, previewUpdates: 0, firstPreviewMs: undefined,
      bakeStartedAt: performance.now(), roomMean: {}, worker: true, geometryBuilds: geometryBuilds.current,
      captureSceneMs, captureSceneMeshes: nextCaptureScene.sourceMeshes, captureMergedMeshes: nextCaptureScene.mergedMeshes,
      captureMaterials: nextCaptureScene.materials, captureDrawCalls: 0, captureTriangles: 0,
      surfaceCacheBytes: surfaceCache.current?.layout.bytes ?? 0, surfaceCachedProbes: surfaceCache.current?.ready.size ?? 0,
      surfaceReplayedProbes: 0, surfaceReusedFaces: 0, surfaceDataFaces: 0, surfaceRelitProbes: 0,
      surfaceRelighting: surfaceCache.current?.relighting ?? false }
    liveUpdates.current.begin(); liveSweep.current = true
    if (preparingVersion.current === version) preparing.current = false
    invalidate()
  }, [camera, disposeUnusedPreviews, invalidate, scene, uniforms, revision, settingsKey, localLights.length, gl, diffuseProbeResolution, daylightBounceStrength])

  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
    // Warmup waits for the first complete scan after a geometry/asset change.
    // Subsequent background checks leave the prepared display active.
    scene.userData.indirectScanPending = true
    const check = async () => {
      const next = await runViewportTask(scan(), () => cancelled)
      if (cancelled || next === undefined) return
      if (next !== signature.current) {
        signature.current = next
        if (loadedCacheKey.current !== cacheIdentity) requestSceneUpdate()
      }
      scene.userData.indirectScanPending = false
      invalidate()
      timer = setTimeout(() => { void check() },500)
    }
    void check()
    return () => { cancelled = true; clearTimeout(timer); scene.userData.indirectScanPending = false }
  }, [blocked, cacheIdentity, invalidate, layoutKey, revision, scan, scene, requestSceneUpdate])

  useEffect(() => {
    const structure = JSON.stringify([layoutKey, indirectLightingStructureKey(revision), daylightBounceStrength, localLights.map(light => light.position)])
    const uniformOnly = structure === requestedStructure.current
    requestedStructure.current = structure
    if (uniformOnly && !sceneUpdateRequested.current && (preparedKey.current || preparing.current || queue.current.length)) requestLiveUpdate()
    else requestSceneUpdate()
  }, [layoutKey, lightKey, revision, localLights, daylightBounceStrength, requestLiveUpdate, requestSceneUpdate])

  useEffect(() => {
    const pause = (event: Event) => {
      // Hovering menus must not stop the bake. Camera motion and active canvas input do.
      if (event.target === gl.domElement) interactionUntil.current = performance.now() + 200
    }
    gl.domElement.addEventListener('pointerdown', pause); gl.domElement.addEventListener('keydown', pause)
    return () => {
      gl.domElement.removeEventListener('pointerdown', pause); gl.domElement.removeEventListener('keydown', pause)
    }
  }, [gl])

  const beginLiveSweep = useCallback((plan?: IndirectZonePlan) => {
    const field = workField.current
    const previous = baseline.current
    generation.current++
    captureRevision.current = revision; captureSettingsKey.current = settingsKey
    captureModelBounds.current = modelBounds.current
    const partial = !!plan && !!previous?.direct && plan.first.length > 0
    partialBake.current = partial
    field.coefficients.forEach((data, color) => {
      if (previous) data.set(previous.final[color])
    })
    const first = new Set(partial ? plan.first : field.probes.map(probe => probe.index))
    const second = new Set(partial ? plan.second : field.probes.map(probe => probe.index))
    updatedProbes.current = second
    const samples = field.probes.map(probe => ({ region: probe.region, position: probe.position, probe: probe.index, pass: 1 }))
      .sort((a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position))
    queue.current = prioritizeIndirectLighting<Sample>(samples.filter(sample => first.has(sample.probe)),
      samples.filter(sample => second.has(sample.probe)).map(sample => ({ ...sample, pass: 2 })),
      field.regions.filter(region => !partial || plan.reflections.includes(region.id))
        .map(region => ({ region, position: region.centre, pass: 2, reflection: true })), !!previous?.direct)
    face.current = 0; bakeVolumeReady.current = false
    directCoefficients.current = field.coefficients.map((data, colour) => previous?.direct?.[colour]?.slice() ?? new Uint16Array(data.length))
    previewUpdated.current.clear(); refinedProbes.current.clear(); lastPreview.current = { completed: 0, time: -Infinity }
    previewField.current ??= createIndirectPreviewField(field)
    ownedFields.current.add(previewField.current); previewFields.current.add(previewField.current)
    Object.assign(scene.userData.indirectLighting, { generation: generation.current, state: 'refining', source: 'live',
      completed: 0, total: queue.current.length, firstProbes: first.size, secondProbes: second.size,
      reusedProbes: partial ? plan.reused : 0, partial, capturedFaces: 0, captureMs: 0, maxFaceMs: 0,
      surfaceDataFaces: 0, surfaceRelitProbes: 0, surfaceReplayedProbes: 0, captureDrawCalls: 0, captureTriangles: 0,
      previewUpdates: 0, firstPreviewMs: undefined, bakeStartedAt: performance.now() })
    scene.userData.indirectLighting.nearDiffuseReadyMs = undefined
    scene.userData.indirectLighting.nearReadyMs = undefined
    loadedCacheKey.current = ''; preparing.current = false
    invalidate()
  }, [camera, invalidate, revision, scene, settingsKey])

  useFrame((state, delta) => {
    if (!state.camera.matrixWorld.equals(cameraMatrix.current)) {
      cameraMatrix.current.copy(state.camera.matrixWorld); navigationUntil.current = performance.now() + 200
      markViewportNavigation()
    }
    const moving = isViewportNavigating() || performance.now() < Math.max(navigationUntil.current, interactionUntil.current)
    if (!sourceSun.current?.parent) sourceSun.current = indirectSurfaceSun(scene)
    const sun = sourceSun.current
    const sunKey = sun ? JSON.stringify([sun.position.toArray(), sun.color.toArray(), sun.intensity, sun.castShadow, sun.userData.indirectPreview]) : ''
    if (liveSunKey.current && liveSunKey.current !== sunKey) {
      globalLiveChange.current = true
      requestLiveUpdate()
      if (!preparedKey.current && !preparing.current && !pendingUpdate.current && !queue.current.length) requestSceneUpdate()
    }
    liveSunKey.current = sunKey
    const atomicWorkPending = preparing.current || warming.current || reading.current || volumePending.current ||
      reflectionPending.current || !!previewRequest.current
    const progress = scene.userData.indirectLighting
    const enoughProgress = !queue.current.length || (progress?.completed ?? 0) >= Math.min(4, progress?.total ?? 4)
    if (sceneUpdateRequested.current && !atomicWorkPending && !scene.userData.indirectScanPending &&
      enoughProgress && performance.now() - lastSceneReplacement.current >= 150) scheduleUpdate()
    // A replacement component can receive its first frame before passive
    // preparation effects initialize diagnostics (including after a roof edit).
    scene.userData.indirectLighting ??= { generation: generation.current, completed: 0, state: 'updating' }
    Object.assign(scene.userData.indirectLighting, { blocked, enabled, diffuseEnabled,
      preparing: preparing.current, warming: warming.current, reading: reading.current,
      inFlight: readbacks.current.size,
      volumePending: volumePending.current, previewPending: !!previewRequest.current, pendingUpdate: pendingUpdate.current,
      floorPreparing: floorPreparing.current, floorLayerReady: displayField.current.floorLayer.ready,
      volumeSamplingVersion: displayField.current.volumeSamplingVersion,
      displayed: uniforms.hdGIUseVolume.value === 1, xr: gl.xr.isPresenting,
      capturedProbes: capturedProbes.current.size, pass: queue.current[0]?.pass,
      reflection: queue.current[0]?.reflection ?? false, face: face.current,
      activeProbe: queue.current[0]?.probe,
      saving: saving.current, saved: !!exportedCache.current, source: loadedCacheKey.current ? 'saved' : 'baked',
      exportable: cacheExportable,
      continuous: !!surfaceCache.current?.relighting, lightingRevision: liveUpdates.current.revision,
      pendingLighting: liveUpdates.current.pending || sceneUpdateRequested.current,
      moving, paused: performance.now() < waitUntil.current })
    const canRestoreSaved = !cacheBlocked && !scene.userData.indirectScanPending && pendingUpdate.current &&
      cacheExportable && cacheSettings && attemptedCache.current !== cacheIdentity &&
      savedIndirectLightingMatches(savedCache, cacheProjectKey, cacheAssetKey, cacheSettings)
    // CPU refinement reuses saved captures and can proceed while display shaders warm.
    if (enabled && !gl.xr.isPresenting && !scene.userData.indirectScanPending && scene.userData.indirectLighting.state === 'ready' && !pendingUpdate.current && !preparing.current && !reading.current &&
      !volumePending.current && (!displayField.current.floorLayer.ready ||
        (displayField.current.floors.length > 1 && displayField.current.volumeSamplingVersion < INDIRECT_VOLUME_SAMPLING_VERSION)) &&
      !floorAttempted.current.has(displayField.current)) {
      // Upgrade old completed bakes from their existing coefficients. No probe or reflection recapture.
      const field = displayField.current, version = generation.current
      const refineVolume = field.floors.length > 1 && field.volumeSamplingVersion < INDIRECT_VOLUME_SAMPLING_VERSION
      floorAttempted.current.add(field); floorPreparing.current = true; floorVersion.current = version
      volumePending.current = true; scene.userData.indirectLighting.state = 'refining'
      const request = { field: serializeIndirectField(field), coefficients: field.coefficients, geometry: snapshotIndirectGeometry(scene) }
      void (refineVolume ? client.refineVolume(request) : client.floor(request).then(floor => ({ floor })))
        .then(async data => {
          if (version !== generation.current || displayField.current !== field) return
          field.floorLayer.data=data.floor as typeof field.floorLayer.data
          if ('volume' in data && 'mask' in data) {
            field.volume.data=data.volume as typeof field.volume.data
            ;(field.mask.image.data as Uint8Array).set(data.mask as Uint8Array);field.mask.needsUpdate=true
            if(!await uploadDisplayVolume(field,()=>version!==generation.current))return
            field.volumeSamplingVersion=INDIRECT_VOLUME_SAMPLING_VERSION
          } else {
            const previous=field.floorLayer.texture
            const replacement=await prepareTextureReplacement(gl,previous,()=>version!==generation.current,field.floorLayer.data)
            if(!replacement)return
            field.floorLayer.texture=replacement;field.floorLayer.ready=true;previous.dispose()
          }
          updateIndirectUniforms(uniforms, field)
          uniforms.hdGIUseVolume.value=1
          exportedCache.current = undefined; savedGeneration.current = -1
          scene.userData.indirectLighting.state = 'ready'
        }).catch(error => {
          if (version === generation.current) { scene.userData.indirectLighting.state = 'ready'; console.warn('GI floor refinement unavailable:', error) }
        }).finally(() => {
          if (floorVersion.current === version) floorPreparing.current = false
          if (version === generation.current) volumePending.current = false
          invalidate()
        })
      return
    }
    if (!enabled || (blocked && !canRestoreSaved) || gl.xr.isPresenting || performance.now() < waitUntil.current) return
    if (liveSweep.current && !queue.current.length && !atomicWorkPending && !pendingUpdate.current) {
      liveUpdates.current.finish(); liveSweep.current = false
      scene.userData.indirectLighting.state = liveUpdates.current.pending ? 'updating' : 'ready'
      baseline.current = { generation: generation.current, revision: captureRevision.current, settingsKey: captureSettingsKey.current,
        field: workField.current, direct: directCoefficients.current, final: workField.current.coefficients.map(data => data.slice()), bounds: captureModelBounds.current }
    }
    if (liveUpdates.current.pending && !liveSweep.current && !pendingUpdate.current && !atomicWorkPending &&
      !sceneUpdateRequested.current && !scene.userData.indirectScanPending) {
      if (surfaceCache.current?.relighting && preparedKey.current && captureScene.current) {
        // Keep the prepared worker, cached receivers, programs and textures.
        // A newer request updates subsequent probes and schedules one more sweep.
        liveUpdates.current.begin(); liveSweep.current = true
        const previous = baseline.current
        const changes = !globalLiveChange.current && previous?.direct
          ? indirectLocalChanges(previous.revision, revision, previous.bounds, modelBounds.current) : null
        globalLiveChange.current = false
        if (changes && previous) {
          const version = generation.current
          preparing.current = true
          void client.plan(indirectZoneProbes(previous.field), changes).then(plan => {
            if (generation.current === version) beginLiveSweep(plan)
          }).catch(error => {
            if (generation.current === version) beginLiveSweep()
            console.warn('GI live region planning unavailable:', error)
          }).finally(() => { preparing.current = false; invalidate() })
        } else beginLiveSweep()
      } else requestSceneUpdate()
      return
    }
    if (pendingUpdate.current && !preparing.current && !reading.current && !volumePending.current) {
      if (moving) return // Cold layout preparation may wait; prepared lighting keeps updating during navigation.
      pendingUpdate.current = false
      if (cacheExportable && cacheSettings && attemptedCache.current !== cacheIdentity &&
        savedIndirectLightingMatches(savedCache, cacheProjectKey, cacheAssetKey, cacheSettings)) {
        attemptedCache.current = cacheIdentity; preparing.current = true
        const version = generation.current
        scene.userData.indirectLighting.state = 'loading'
        scene.userData.indirectReflectionPending = true
        void loadIndirectLighting(savedCache!, { reflections: false }).then(async restored => {
          if (version !== generation.current) { restored.field.dispose(); restored.reflections.forEach(reflection => reflection.dispose()); return }
          const field = restored.field
          for (const texture of [field.mask, field.positions, field.distances, ...field.maps, ...field.volume.maps, field.floorLayer.texture]) {
            if (!await prepareTextureUpload(gl, texture, () => version !== generation.current)) {
              field.dispose(); restored.reflections.forEach(reflection => reflection.dispose()); return
            }
          }
          restoreReflections()
          ownedFields.current.forEach(field => field.dispose()); ownedFields.current.clear(); ownedFields.current.add(restored.field)
          previewFields.current.clear(); previewField.current = null
          workField.current = displayField.current = restored.field
          directCoefficients.current = restored.directCoefficients
          baseline.current = { generation: version, revision, settingsKey, field: restored.field,
            direct: restored.directCoefficients, final: restored.field.coefficients.map(data => data.slice()), bounds: modelBounds.current }
          capturedProbes.current = new Set(restored.field.probes.map(probe => probe.index))
          updateIndirectUniforms(uniforms, restored.field); uniforms.hdGIUseVolume.value = 1
          loadedCacheKey.current = cacheIdentity
          Object.assign(scene.userData.indirectLighting, { state: 'diffuse-ready', diffuseReady: true, source: 'saved', displayed: true })
          invalidate()
          // The first lit view needs the diffuse volume only. Defer reflection
          // decoding/uploads until that view has reached the GPU.
          while (!effectsAllowed.current && version === generation.current) await yieldToViewport()
          if (version !== generation.current) return
          const loadedReflections = await loadIndirectReflections(savedCache!)
          for (const reflection of loadedReflections) {
            if (!await prepareTextureUpload(gl, reflection.texture, () => version !== generation.current)) {
              loadedReflections.forEach(value => value.dispose()); return
            }
          }
          if (version !== generation.current) { loadedReflections.forEach(value => value.dispose()); return }
          loadedReflections.forEach(reflection => {
            const region = restored.field.regions.find(region => region.id === reflection.room)!
            reflections.current.set(indirectRegionKey(region), reflection)
          })
          // Keep the live display preference when exporting a reused bake.
          exportedCache.current = { ...savedCache!, settings: cacheSettings }
          savedGeneration.current = version; assignReflections(); onCacheReady?.(exportedCache.current)
          scene.userData.indirectLighting = { generation: version, state: 'ready', enabled, displayed: true, diffuseReady: true,
            probes: restored.field.probes.length, floorProbes: restored.field.probes.filter(probe => probe.kind === 'floor').length,
            rooms: restored.field.regions.length, reflections: reflections.current.size,
            completed: restored.field.probes.length * 2 + reflections.current.size, total: restored.field.probes.length * 2 + reflections.current.size,
            capturedFaces: 0, captureMs: 0, worker: false, geometryBuilds: 0, source: 'saved', saved: true }
          liveUpdates.current.reset(); liveSweep.current = false
          if (!requireSavedCache && obstacles.current.length && restored.field.floorProbeLayoutVersion < INDIRECT_FURNITURE_PROBE_VERSION) {
            // Retain the completed display while capturing the missing underside light.
            furnitureProbeUpgrade.current = true; pendingUpdate.current = true
            exportedCache.current = undefined; savedGeneration.current = -1; onCacheReady?.(undefined)
            scene.userData.indirectLighting.state = 'updating'
          }
        }).catch(error => { if (version === generation.current) {
          pendingUpdate.current = true
          scene.userData.indirectLighting.cacheReason = `Saved lighting could not load: ${error instanceof Error ? error.message : String(error)}`
          console.warn('Saved GI could not be loaded:', error)
        } })
          .finally(() => { if (version === generation.current) { preparing.current = false; scene.userData.indirectReflectionPending = false }; invalidate() })
        return
      }
      if (requireSavedCache) {
        scene.userData.indirectLighting.state = 'fallback'
        scene.userData.indirectLighting.cacheReason ??= savedCache?.projectKey !== cacheProjectKey ? 'Saved lighting does not match the house.'
          : savedCache?.assetKey !== cacheAssetKey ? 'Saved lighting does not match the materials or models.'
          : 'Saved lighting does not match the lighting settings.'
        scene.userData.indirectLighting.cacheKeys = { project: cacheProjectKey, assets: cacheAssetKey, geometry: indirectContentKey(geometrySignature.current) }
        console.warn('Saved GI could not be used:', JSON.stringify({ reason: scene.userData.indirectLighting.cacheReason,
          actual: scene.userData.indirectLighting.cacheKeys,
          saved: { project: savedCache?.projectKey, assets: savedCache?.assetKey, geometry: savedCache?.geometryKey } }))
        return
      }
      const lightPositions = localLights.map(light => light.position), lightPositionKey = JSON.stringify(lightPositions)
      const key = layoutKey + ':' + localLights.length + ':' + geometrySignature.current
      const previous = baseline.current
      const upgrade = furnitureProbeUpgrade.current
      if (upgrade) { generation.current++; furnitureProbeUpgrade.current = false }
      const changes = previous?.direct && previous.settingsKey === settingsKey ?
        (upgrade ? [] : indirectLocalChanges(previous.revision, revision, previous.bounds, modelBounds.current)) : null
      if (key === preparedKey.current) {
        if (preparedLightPositions.current !== lightPositionKey) {
          const version = generation.current
          preparing.current = true; preparingVersion.current = version
          void client.lights(lightPositions, changes ? { previous: indirectZoneProbes(previous!.field), changes } : undefined)
            .then(async result => {
              if (version !== generation.current) return
              // Keep the displayed visibility atlas intact while its replacement
              // is uploaded. Worker arrays are already transferred, not copied.
              const field = restoreIndirectField({ ...serializeIndirectField(workField.current),
                distanceData: result.distances as typeof workField.current.distanceData,
                positionData: result.positions as typeof workField.current.positionData })
              preparedLightPositions.current = lightPositionKey
              await restart(field, result.zonePlan)
            }).catch(error => {
              if (version === generation.current) {
                preparedKey.current = ''; pendingUpdate.current = true
                console.warn('GI light visibility update unavailable:', error)
              }
            }).finally(() => { if (preparingVersion.current === version) preparing.current = false; invalidate() })
          return
        }
        if (!changes) { void restart(workField.current); return }
        const version = generation.current
        preparing.current = true; preparingVersion.current = version
        void client.plan(indirectZoneProbes(previous!.field), changes).then(async plan => {
          if (version === generation.current) await restart(workField.current, plan)
        }).catch(async error => {
          if (version === generation.current) { await restart(workField.current); console.warn('GI local update unavailable:', error) }
        }).finally(() => { if (preparingVersion.current === version) preparing.current = false; invalidate() })
        return
      }
      preparing.current = true
      const version = generation.current, started = performance.now()
      scene.userData.indirectLighting.state = 'preparing'
      scene.userData.indirectLighting.prepareStage = undefined
      scene.userData.indirectLighting.prepareTimings = {}
      preparingVersion.current = version
      void client.prepare({ floors: JSON.parse(layoutKey) as IndirectFloor[], lights: localLights.map(light => light.position),
        geometry: snapshotIndirectGeometry(scene), obstacles: obstacles.current.map(({ bounds, geometry }) => ({ min: bounds.min.toArray(), max: bounds.max.toArray(), geometry })),
        zones: changes ? { previous: indirectZoneProbes(previous!.field), changes, captureNewOnly: upgrade } : undefined }, progress => {
          if (version !== generation.current) return
          Object.assign(scene.userData.indirectLighting, { prepareStage: progress.stage, prepareTimings: progress.timings })
          invalidate()
        })
        .then(async result => {
          if (version !== generation.current) return
          const field = restoreIndirectField(result.field)
          if (upgrade && !field.probes.some(probe => probe.kind === 'floor')) {
            // Solid furniture needs no new samples: retain the existing completed bake.
            field.dispose(); client.dispose(); preparedKey.current = ''
            displayField.current.floorProbeLayoutVersion = INDIRECT_FURNITURE_PROBE_VERSION
            scene.userData.indirectLighting.generation = version; scene.userData.indirectLighting.state = 'ready'
            return
          }
          const triangles = new DataTexture(result.triangles.data, result.triangles.width, result.triangles.height, RGBAFormat, FloatType)
          triangles.magFilter = triangles.minFilter = NearestFilter; triangles.generateMipmaps = false; triangles.needsUpdate = true
          if (!await prepareTextureUpload(gl, triangles, () => version !== generation.current)) { triangles.dispose(); return }
          bakeTriangles.current?.dispose()
          bakeTriangles.current = triangles
          uniforms.hdGITriangles.value = triangles
          uniforms.hdGITriangleSize.value.set(result.triangles.width, result.triangles.height)
          preparedKey.current = key
          preparedLightPositions.current = lightPositionKey
          geometryBuilds.current++
          await restart(field, result.zonePlan)
          scene.userData.indirectLighting.prepareMs = performance.now() - started
          scene.userData.indirectLighting.prepareTimings = result.prepareTimings
        }).catch(error => {
          if (version === generation.current) { scene.userData.indirectLighting.state = 'fallback'; console.warn('GI worker unavailable:', error) }
        }).finally(() => { if (preparingVersion.current === version) preparing.current = false; invalidate() })
      return
    }
    if (scene.userData.indirectLighting.state === 'ready' && !volumePending.current && !reading.current && !pendingUpdate.current &&
      baseline.current?.generation !== generation.current) {
      baseline.current = { generation: generation.current, revision: captureRevision.current, settingsKey: captureSettingsKey.current,
        field: workField.current, direct: directCoefficients.current, final: workField.current.coefficients.map(data => data.slice()), bounds: captureModelBounds.current }
    }
    if (scene.userData.indirectLighting.state === 'ready' && !volumePending.current && !reading.current && !pendingUpdate.current &&
      !liveUpdates.current.pending && !sceneUpdateRequested.current && !sun?.userData.indirectPreview &&
      cacheExportable && cacheSettings && cacheProjectKey && savedGeneration.current !== generation.current && !saving.current) {
      const version = generation.current, field = workField.current
      savedGeneration.current = version; saving.current = true
      const geometryKey = indirectContentKey(geometrySignature.current)
      void Promise.all(field.regions.flatMap(region => {
        const reflection = reflections.current.get(indirectRegionKey(region))
        return reflection ? [{ room: region.id, reflection }] : []
      }).map(async ({ room, reflection }) => {
        if (reflection.texture instanceof DataTexture) {
          const { width, height, data } = reflection.texture.image
          return { room, width, height, data: data as Uint16Array }
        }
        const target = reflection as WebGLRenderTarget
        const data = new Uint16Array(target.width * target.height * 4)
        await gl.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, data)
        return { room, width: target.width, height: target.height, data }
      })).then(pixels => saveIndirectLighting(field, cacheProjectKey, cacheAssetKey, geometryKey, cacheSettings, pixels, directCoefficients.current))
        .then(cache => { if (version === generation.current) { exportedCache.current = cache; onCacheReady?.(cache) } })
        .catch(error => console.warn('GI could not be saved with the project:', error))
        .finally(() => {
          saving.current = false
          // The progress subscriber runs before this component. Publish completion
          // before the final demand frame so an idle scene cannot retain "saving".
          if (scene.userData.indirectLighting) Object.assign(scene.userData.indirectLighting,
            { saving: false, saved: !!exportedCache.current })
          invalidate()
        })
    }
    if (preparing.current || volumePending.current || warming.current || reflectionPending.current || pendingUpdate.current || !queue.current.length) return
    // Superseded lighting never spends a cube capture on obsolete reflections.
    // Diffuse work already published remains useful while the next sweep starts.
    if (queue.current.every(sample => sample.reflection) && liveUpdates.current.changedDuringSweep) {
      queue.current = []; scene.userData.indirectLighting.state = 'updating'; invalidate(); return
    }
    // Bound queued GPU work, and drain every read before changing bounce input
    // or starting reflections. A readback wait need not stop the next probe.
    if (readbacks.current.size >= 1 || [...readbacks.current].some(read =>
      read.pass !== queue.current[0].pass || queue.current[0].reflection)) return
    const legacyBudget = scene.userData.indirectLegacyCaptureBudget === true // Diagnostic timing control.
    const faceBudget = liveIndirectFaceBudget(delta, moving, performance.now(), lastCapture.current, legacyBudget)
    if (!faceBudget) return
    // Keep the navigation face budget. A partly completed multiview probe waits
    // for an idle frame; probes begun while moving retain ordinary cube capture.
    if (moving && multiviewProbe.current && face.current > 0) return
    const deadline = performance.now() + (legacyBudget ? 3 : liveIndirectTimeBudget(delta, moving, !!surfaceCache.current?.relighting))
    const captureNext = () => {
      const capture = resources.diffuse.get(diffuseProbeResolution)!
      if (!capture.ready) {
        warming.current = true
        void capture.integrator.compile(gl, capture.target).then(() => { capture.ready = true })
          .catch(error => { queue.current = []; scene.userData.indirectLighting.state = 'fallback'; console.warn('GI integration shader unavailable:', error) })
          .finally(() => { warming.current = false; invalidate() })
        return
      }
      const field = workField.current
      const sample = queue.current[0], version = generation.current
      const transport = !sample.reflection ? surfaceCache.current : null
      if (face.current === 0) multiviewProbe.current = !!multiview.current && !sample.reflection && !transport && !moving
      const batch = multiviewProbe.current ? multiview.current : null
      if (batch && !batch.ready) {
        warming.current = true
        void batch.compileIntegration().catch(error => {
          batch.dispose(); if (multiview.current === batch) multiview.current = null
          multiviewProbe.current = false
          console.warn('GI multiview integration unavailable; using cube captures:', error)
        }).finally(() => { warming.current = false; invalidate() })
        return
      }
      if (transport && !transport.compiled) {
        warming.current = true
        void transport.compile().catch(error => {
          if (surfaceCache.current === transport) {
            transport.dispose(); surfaceCache.current = null
            surfaceScene.current?.dispose(); surfaceScene.current = null
            face.current = 0
          }
          console.warn('GI surface cache unavailable:', error)
        }).finally(() => { warming.current = false; invalidate() })
        return
      }
      const replay = !!transport && sample.pass === 2 && transport.ready.has(sample.probe!)
      const relight = sample.pass === 1 && !!transport?.canRelight(sample.probe!)
      const captureDirect = !!transport && sample.pass === 1
      const captureSurface = captureDirect && !transport!.ready.has(sample.probe!)
      // Capture static radiance without local lamps. Their PBR and visibility
      // are evaluated by one shared fullscreen shader, including the first
      // bake, avoiding heavy per-material/local-light-count MRT variants.
      const captureStatic = captureDirect && !relight && transport!.relighting
      let replayResult: ReturnType<NonNullable<typeof transport>['read']> | undefined
      const bakeScene = sample.reflection ? captureScene.current!.scene : captureSurface ? surfaceScene.current!.scene : batch?.scene ?? captureScene.current!.scene
      const cubeCamera = sample.reflection ? resources.reflectionCamera : capture.camera
      const cubeTarget = sample.reflection ? resources.reflectionTarget : capture.target
      if (face.current === 0) {
        cubeCamera.position.copy(sample.position)
        if (sample.probe !== undefined) cubeCamera.position.fromArray(field.positionData, sample.probe * 4)
        cubeCamera.updateMatrixWorld(true)
      }
      const target = gl.getRenderTarget(), cubeFace = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
      const xr = gl.xr.enabled, autoUpdate = gl.shadowMap.autoUpdate, background = bakeScene.background, autoClear = gl.autoClear
      const shadowsEnabled = gl.shadowMap.enabled, shadowsNeedUpdate = gl.shadowMap.needsUpdate
      // Keep the same bounded point/spot slots for every probe. Distance and
      // zero power are uniforms; filtering lights per room compiled another
      // complete material family at every new light-count combination. Cached
      // visibility uses shared atlases, not one texture sampler per lamp.
      const activeLights = captureLights
      const stats = { ...gl.info.render }
      const pointIndices = uniforms.hdGIPointIndices.value.slice(), spotIndices = uniforms.hdGISpotIndices.value.slice()
      const hidden: { object: Mesh; visible: boolean }[] = []
      const transparent: { material: Material; opacity: number; visible: boolean; depthWrite: boolean }[] = []
      const seen = new Set<Material>()
      const lightIntensities: { light: PointLight | SpotLight; intensity: number; visible: boolean }[] = []
      const captureSun = indirectSurfaceSun(bakeScene)
      const capturedSunIntensity = captureSun?.intensity
      // Scale daylight sources once per diffuse capture, never the incoming
      // bounce field or the visible sun/reflection capture.
      const daylightStrength = sample.reflection ? 1 : daylightBounceStrength
      if (captureSun && sun) {
        captureSun.position.copy(sun.position); captureSun.color.copy(sun.color); captureSun.intensity = sun.intensity * daylightStrength
        captureSun.target.position.copy(sun.target.position)
        captureSun.updateMatrixWorld(true); captureSun.target.updateMatrixWorld(true)
        if (captureStatic && surfaceSunEnabled.current) captureSun.intensity = 0
      }
      // Captures represent the building, rather than camera-dependent wall fades.
      if (sample.reflection) bakeScene.traverse(object => {
        if (localLights.length && (object instanceof PointLight || object instanceof SpotLight)) {
          lightIntensities.push({ light: object, intensity: object.intensity, visible: object.visible })
          object.intensity = 0; object.visible = false
        }
        if (!(object instanceof Mesh)) return
        if (object.userData.selectionDecoration || object.userData.houseDesignerRole === 'ground-image') {
          hidden.push({ object, visible: object.visible }); object.visible = false; return
        }
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (seen.has(material)) continue
          seen.add(material)
          if (!material.transparent) continue
          transparent.push({ material, opacity: material.opacity, visible: material.visible, depthWrite: material.depthWrite })
          // Invisible picking planes are editor helpers, not building surfaces.
          // Keep shader-defining flags untouched: compiling with transparent=false
          // bakes OPAQUE into the live shader, overriding opacity after restoration.
          if (!(material instanceof MeshStandardMaterial) || /glass|glazing/i.test(material.name)) material.visible = false
          else {
            material.opacity = 1
            // Faded walls must also write depth during capture, or farther faces
            // in the same render batch can overwrite them and leak room light.
            material.depthWrite = true
          }
        }
      })
      const displayVolumeEnabled = uniforms.hdGIUseVolume.value
      updateIndirectUniforms(uniforms, sample.pass === 2 && bounceField.current ? bounceField.current : field)
      uniforms.hdGIUseVolume.value = bakeVolumeReady.current ? 1 : 0
      const captureStart = performance.now()
      try {
        gl.xr.enabled = false; gl.shadowMap.autoUpdate = false
        // Reuse sun shadows. Cached geometry visibility supplies local occlusion
        // without shadow-pass state changes or additional capture shadow maps.
        gl.shadowMap.enabled = shadowsEnabled; gl.shadowMap.needsUpdate = false
        uniforms.hdGIPointIndices.value.fill(-1); uniforms.hdGISpotIndices.value.fill(-1)
        let pointIndex = 0, spotIndex = 0
        for (const light of activeLights) {
          const index = captureLights.indexOf(light)
          const indices = light instanceof SpotLight ? uniforms.hdGISpotIndices.value : uniforms.hdGIPointIndices.value
          indices[light instanceof SpotLight ? spotIndex++ : pointIndex++] = index < INDIRECT_MAX_LOCAL_LIGHTS
            ? INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + index : -1
        }
        uniforms.hdGICapture.value = sample.pass
        roomLightCaptureUniform.value = 1
        for (const light of captureStatic ? [] : activeLights) {
          bakeScene.add(light); light.updateMatrixWorld(true)
          if (light instanceof SpotLight) { bakeScene.add(light.target); light.target.updateMatrixWorld(true) }
        }
        const sky = daylight ? resources.sky.setRGB(.65, .72, .82).multiplyScalar(daylightStrength) : resources.sky.setRGB(0, 0, 0)
        // MRT background clearing must leave receiver attachments empty.
        bakeScene.background = captureSurface ? null : sky
        if (!replay) gl.setRenderTarget(captureSurface ? transport!.target : batch?.target ?? cubeTarget, batch || captureSurface ? 0 : face.current)
        const programKey = `${sample.reflection ? 'reflection' : captureSurface ? 'surface-radiance' : 'diffuse'}:${batch ? `multiview-${batch.views}:` : ''}` + (captureStatic ? [] : activeLights).map(light => light.type).sort().join(',')
        if (!replay && !relight && capturePrograms.current.get(programKey)?.signature !== signature.current) {
          // Prepare offscreen/light-count variants with parallel shader compilation
          // before their first capture. Retain the materials so programs stay cached.
          let snapshot: ReturnType<typeof createShaderWarmupSnapshot> | undefined
          const captureSignature = signature.current
          warming.current = true
          const compileScene = new Scene()
          compileScene.environment = bakeScene.environment; compileScene.environmentIntensity = bakeScene.environmentIntensity
          compileScene.environmentRotation.copy(bakeScene.environmentRotation); compileScene.fog = bakeScene.fog
          bakeScene.traverseVisible(object => { if (object instanceof Light) compileScene.add(object.clone(false)) })
          const compileTarget = gl.getRenderTarget(), compileFace = gl.getActiveCubeFace(), compileMip = gl.getActiveMipmapLevel()
          const compileCamera = cubeCamera.children[face.current] as Camera
          void prepareShaderWarmupSnapshot(bakeScene, { fadeWalls: false, fadeRoofs: false }, () => generation.current !== version).then(async prepared => {
            if (!prepared) return
            snapshot = prepared
            let ready = await compileShaderWarmup(gl, prepared.root, compileCamera, compileScene, {
            cancelled: () => generation.current !== version,
            compile: group => {
              const previous = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
              try {
                gl.setRenderTarget(compileTarget, compileFace, compileMip)
                const compile = () => gl.compileAsync(group, compileCamera, compileScene)
                return batch ? batch.withShaders(compile) : compile()
              } finally { gl.setRenderTarget(previous, face, mip) }
            },
            })
            if (ready) ready = await prepareShaderWarmupResources(gl,prepared.root,compileCamera,compileScene,true,()=>generation.current!==version,
              resourceScene => { const draw=()=>gl.render(resourceScene,compileCamera);if(batch)batch.withShaders(draw);else draw() },compileTarget)
            if (!ready || generation.current !== version) { prepared.dispose(); return }
            capturePrograms.current.get(programKey)?.snapshot.dispose()
            capturePrograms.current.set(programKey, { signature: captureSignature, snapshot: prepared })
          }).catch(error => {
            snapshot?.dispose()
            if (captureSurface && generation.current === version && surfaceCache.current === transport) {
              transport!.dispose(); surfaceCache.current = null
              surfaceScene.current?.dispose(); surfaceScene.current = null; face.current = 0
            } else if (generation.current === version) {
              // A deterministic compile failure cannot heal on the next frame.
              // Preserve the available display and report the failure once.
              queue.current = []; face.current = 0
              liveSweep.current = false; liveUpdates.current.reset()
              scene.userData.indirectLighting.state = 'fallback'
              scene.userData.indirectLighting.shaderError = error instanceof Error ? error.message : String(error)
            }
            console.warn('GI shader preparation unavailable:', error)
          })
            .finally(() => { warming.current = false; invalidate() })
          return
        }
        // Use available stationary-frame time; navigation retains its small budget.
        // Static captures omit local PBR/visibility work and can match the
        // three-view batch's face budget while stationary. Navigation keeps
        // one face; the existing time deadline still bounds submission.
        const maxFaces = legacyBudget ? faceBudget : batch?.views ?? (captureStatic ? Math.min(faceBudget, 3) : 1)
        let captured = 0, dataCaptured = 0
        if (relight) {
          replayResult = transport!.relight(sample.probe!, cubeCamera.position.toArray(), indirectSurfaceLights(activeLights, localLights), surfaceSunEnabled.current ? sun : undefined, daylightStrength)
          face.current = 6
          scene.userData.indirectLighting.surfaceRelitProbes++
          scene.userData.indirectLighting.surfaceReusedFaces += 6
        } else if (replay) {
          replayResult = transport!.read(sample.probe!, 2); face.current = 6
          scene.userData.indirectLighting.surfaceReplayedProbes++
          scene.userData.indirectLighting.surfaceReusedFaces += 6
        } else do {
          const renderGeometry = (captureScene: typeof bakeScene) => {
            const beforeCalls = gl.info.render.calls, beforeTriangles = gl.info.render.triangles
            gl.render(captureScene, cubeCamera.children[face.current] as Camera)
            scene.userData.indirectLighting.captureDrawCalls += gl.info.render.calls - (gl.info.autoReset ? 0 : beforeCalls)
            scene.userData.indirectLighting.captureTriangles += gl.info.render.triangles - (gl.info.autoReset ? 0 : beforeTriangles)
          }
          if (captureSurface) {
            gl.autoClear = false; transport!.beginFace(sample.probe!, face.current, sky)
            renderGeometry(bakeScene); dataCaptured++
            gl.autoClear = autoClear
          } else if (batch) {
            const beforeCalls = gl.info.render.calls, beforeTriangles = gl.info.render.triangles
            batch.render(cubeCamera, face.current, sky)
            scene.userData.indirectLighting.captureDrawCalls += gl.info.render.calls - (gl.info.autoReset ? 0 : beforeCalls)
            scene.userData.indirectLighting.captureTriangles += gl.info.render.triangles - (gl.info.autoReset ? 0 : beforeTriangles)
            scene.userData.indirectLighting.multiviewBatches++
          } else {
            gl.setRenderTarget(cubeTarget, face.current); gl.clear()
            renderGeometry(bakeScene)
          }
          if (captureDirect) transport!.copyFace(sample.probe!, face.current, sky, cubeTarget, captureSurface)
          const faces = batch?.views ?? 1
          face.current += faces; captured += faces
        } while (face.current < 6 && captured < maxFaces && performance.now() < deadline)
        scene.userData.indirectLighting.lastCapture = { position: cubeCamera.position.toArray(),
          calls: gl.info.render.calls - (gl.info.autoReset ? 0 : stats.calls), pass: sample.pass, face: face.current - 1, faces: captured }
        scene.userData.indirectLighting.capturedFaces += captured
        scene.userData.indirectLighting.surfaceDataFaces += dataCaptured
        lastCapture.current = performance.now()
        if (captureDirect && !relight && face.current === 6) {
          transport!.recordLights(sample.probe!, captureStatic ? [] : indirectSurfaceLights(activeLights, localLights))
          transport!.ready.add(sample.probe!); scene.userData.indirectLighting.surfaceCachedProbes = transport!.ready.size
          replayResult = captureStatic
            ? transport!.relight(sample.probe!, cubeCamera.position.toArray(), indirectSurfaceLights(activeLights, localLights), surfaceSunEnabled.current ? sun : undefined, daylightStrength)
            : transport!.read(sample.probe!, 1)
        }
      } finally {
        uniforms.hdGICapture.value = 0
        updateIndirectUniforms(uniforms, displayField.current)
        uniforms.hdGIUseVolume.value = displayVolumeEnabled
        uniforms.hdGIPointIndices.value.set(pointIndices); uniforms.hdGISpotIndices.value.set(spotIndices)
        roomLightCaptureUniform.value = 0
        for (const light of activeLights) { bakeScene.remove(light); if (light instanceof SpotLight) bakeScene.remove(light.target) }
        lightIntensities.forEach(({ light, intensity, visible }) => { light.intensity = intensity; light.visible = visible })
        if (captureSun && capturedSunIntensity !== undefined) captureSun.intensity = capturedSunIntensity
        bakeScene.background = background; gl.xr.enabled = xr; gl.shadowMap.autoUpdate = autoUpdate; gl.autoClear = autoClear
        gl.shadowMap.enabled = shadowsEnabled; gl.shadowMap.needsUpdate = shadowsNeedUpdate
        transparent.forEach(state => { Object.assign(state.material, { opacity: state.opacity, visible: state.visible, depthWrite: state.depthWrite }) })
        hidden.forEach(state => { state.object.visible = state.visible })
        gl.setRenderTarget(target, cubeFace, mip)
        Object.assign(gl.info.render, stats)
      }
      const captureMs = performance.now() - captureStart
      const captureStatus = scene.userData.indirectLighting
      captureStatus.captureMs += captureMs
      captureStatus.maxFaceMs = Math.max(captureStatus.maxFaceMs, captureMs)
      if (face.current === 6) {
        if (sample.reflection) {
          const reflectionKey = indirectRegionKey(sample.region)
          reflectionPending.current = true; reading.current = true
          queue.current.shift(); face.current = 0
          void reflectionClient.filter(gl, cubeTarget).then(reflection => {
            if (generation.current !== version) { reflection.dispose(); return }
            const previous = reflections.current.get(reflectionKey)
            reflections.current.set(reflectionKey, reflection); assignReflections(); previous?.dispose()
          }).catch(error => console.warn('Room reflection filtering unavailable:', error)).finally(() => {
            reflectionPending.current = false; reading.current = readbacks.current.size > 0
            if (generation.current === version) {
              const status = scene.userData.indirectLighting
              status.completed++; status.reflections = reflections.current.size
              status.state = queue.current.length || liveUpdates.current.changedDuringSweep ? 'refining' : 'ready'
              if (queue.current.some(sample => sample.pass === 1)) status.nearReadyMs ??= performance.now() - status.bakeStartedAt
            }
            invalidate()
          })
          invalidate(); return
        }
        reading.current = true
        const read = { pass: sample.pass } as { pass: number; promise?: Promise<void> }
        readbacks.current.add(read)
        captureStatus.maxInFlight = Math.max(captureStatus.maxInFlight ?? 0, readbacks.current.size)
        if (batch) captureStatus.multiviewProbes++
        const result = replayResult ?? batch?.read() ?? capture.integrator.read(gl, capture.target)
        queue.current.shift(); face.current = 0
        read.promise = result.then(sh => {
          readbacks.current.delete(read); reading.current = readbacks.current.size > 0
          if (generation.current !== version || scene.userData.indirectLighting.state === 'fallback') return
          writeIndirectProbe(field, sample.probe!, sh)
          if (sample.pass === 1) field.coefficients.forEach((data, colour) =>
            directCoefficients.current![colour].set(data.subarray(sample.probe! * 4, sample.probe! * 4 + 4), sample.probe! * 4))
          else refinedProbes.current.add(sample.probe!)
          capturedProbes.current.add(sample.probe!)
          previewUpdated.current.add(sample.probe!)
          const status = scene.userData.indirectLighting
          status.roomMean[sample.region.id] = sh.coefficients[0].toArray().map(value => value * .886227)
          status.completed++; status.state = queue.current.length || readbacks.current.size || liveUpdates.current.changedDuringSweep ? 'refining' : 'ready'
          const passComplete = readbacks.current.size === 0 &&
            (!queue.current.length || queue.current[0].pass !== sample.pass || queue.current[0].reflection)
          if ((!passComplete || sample.pass === 1) && !previewRequest.current &&
            shouldPublishLivePreview(status.completed, lastPreview.current.completed, performance.now(), lastPreview.current.time)) {
            const request = {}, display = previewField.current!
            previewRequest.current = request
            lastPreview.current = { completed: status.completed, time: performance.now() }
            const snapshot = indirectPreviewCoefficients(field, previewUpdated.current, sample.pass, baseline.current)
            if (sample.pass === 1) for (const index of refinedProbes.current) if (!previewUpdated.current.has(index))
              snapshot.coefficients.forEach((data, colour) => data.set(field.coefficients[colour].subarray(index * 4, index * 4 + 4), index * 4))
            void client.preview(snapshot.coefficients, snapshot.positions).then(async data => {
              if (generation.current !== version || previewRequest.current !== request) return
              display.volume.data=data.volume as typeof display.volume.data;display.floorLayer.data=data.floor as typeof display.floorLayer.data
              if(!await uploadDisplayVolume(display,()=>generation.current!==version||previewRequest.current!==request))return
              displayField.current = display
              disposeUnusedPreviews()
              updateIndirectUniforms(uniforms, display); uniforms.hdGIUseVolume.value = 1
              const live = scene.userData.indirectLighting
              live.previewUpdates++; live.firstPreviewMs ??= performance.now() - live.bakeStartedAt
              live.lastPreviewCompleted = lastPreview.current.completed
            }).catch(error => {
              if (generation.current === version) console.warn('GI preview unavailable:', error)
            }).finally(() => { if (previewRequest.current === request) previewRequest.current = null; invalidate() })
          }
          if (passComplete) {
            if (sample.pass === 2) previewRequest.current = null
            if (sample.pass === 2 && partialBake.current) {
              const previous = baseline.current!
              for (const probe of field.probes) if (!updatedProbes.current.has(probe.index))
                field.coefficients.forEach((data, colour) => data.set(previous.final[colour].subarray(probe.index * 4, probe.index * 4 + 4), probe.index * 4))
              field.maps.forEach(map => { map.needsUpdate = true })
            }
            volumePending.current = true
            previewUpdated.current.clear()
            const output = sample.pass === 1 ? bounceField.current! : field
            void client.volume(sample.pass === 1 ? directCoefficients.current! : field.coefficients, field.positionData).then(async data => {
              if (generation.current !== version) return
              output.volume.data=data.volume as typeof output.volume.data;output.floorLayer.data=data.floor as typeof output.floorLayer.data
              if(!await uploadDisplayVolume(output,()=>generation.current!==version))return
              // Only full-resolution pass boundaries replace the bounce input.
              bakeVolumeReady.current = true
              if (sample.pass === 1) return
              displayField.current = field
              updateIndirectUniforms(uniforms, field); uniforms.hdGIUseVolume.value = 1
              if (queue.current.some(sample => sample.pass === 1))
                scene.userData.indirectLighting.nearDiffuseReadyMs ??= performance.now() - scene.userData.indirectLighting.bakeStartedAt
              const liveRegions = new Set(field.regions.map(indirectRegionKey)), obsoleteReflections: { dispose(): void }[] = []
              reflections.current.forEach((reflection, key) => {
                if (!liveRegions.has(key)) { reflections.current.delete(key); obsoleteReflections.push(reflection) }
              })
              assignReflections()
              obsoleteReflections.forEach(reflection => reflection.dispose())
              // Dispose replaced layouts only after their lighting is no longer displayed.
              ownedFields.current.forEach(previous => {
                if (previous !== field && previous !== previewField.current && previous !== bounceField.current) {
                  previous.dispose(); ownedFields.current.delete(previous); previewFields.current.delete(previous)
                }
              })
            }).catch(error => { if (generation.current === version) console.warn('GI volume update unavailable:', error) })
              .finally(() => { if (generation.current === version) volumePending.current = false; invalidate() })
          }
          invalidate()
        }).catch(error => {
          // Unsupported GPU readback keeps the conservative indoor fill usable.
          if (generation.current === version) {
            queue.current = []; face.current = 0; scene.userData.indirectLighting.state = 'fallback'
            console.warn('Indirect lighting capture unavailable:', error)
          }
        }).finally(() => {
          readbacks.current.delete(read); reading.current = readbacks.current.size > 0
          invalidate()
        })
      }
      invalidate()
    }
    captureNext()
    // Never queue another probe ahead of a newly requested display frame.
    while (!warming.current && faceBudget === 6 && face.current === 0 && queue.current.length &&
      !queue.current[0].reflection && readbacks.current.size < 1 && performance.now() < deadline &&
      [...readbacks.current].every(read => read.pass === queue.current[0].pass)) captureNext()
  }, 2)

  useEffect(() => () => { captureLights.forEach(light => light.dispose()) }, [captureLights])
  useEffect(() => () => {
    generation.current++
    client.dispose(); bakeTriangles.current?.dispose(); bakeTriangles.current = null
    captureScene.current?.dispose(); captureScene.current = null
    surfaceScene.current?.dispose(); surfaceScene.current = null
    surfaceCache.current?.dispose(); surfaceCache.current = null
    capturePrograms.current.forEach(program => program.snapshot.dispose()); capturePrograms.current.clear()
    ownedFields.current.forEach(field => field.dispose()); ownedFields.current.clear()
    previewFields.current.clear()
    restorers.current.forEach(restore => restore()); restorers.current.clear()
    // Keep the integration target alive until its asynchronous readback settles.
    const batch = multiview.current; multiview.current = null
    const disposeCaptures = () => {
      resources.diffuse.forEach(capture => { capture.target.dispose(); capture.integrator.dispose() })
      batch?.dispose()
    }
    if (readbacks.current.size) void Promise.allSettled([...readbacks.current].map(read => read.promise)).then(disposeCaptures)
    else disposeCaptures()
    resources.reflectionTarget.dispose(); reflectionClient.dispose(); restoreReflections()
    delete scene.userData.indirectLighting
    delete scene.userData.indirectReflectionPending
  }, [client, reflectionClient, resources, restoreReflections, scene])
  return <>
    {showProbes && <IndirectLightingProbes snapshot={probeSnapshot} />}
    {inspectPoint && <IndirectLightingInspector enabled snapshot={() => ({ field: displayField.current, generation: generation.current,
      ready: scene.userData.indirectLighting?.state === 'ready' && !pendingUpdate.current && !preparing.current && !volumePending.current,
      direct: baseline.current?.direct, lights: localLights.map(light => ({ position: light.position, color: light.color })) })} />}
  </>
}
