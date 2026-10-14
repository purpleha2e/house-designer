/* eslint-disable react-hooks/immutability -- Cached Three.js resources are updated imperatively. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Color, CubeCamera, HalfFloatType, LinearSRGBColorSpace, Material, Matrix4, Mesh,
  MeshStandardMaterial, PMREMGenerator, PointLight, SpotLight, RGBAFormat, DataTexture, FloatType, NearestFilter, Vector3,
  WebGLCubeRenderTarget, type Camera, type Texture, type WebGLRenderTarget } from 'three'
import { createIndirectProbeIntegrator } from '../indirectProbeIntegration'
import { createIndirectSurfaceCache, indirectSurfaceCaptureKey, supportsIndirectSurfaceCapture } from '../indirectSurfaceCache'
import { indirectContentKey, loadIndirectLighting, saveIndirectLighting, savedIndirectLightingMatches,
  type IndirectLightingSettings, type SavedIndirectLighting } from '../indirectLightingPersistence'
import { createIndirectField, restoreIndirectField, serializeIndirectField, INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, indirectGeometryFingerprint, writeIndirectProbe, type IndirectFloor, type IndirectRegion } from '../indirectLighting'
import { snapshotIndirectGeometry } from '../indirectVisibility'
import { IndirectLightingClient } from '../indirectLightingClient'
import { applyIndirectLightingShader, createIndirectUniforms, setIndirectLocalReflection, updateIndirectUniforms } from '../indirectLightingShader'
import { applySpecularOnlyImageBasedLighting } from '../materials/imageBasedLighting'
import { pointIsInsideRoomPolygon } from '../roomLightMask'
import { roomLightCaptureUniform } from '../roomLightShader'
import { createShaderWarmupSnapshot } from '../shaderWarmup'
import { createIndirectPreviewField, indirectPreviewCoefficients, liveIndirectFaceBudget, liveIndirectTimeBudget, shouldPublishLivePreview } from '../indirectLivePreview'
import { IndirectLightingProbes } from './IndirectLightingProbes'
import { IndirectLightingInspector } from './IndirectLightingInspector'
import { DIFFUSE_PROBE_RESOLUTIONS, type DiffuseProbeResolution } from '../indirectProbeResolution'
import { indirectLocalChanges, indirectRegionKey, indirectZoneProbes, type IndirectZonePlan, type IndirectModelBounds } from '../indirectLightingZones'
import { INDIRECT_FURNITURE_PROBE_VERSION } from '../indirectFurnitureProbes'
import { createIndirectCaptureScene } from '../indirectCaptureScene'
import { createIndirectMultiview } from '../indirectMultiview'

type Sample = { region: IndirectRegion; position: Vector3; probe?: number; pass: number; reflection?: boolean }
export type IndirectLocalLight = { position: [number, number, number]; target: [number, number, number];
  kind: 'point' | 'spot'; color: string; power: number; distance: number; falloff: number; angle: number; penumbra: number }
const NO_LOCAL_LIGHTS: IndirectLocalLight[] = []

/** Progressive world-space GI with bounded capture batches and portable completed lighting. */
export function IndirectLighting({ floors, revision, blocked, enabled, indoorFill, daylight, localLights: inputLights = NO_LOCAL_LIGHTS, showProbes = false,
  savedCache, cacheProjectKey = '', cacheAssetKey = '', cacheSettings, cacheExportable = false, onCacheReady, requireSavedCache = false,
  diffuseProbeResolution = 16, diffuseEnabled = true, inspectPoint = false }: {
  inspectPoint?: boolean
  diffuseEnabled?: boolean
  diffuseProbeResolution?: DiffuseProbeResolution
  floors: IndirectFloor[]; revision: string; blocked: boolean; enabled: boolean; indoorFill: number; daylight: boolean
  localLights?: IndirectLocalLight[]
  showProbes?: boolean
  savedCache?: SavedIndirectLighting; cacheProjectKey?: string; cacheAssetKey?: string
  cacheSettings?: IndirectLightingSettings; cacheExportable?: boolean
  onCacheReady?: (cache: SavedIndirectLighting | undefined) => void
  requireSavedCache?: boolean
}) {
  const { camera, gl, invalidate, scene } = useThree()
  const layoutKey = JSON.stringify(floors)
  const lightKey = JSON.stringify(inputLights)
  const localLights = useMemo(() => JSON.parse(lightKey) as IndirectLocalLight[], [lightKey])
  const [initialField] = useState(() => createIndirectField([], 0))
  const workField = useRef(initialField), displayField = useRef(initialField)
  const ownedFields = useRef(new Set([initialField]))
  const client = useMemo(() => new IndirectLightingClient(), [])
  const [uniforms] = useState(() => createIndirectUniforms(initialField))
  const pendingUpdate = useRef(true), preparing = useRef(false), preparedKey = useRef(''), geometrySignature = useRef('')
  const preparingVersion = useRef(-1), interactionUntil = useRef(0), warming = useRef(false)
  const preparedLightPositions = useRef('')
  const capturePrograms = useRef(new Map<string, { signature: string; snapshot: ReturnType<typeof createShaderWarmupSnapshot> }>())
  const captureScene = useRef<ReturnType<typeof createIndirectCaptureScene> | null>(null)
  const multiview = useRef<ReturnType<typeof createIndirectMultiview>>(null)
  const multiviewProbe = useRef(false)
  const surfaceScene = useRef<ReturnType<typeof createIndirectCaptureScene> | null>(null)
  const surfaceCache = useRef<ReturnType<typeof createIndirectSurfaceCache>>(null), surfaceCacheKey = useRef('')
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
  const restorers = useRef(new Map<Material, () => void>())
  const refreshedHelpers = useRef(new WeakSet<Material>())
  const generation = useRef(0), signature = useRef(''), scanElapsed = useRef(Infinity)
  const geometryBuilds = useRef(0)
  const queue = useRef<Sample[]>([]), face = useRef(0), reading = useRef(false), waitUntil = useRef(0)
  const readbacks = useRef(new Set<{ pass: number; promise?: Promise<void> }>())
  const cameraMatrix = useRef(new Matrix4())
  const obstacles = useRef<Box3[]>([])
  const modelBounds = useRef<IndirectModelBounds>(new Map()), captureModelBounds = useRef<IndirectModelBounds>(new Map())
  const reflections = useRef(new Map<string, { texture: Texture; dispose(): void }>())
  const baseline = useRef<{ generation: number; revision: string; settingsKey: string; field: typeof initialField;
    direct?: Uint16Array[]; final: Uint16Array[]; bounds?: IndirectModelBounds } | null>(null)
  const directCoefficients = useRef<Uint16Array[] | undefined>(undefined)
  const partialBake = useRef(false), captureRevision = useRef(revision)
  const updatedProbes = useRef(new Set<number>())
  const exportedCache = useRef<SavedIndirectLighting | undefined>(undefined), saving = useRef(false), savedGeneration = useRef(-1)
  const attemptedCache = useRef(''), loadedCacheKey = useRef('')
  const settingsKey = indirectContentKey(cacheSettings)
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
    return { diffuse, reflectionTarget, reflectionCamera, pmrem: new PMREMGenerator(gl),
      sky: new Color(), centre: new Vector3() }
  }, [gl])
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
      if (material.envMap === state.assigned) { material.envMap = state.original; material.needsUpdate = true }
      setIndirectLocalReflection(material, false)
    })
    reflectionMaterials.current.clear()
    reflections.current.forEach(target => target.dispose()); reflections.current.clear()
  }, [])

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
          material.envMap = previous.original; material.needsUpdate = true
          setIndirectLocalReflection(material, false); reflectionMaterials.current.delete(material)
        }
        return
      }
      if (material.envMap === target.texture) { setIndirectLocalReflection(material, true); return }
      const existing = reflectionMaterials.current.get(material)
      reflectionMaterials.current.set(material, { original: existing?.original ?? material.envMap!, assigned: target.texture })
      // Only program-defining changes need compilation. A replacement bake at
      // the same resolution reuses its shader and must not suspend display.
      const previousImage = material.envMap?.image as { height?: number } | undefined
      const nextImage = target.texture.image as { height?: number } | undefined
      if (material.envMap?.mapping !== target.texture.mapping || previousImage?.height !== nextImage?.height) {
        scene.userData.shaderWarmupPending = true
      }
      material.envMap = target.texture; material.needsUpdate = true
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

  const scan = useCallback(() => {
    const geometry: string[] = []
    const liveMaterials = new Set<Material>()
    const furniture: Box3[] = []
    const boundsByModel = new Map<string, { min: number[]; max: number[] }>()
    const finishes = new Set<string>()
    scene.updateMatrixWorld(true)
    let pointIndex = 0, spotIndex = 0
    uniforms.hdGIPointIndices.value.fill(-1); uniforms.hdGISpotIndices.value.fill(-1)
    scene.traverse(object => {
      if (object instanceof PointLight || object instanceof SpotLight) {
        const lightIndex = localLights.findIndex(light => object.position.distanceToSquared(new Vector3(...light.position)) < .00001)
        const indices = object instanceof SpotLight ? uniforms.hdGISpotIndices.value : uniforms.hdGIPointIndices.value
        const index = object instanceof SpotLight ? spotIndex++ : pointIndex++
        if (index < indices.length && lightIndex >= 0 && lightIndex < INDIRECT_MAX_LOCAL_LIGHTS) {
          indices[index] = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + lightIndex
        }
      }
      if (object.name.startsWith('model-transform-')) {
        const bounds = new Box3().setFromObject(object), size = bounds.getSize(new Vector3())
        // Lights have no render mesh when their editor markers are hidden.
        if (bounds.isEmpty() && object.userData.indirectLightModel) {
          bounds.setFromCenterAndSize(object.getWorldPosition(new Vector3()), new Vector3())
        }
        if (!bounds.isEmpty()) boundsByModel.set(object.name.slice('model-transform-'.length), { min: bounds.min.toArray(), max: bounds.max.toArray() })
        if (size.x > .3 && size.y > .3 && size.z > .3) furniture.push(bounds)
      }
      if (!(object instanceof Mesh) || object.userData.selectionDecoration) return
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
        (object.userData.houseDesignerRole === 'ground-image')) return
      const p = object.geometry.attributes.position
      if (!p?.count) return
      geometry.push(`${indirectGeometryFingerprint(object.geometry)}:${object.matrixWorld.elements.map(value => Math.round(value * 100000)).join(',')}`)
    })
    obstacles.current = furniture
    modelBounds.current = boundsByModel
    restorers.current.forEach((restore, material) => {
      if (!liveMaterials.has(material)) { restore(); restorers.current.delete(material); reflectionMaterials.current.delete(material as MeshStandardMaterial) }
    })
    if (reflections.current.size) assignReflections()
    geometrySignature.current = geometry.sort().join('|')
    return geometrySignature.current + '::' + [...finishes].sort().join('|')
  }, [assignReflections, localLights, scene, uniforms])

  const scheduleUpdate = useCallback(() => {
    generation.current++
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
    waitUntil.current = performance.now() + 250
    const previous = scene.userData.indirectLighting
    scene.userData.indirectLighting = { ...previous, generation: generation.current, completed: 0, state: 'updating',
      previewUpdates: 0, firstPreviewMs: undefined, lastPreviewCompleted: undefined }
    invalidate()
  }, [client, invalidate, onCacheReady, scene])

  const restart = useCallback((field: typeof initialField, plan?: IndirectZonePlan) => {
    const captureSceneStart = performance.now()
    const nextCaptureScene = createIndirectCaptureScene(scene, localLights.length > 0)
    const transportSupported = scene.userData.indirectSurfaceCacheEnabled === true && supportsIndirectSurfaceCapture(nextCaptureScene.scene)
    const transportKey = transportSupported ? signature.current + ':' + indirectSurfaceCaptureKey(nextCaptureScene.scene, gl) + ':' +
      diffuseProbeResolution + ':' + JSON.stringify([field.bounds, field.ranges, field.volume.n,
        field.probes.map(probe => [probe.index, probe.region.floorId, probe.position.toArray()])]) : ''
    if (transportKey !== surfaceCacheKey.current || scene.userData.indirectSurfaceCacheEnabled !== true) {
      surfaceCache.current?.dispose(); surfaceCache.current = null; surfaceCacheKey.current = transportKey
    }
    // Keep experimental until the combined capture is validated on target GPUs.
    if (transportSupported) {
      surfaceCache.current ??= createIndirectSurfaceCache(gl, field.probes.map(probe => probe.index), diffuseProbeResolution, uniforms)
    } else { surfaceCache.current?.dispose(); surfaceCache.current = null }
    surfaceScene.current?.dispose(); surfaceScene.current = null
    if (surfaceCache.current) {
      surfaceScene.current = createIndirectCaptureScene(scene, localLights.length > 0)
      surfaceScene.current.enableSurfaceRadianceCapture()
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
    directCoefficients.current = undefined
    previewField.current = createIndirectPreviewField(field); ownedFields.current.add(previewField.current)
    previewFields.current.add(previewField.current); disposeUnusedPreviews()
    previewUpdated.current.clear(); lastPreview.current = { completed: 0, time: -Infinity }
    capturedProbes.current.clear()
    face.current = 0
    field.coefficients.forEach(data => data.fill(0))
    const retained = new Map(previous?.field.probes.map(probe => [probe.index, probe]) ?? [])
    if (partial) for (const probe of field.probes) {
      const before = retained.get(probe.index)
      if (before?.region.floorId !== probe.region.floorId || before.position.distanceToSquared(probe.position) >= 1e-8) continue
      field.coefficients.forEach((data, colour) => data.set(previous!.direct![colour].subarray(probe.index * 4, probe.index * 4 + 4), probe.index * 4))
      capturedProbes.current.add(probe.index)
    }
    const first = new Set(partial ? plan!.first : field.probes.map(probe => probe.index))
    const second = new Set(partial ? plan!.second : field.probes.map(probe => probe.index))
    updatedProbes.current = second
    const samples = field.probes.map(probe => ({ region: probe.region, position: probe.position, probe: probe.index, pass: 1 }))
      .sort((a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position))
    queue.current = [...samples.filter(sample => first.has(sample.probe)),
      ...samples.filter(sample => second.has(sample.probe)).map(sample => ({ ...sample, pass: 2 })),
      ...field.regions.filter(region => !partial || plan!.reflections.includes(region.id))
        .map(region => ({ region, position: region.centre, pass: 2, reflection: true }))]
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
      surfaceReplayedProbes: 0, surfaceReusedFaces: 0, surfaceDataFaces: 0 }
    invalidate()
  }, [camera, disposeUnusedPreviews, invalidate, scene, uniforms, revision, settingsKey, localLights.length, gl, diffuseProbeResolution])

  useLayoutEffect(() => {
    // Install lighting hooks as soon as prepared geometry/assets are committed,
    // before ShaderWarmup snapshots them. The periodic scan handles later mounts.
    const next = scan()
    if (next !== signature.current) { signature.current = next; scheduleUpdate() }
  }, [blocked, layoutKey, revision, scan, scheduleUpdate])

  useEffect(() => { scheduleUpdate() }, [layoutKey, lightKey, revision, scheduleUpdate])

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

  useFrame((state, delta) => {
    scanElapsed.current += delta
    if (scanElapsed.current >= .5) {
      scanElapsed.current = 0
      const next = scan()
      if (next !== signature.current) {
        signature.current = next
        // Mounting render meshes does not edit the saved model. Its source project,
        // assets and settings determine whether persisted lighting is still current.
        if (loadedCacheKey.current !== cacheIdentity) scheduleUpdate()
      }
    }
    if (!state.camera.matrixWorld.equals(cameraMatrix.current)) {
      cameraMatrix.current.copy(state.camera.matrixWorld); navigationUntil.current = performance.now() + 200
    }
    const moving = performance.now() < Math.max(navigationUntil.current, interactionUntil.current)
    Object.assign(scene.userData.indirectLighting, { blocked, enabled, diffuseEnabled,
      preparing: preparing.current, warming: warming.current, reading: reading.current,
      inFlight: readbacks.current.size,
      volumePending: volumePending.current, previewPending: !!previewRequest.current, pendingUpdate: pendingUpdate.current,
      floorPreparing: floorPreparing.current, floorLayerReady: displayField.current.floorLayer.ready,
      displayed: uniforms.hdGIUseVolume.value === 1, xr: gl.xr.isPresenting,
      capturedProbes: capturedProbes.current.size, pass: queue.current[0]?.pass,
      reflection: queue.current[0]?.reflection ?? false, face: face.current,
      activeProbe: queue.current[0]?.probe,
      saving: saving.current, saved: !!exportedCache.current, source: loadedCacheKey.current ? 'saved' : 'baked',
      exportable: cacheExportable,
      moving, paused: performance.now() < waitUntil.current })
    if (!enabled || blocked || gl.xr.isPresenting || performance.now() < waitUntil.current) return
    if (pendingUpdate.current && !preparing.current && !reading.current && !volumePending.current) {
      pendingUpdate.current = false
      if (cacheExportable && cacheSettings && attemptedCache.current !== cacheIdentity &&
        savedIndirectLightingMatches(savedCache, cacheProjectKey, cacheAssetKey, cacheSettings)) {
        attemptedCache.current = cacheIdentity; preparing.current = true
        const version = generation.current
        scene.userData.indirectLighting.state = 'loading'
        void loadIndirectLighting(savedCache!).then(restored => {
          if (version !== generation.current) { restored.field.dispose(); restored.reflections.forEach(reflection => reflection.dispose()); return }
          restoreReflections()
          ownedFields.current.forEach(field => field.dispose()); ownedFields.current.clear(); ownedFields.current.add(restored.field)
          previewFields.current.clear(); previewField.current = null
          workField.current = displayField.current = restored.field
          restored.reflections.forEach(reflection => {
            const region = restored.field.regions.find(region => region.id === reflection.room)!
            reflections.current.set(indirectRegionKey(region), reflection)
          })
          directCoefficients.current = restored.directCoefficients
          baseline.current = { generation: version, revision, settingsKey, field: restored.field,
            direct: restored.directCoefficients, final: restored.field.coefficients.map(data => data.slice()), bounds: modelBounds.current }
          capturedProbes.current = new Set(restored.field.probes.map(probe => probe.index))
          updateIndirectUniforms(uniforms, restored.field); uniforms.hdGIUseVolume.value = 1
          loadedCacheKey.current = cacheIdentity; exportedCache.current = savedCache
          savedGeneration.current = version; assignReflections(); onCacheReady?.(savedCache)
          scene.userData.indirectLighting = { generation: version, state: 'ready', enabled, displayed: true,
            probes: restored.field.probes.length, floorProbes: restored.field.probes.filter(probe => probe.kind === 'floor').length,
            rooms: restored.field.regions.length, reflections: reflections.current.size,
            completed: restored.field.probes.length * 2 + reflections.current.size, total: restored.field.probes.length * 2 + reflections.current.size,
            capturedFaces: 0, captureMs: 0, worker: false, geometryBuilds: 0, source: 'saved', saved: true }
          if (!requireSavedCache && obstacles.current.length && restored.field.floorProbeLayoutVersion < INDIRECT_FURNITURE_PROBE_VERSION) {
            // Retain the completed display while capturing the missing underside light.
            furnitureProbeUpgrade.current = true; pendingUpdate.current = true
            exportedCache.current = undefined; savedGeneration.current = -1; onCacheReady?.(undefined)
            scene.userData.indirectLighting.state = 'updating'
          }
        }).catch(error => { if (version === generation.current) { pendingUpdate.current = true; console.warn('Saved GI could not be loaded:', error) } })
          .finally(() => { if (version === generation.current) preparing.current = false; invalidate() })
        return
      }
      if (requireSavedCache) {
        scene.userData.indirectLighting.state = 'fallback'
        scene.userData.indirectLighting.cacheReason = 'Saved lighting does not match the project, assets or settings, or could not be decoded'
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
            .then(result => {
              if (version !== generation.current) return
              const field = workField.current
              field.distanceData.set(result.distances); field.distances.needsUpdate = true
              field.positionData.set(result.positions); field.positions.needsUpdate = true
              preparedLightPositions.current = lightPositionKey
              restart(field, result.zonePlan)
            }).catch(error => {
              if (version === generation.current) {
                preparedKey.current = ''; pendingUpdate.current = true
                console.warn('GI light visibility update unavailable:', error)
              }
            }).finally(() => { if (preparingVersion.current === version) preparing.current = false; invalidate() })
          return
        }
        if (!changes) { restart(workField.current); return }
        const version = generation.current
        preparing.current = true; preparingVersion.current = version
        void client.plan(indirectZoneProbes(previous!.field), changes).then(plan => {
          if (version === generation.current) restart(workField.current, plan)
        }).catch(error => {
          if (version === generation.current) { restart(workField.current); console.warn('GI local update unavailable:', error) }
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
        geometry: snapshotIndirectGeometry(scene), obstacles: obstacles.current.map(box => ({ min: box.min.toArray(), max: box.max.toArray() })),
        zones: changes ? { previous: indirectZoneProbes(previous!.field), changes, captureNewOnly: upgrade } : undefined }, progress => {
          if (version !== generation.current) return
          Object.assign(scene.userData.indirectLighting, { prepareStage: progress.stage, prepareTimings: progress.timings })
          invalidate()
        })
        .then(result => {
          if (version !== generation.current) return
          const field = restoreIndirectField(result.field)
          if (upgrade && !field.probes.some(probe => probe.kind === 'floor')) {
            // Solid furniture needs no new samples: retain the existing completed bake.
            field.dispose(); client.dispose(); preparedKey.current = ''
            displayField.current.floorProbeLayoutVersion = INDIRECT_FURNITURE_PROBE_VERSION
            scene.userData.indirectLighting.generation = version; scene.userData.indirectLighting.state = 'ready'
            return
          }
          bakeTriangles.current?.dispose()
          const triangles = new DataTexture(result.triangles.data, result.triangles.width, result.triangles.height, RGBAFormat, FloatType)
          triangles.magFilter = triangles.minFilter = NearestFilter; triangles.generateMipmaps = false; triangles.needsUpdate = true
          bakeTriangles.current = triangles
          uniforms.hdGITriangles.value = triangles
          uniforms.hdGITriangleSize.value.set(result.triangles.width, result.triangles.height)
          preparedKey.current = key
          preparedLightPositions.current = lightPositionKey
          geometryBuilds.current++
          restart(field, result.zonePlan)
          scene.userData.indirectLighting.prepareMs = performance.now() - started
          scene.userData.indirectLighting.prepareTimings = result.prepareTimings
        }).catch(error => {
          if (version === generation.current) { scene.userData.indirectLighting.state = 'fallback'; console.warn('GI worker unavailable:', error) }
        }).finally(() => { if (preparingVersion.current === version) preparing.current = false; invalidate() })
      return
    }
    if (scene.userData.indirectLighting.state === 'ready' && !pendingUpdate.current && !preparing.current && !reading.current &&
      !volumePending.current && !displayField.current.floorLayer.ready && !floorAttempted.current.has(displayField.current)) {
      // Upgrade old completed bakes from their existing coefficients. No probe or reflection recapture.
      const field = displayField.current, version = generation.current
      floorAttempted.current.add(field); floorPreparing.current = true; floorVersion.current = version
      volumePending.current = true; scene.userData.indirectLighting.state = 'refining'
      void client.floor({ field: serializeIndirectField(field), coefficients: field.coefficients, geometry: snapshotIndirectGeometry(scene) })
        .then(data => {
          if (version !== generation.current || displayField.current !== field) return
          field.floorLayer.data.set(data); field.floorLayer.ready = true; field.floorLayer.texture.needsUpdate = true
          updateIndirectUniforms(uniforms, field)
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
    if (scene.userData.indirectLighting.state === 'ready' && !volumePending.current && !reading.current && !pendingUpdate.current &&
      baseline.current?.generation !== generation.current) {
      baseline.current = { generation: generation.current, revision: captureRevision.current, settingsKey: captureSettingsKey.current,
        field: workField.current, direct: directCoefficients.current, final: workField.current.coefficients.map(data => data.slice()), bounds: captureModelBounds.current }
    }
    if (scene.userData.indirectLighting.state === 'ready' && !volumePending.current && !reading.current && !pendingUpdate.current &&
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
    if (preparing.current || volumePending.current || warming.current || pendingUpdate.current || !queue.current.length) return
    // Bound queued GPU work, and drain every read before changing bounce input
    // or starting reflections. A readback wait need not stop the next probe.
    if (readbacks.current.size >= 3 || [...readbacks.current].some(read =>
      read.pass !== queue.current[0].pass || queue.current[0].reflection)) return
    const legacyBudget = scene.userData.indirectLegacyCaptureBudget === true // Diagnostic timing control.
    const faceBudget = liveIndirectFaceBudget(delta, moving, performance.now(), lastCapture.current, legacyBudget)
    if (!faceBudget) return
    // Keep the navigation face budget. A partly completed multiview probe waits
    // for an idle frame; probes begun while moving retain ordinary cube capture.
    if (moving && multiviewProbe.current && face.current > 0) return
    const deadline = performance.now() + (legacyBudget ? 3 : liveIndirectTimeBudget(delta, moving))
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
      const captureDirect = !!transport && sample.pass === 1
      const captureSurface = captureDirect && !transport!.ready.has(sample.probe!)
      let replayResult: ReturnType<NonNullable<typeof transport>['read']> | undefined
      const bakeScene = sample.reflection ? scene : captureSurface ? surfaceScene.current!.scene : batch?.scene ?? captureScene.current!.scene
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
      const activeLights = [...captureLights].filter(light => !light.distance || light.position.distanceTo(cubeCamera.position) <= light.distance)
        // Retain zero-power variants when they fit, without letting dormant
        // lamps displace powered lights from the bounded capture budget.
        .sort((a, b) => Number(b.intensity > 0) - Number(a.intensity > 0) ||
          a.position.distanceToSquared(cubeCamera.position) - b.position.distanceToSquared(cubeCamera.position))
        .slice(0, Math.max(1, Math.min(8, gl.capabilities.maxTextures - 16)))
      const stats = { ...gl.info.render }
      const pointIndices = uniforms.hdGIPointIndices.value.slice(), spotIndices = uniforms.hdGISpotIndices.value.slice()
      const hidden: { object: Mesh; visible: boolean }[] = []
      const transparent: { material: Material; opacity: number; visible: boolean; depthWrite: boolean }[] = []
      const seen = new Set<Material>()
      const lightIntensities: { light: PointLight | SpotLight; intensity: number; visible: boolean }[] = []
      // Captures represent the building, rather than camera-dependent wall fades.
      if (sample.reflection) scene.traverse(object => {
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
      updateIndirectUniforms(uniforms, field)
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
        for (const light of activeLights) {
          bakeScene.add(light); light.updateMatrixWorld(true)
          if (light instanceof SpotLight) { bakeScene.add(light.target); light.target.updateMatrixWorld(true) }
        }
        const sky = daylight ? resources.sky.setRGB(.65, .72, .82) : resources.sky.setRGB(0, 0, 0)
        // MRT background clearing must leave receiver attachments empty.
        bakeScene.background = captureSurface ? null : sky
        if (!replay) gl.setRenderTarget(captureSurface ? transport!.target : batch?.target ?? cubeTarget, batch || captureSurface ? 0 : face.current)
        const programKey = `${sample.reflection ? 'reflection' : captureSurface ? 'surface-radiance' : 'diffuse'}:${batch ? `multiview-${batch.views}:` : ''}` + activeLights.map(light => light.type).sort().join(',')
        if (!replay && capturePrograms.current.get(programKey)?.signature !== signature.current) {
          // Prepare offscreen/light-count variants with parallel shader compilation
          // before their first capture. Retain the materials so programs stay cached.
          const snapshot = createShaderWarmupSnapshot(bakeScene, { fadeWalls: false, fadeRoofs: false })
          const captureSignature = signature.current
          warming.current = true
          const compile = () => gl.compileAsync(snapshot.root, cubeCamera.children[face.current] as Camera, bakeScene)
          void (batch ? batch.withShaders(compile) : compile()).then(() => {
            if (generation.current !== version) { snapshot.dispose(); return }
            capturePrograms.current.get(programKey)?.snapshot.dispose()
            capturePrograms.current.set(programKey, { signature: captureSignature, snapshot })
          }).catch(error => {
            snapshot.dispose()
            if (captureSurface && generation.current === version && surfaceCache.current === transport) {
              transport!.dispose(); surfaceCache.current = null
              surfaceScene.current?.dispose(); surfaceScene.current = null; face.current = 0
            }
            console.warn('GI shader preparation unavailable:', error)
          })
            .finally(() => { warming.current = false; invalidate() })
          return
        }
        // Use available stationary-frame time; navigation retains its small budget.
        const maxFaces = faceBudget
        let captured = 0, dataCaptured = 0
        if (replay) {
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
        if (captureDirect && face.current === 6) {
          transport!.ready.add(sample.probe!); scene.userData.indirectLighting.surfaceCachedProbes = transport!.ready.size
          replayResult = transport!.read(sample.probe!, 1)
        }
      } finally {
        uniforms.hdGICapture.value = 0
        updateIndirectUniforms(uniforms, displayField.current)
        uniforms.hdGIUseVolume.value = displayVolumeEnabled
        uniforms.hdGIPointIndices.value.set(pointIndices); uniforms.hdGISpotIndices.value.set(spotIndices)
        roomLightCaptureUniform.value = 0
        for (const light of activeLights) { bakeScene.remove(light); if (light instanceof SpotLight) bakeScene.remove(light.target) }
        lightIntensities.forEach(({ light, intensity, visible }) => { light.intensity = intensity; light.visible = visible })
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
          const previous = reflections.current.get(reflectionKey)
          reflections.current.set(reflectionKey, resources.pmrem.fromCubemap(cubeTarget.texture))
          assignReflections()
          previous?.dispose()
          queue.current.shift(); face.current = 0
          const status = scene.userData.indirectLighting
          status.completed++; status.reflections = reflections.current.size; status.state = queue.current.length ? 'refining' : 'ready'
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
          capturedProbes.current.add(sample.probe!)
          previewUpdated.current.add(sample.probe!)
          const status = scene.userData.indirectLighting
          status.roomMean[sample.region.id] = sh.coefficients[0].toArray().map(value => value * .886227)
          status.completed++; status.state = queue.current.length || readbacks.current.size ? 'refining' : 'ready'
          const passComplete = readbacks.current.size === 0 &&
            (!queue.current.length || queue.current[0].pass !== sample.pass || queue.current[0].reflection)
          if (!passComplete && !previewRequest.current &&
            shouldPublishLivePreview(status.completed, lastPreview.current.completed, performance.now(), lastPreview.current.time)) {
            const request = {}, display = previewField.current!
            previewRequest.current = request
            lastPreview.current = { completed: status.completed, time: performance.now() }
            const snapshot = indirectPreviewCoefficients(field, previewUpdated.current, sample.pass, baseline.current)
            void client.preview(snapshot.coefficients, snapshot.positions).then(data => {
              if (generation.current !== version || previewRequest.current !== request) return
              display.volume.data.set(data.volume); display.volume.maps[0].needsUpdate = true
              display.floorLayer.data.set(data.floor); display.floorLayer.ready = true; display.floorLayer.texture.needsUpdate = true
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
            if (sample.pass === 1) directCoefficients.current = field.coefficients.map(data => data.slice())
            if (sample.pass === 2 && partialBake.current) {
              const previous = baseline.current!
              for (const probe of field.probes) if (!updatedProbes.current.has(probe.index))
                field.coefficients.forEach((data, colour) => data.set(previous.final[colour].subarray(probe.index * 4, probe.index * 4 + 4), probe.index * 4))
              field.maps.forEach(map => { map.needsUpdate = true })
            }
            volumePending.current = true
            previewUpdated.current.clear()
            void client.volume(field.coefficients, field.positionData).then(data => {
              if (generation.current !== version) return
              field.volume.data.set(data.volume); field.volume.maps[0].needsUpdate = true
              field.floorLayer.data.set(data.floor); field.floorLayer.ready = true; field.floorLayer.texture.needsUpdate = true
              // Only full-resolution pass boundaries replace the bounce input.
              bakeVolumeReady.current = true
              if (partialBake.current && sample.pass === 1) return
              displayField.current = field
              updateIndirectUniforms(uniforms, field); uniforms.hdGIUseVolume.value = 1
              const liveRegions = new Set(field.regions.map(indirectRegionKey)), obsoleteReflections: { dispose(): void }[] = []
              reflections.current.forEach((reflection, key) => {
                if (!liveRegions.has(key)) { reflections.current.delete(key); obsoleteReflections.push(reflection) }
              })
              assignReflections()
              obsoleteReflections.forEach(reflection => reflection.dispose())
              // Dispose replaced layouts only after their lighting is no longer displayed.
              ownedFields.current.forEach(previous => {
                if (previous !== field && previous !== previewField.current) {
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
    // Fill the bounded readback pipeline within the stationary time budget.
    // Navigation keeps its existing one-face budget and interval.
    while (!warming.current && faceBudget === 6 && face.current === 0 && queue.current.length &&
      !queue.current[0].reflection && readbacks.current.size < 3 && performance.now() < deadline &&
      [...readbacks.current].every(read => read.pass === queue.current[0].pass)) captureNext()
  })

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
    resources.reflectionTarget.dispose(); resources.pmrem.dispose(); restoreReflections()
    delete scene.userData.indirectLighting
  }, [client, resources, restoreReflections, scene])
  return <>
    {showProbes && <IndirectLightingProbes snapshot={probeSnapshot} />}
    {inspectPoint && <IndirectLightingInspector enabled snapshot={() => ({ field: displayField.current, generation: generation.current,
      ready: scene.userData.indirectLighting?.state === 'ready' && !pendingUpdate.current && !preparing.current && !volumePending.current,
      direct: baseline.current?.direct, lights: localLights.map(light => ({ position: light.position, color: light.color })) })} />}
  </>
}
