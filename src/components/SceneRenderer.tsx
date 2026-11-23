import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BackSide, BoxGeometry, FrontSide, Group, Matrix4, Mesh, MeshBasicMaterial } from 'three'
import type { EffectComposer } from 'postprocessing'
import { shouldRenderSceneFrame } from '../sceneRenderSchedule'
import { retainViewportScene, prepareRetainedViewportScene } from '../retainedViewportScene'
import { createOpaqueViewportScene, prepareOpaqueViewportScene } from '../opaqueViewportScene'
import { compileShaderWarmup, prepareShaderWarmupResources } from '../shaderWarmup'
import { createViewportSelection, wallSelectionMaterialParameters } from '../viewportSelection'
import { isWallClippingPending } from '../wallEngine/wallRoofClipClient'
import { isRoofAssemblyPending } from '../roofAssemblyClient'
import { isViewportPreparationPending } from '../viewportScheduling'
import { getWallOpeningPreview } from '../wallOpeningPreview'
import { createLightingDiagnosticDisplay } from '../lightingDiagnosticDisplay'
import { installRendererAttributeDefaults } from '../rendererAttributeDefaults'
import { recordRendererFrame } from '../rendererHealth'
import { FloorDisplayBatching } from '../floorDisplayBatching'
import { MODELLING_IDLE_DRAW_INTERVAL_MS, ModellingViewportPerformance } from '../modellingViewportPerformance'

/** Own the display draw so asset/shader preparation cannot trigger synchronous
 * first-use compilation, and static display frames do not compete with GI. */
export function SceneRenderer({ blocked, geometryPending, contentRevision = '', offscreen, composer, editing, wireframe, selectionRevision, opaquePending, onOpaqueReady, lightingStarted, onLightingReady, onSceneReady, staticScene = false, modellingDisplay = false, limitIdleDraws = false, designMode = false }: {
  blocked: boolean; offscreen: boolean; composer: RefObject<EffectComposer | null>
  editing: boolean; wireframe: boolean; geometryPending: boolean
  selectionRevision: string; opaquePending: boolean; onOpaqueReady: () => void
  lightingStarted: boolean; onLightingReady: () => void
  staticScene?: boolean
  modellingDisplay?: boolean
  limitIdleDraws?: boolean
  designMode?: boolean
  contentRevision?: string
  onSceneReady?: () => void
}) {
  const presentedCallback = useRef<(() => void) | undefined>(undefined)
  const fullFramePresented = useRef(false)
  const lastDraw = useRef(-Infinity)
  const view = useRef(new Matrix4()), projection = useRef(new Matrix4())
  const dimensions = useRef('')
  const selection = useRef('')
  const lightRevision = useRef(0)
  const displayEffectRevision = useRef(0)
  const exposure = useRef(1)
  const displayPerformance = useRef(new ModellingViewportPerformance())
  const adjustedDpr = useRef(false)
  const displayDpr = useRef(1)
  const diagnosticDisplay = useRef<ReturnType<typeof createLightingDiagnosticDisplay> | null>(null)
  const liveSelection = useRef<ReturnType<typeof createViewportSelection> | null>(null)
  if (liveSelection.current === null) liveSelection.current = createViewportSelection()
  const designDisplay = useRef<ReturnType<typeof retainViewportScene> | null>(null)
  const realisticDisplay = useRef<ReturnType<typeof retainViewportScene> | null>(null)
  const retained = designMode ? designDisplay : realisticDisplay
  const opaque = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const opaqueReady = useRef(false)
  const opaqueWork = useRef(false)
  const preview = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const previewWork = useRef(false)
  const previewFailed = useRef(false)
  const previewContent = useRef(contentRevision)
  const presentedContent = useRef(contentRevision)
  const editPreview = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const startupPreviewPrograms = useRef<(() => void) | null>(null)
  // Keep one predecessor's material programs resident between geometry edits.
  // It is never displayed after its content revision changes. Releasing it
  // immediately made every window/wall edit recompile the same basic shaders.
  const editPreviewPrograms = useRef<(() => void) | null>(null)
  const editPreviewWork = useRef(false)
  const editPreviewFailed = useRef(false)
  const editPreviewVersion = useRef(0)
  const editContent = useRef(contentRevision)
  const startupContent = useRef(contentRevision)
  const lightingWork = useRef(false), generation = useRef(0)
  const opaqueStableSince = useRef(0)
  const fence = useRef<WebGLSync | null>(null)
  const startedAt = useRef(0)
  const needsSnapshot = useRef(true)
  const snapshotWork = useRef(false), snapshotGeneration = useRef(0)
  const floorBatches = useRef<FloorDisplayBatching | null>(null)
  if (!floorBatches.current) floorBatches.current = new FloorDisplayBatching()
  const {gl,invalidate}=useThree()
  useLayoutEffect(() => {
    // Pending preparation belongs to the mode that submitted it. A mode
    // change can happen while an opaque or retained snapshot is still yielding.
    generation.current++
    snapshotGeneration.current++
    snapshotWork.current = false
    previewWork.current = false
    opaqueWork.current = false
    opaqueReady.current = false
    opaqueStableSince.current = 0
    if (designMode && realisticDisplay.current) {
      realisticDisplay.current.dispose()
      realisticDisplay.current = null
    }
    opaque.current?.dispose()
    opaque.current = null
  }, [designMode])
  useEffect(() => installRendererAttributeDefaults(gl), [gl])
  useEffect(() => {
    const restore = () => { needsSnapshot.current = true; previewFailed.current = false }
    gl.domElement.addEventListener('webglcontextrestored', restore)
    return () => gl.domElement.removeEventListener('webglcontextrestored', restore)
  }, [gl])
  useEffect(() => () => {
    if (adjustedDpr.current && !gl.xr.isPresenting && !gl.getContext().isContextLost()) gl.setPixelRatio(displayDpr.current)
    generation.current++
    snapshotGeneration.current++
    editPreviewVersion.current++
    editPreview.current?.dispose()
    editPreviewPrograms.current?.()
    startupPreviewPrograms.current?.()
    floorBatches.current?.dispose()
    designDisplay.current?.dispose(); realisticDisplay.current?.dispose()
    opaque.current?.dispose(); preview.current?.dispose()
    liveSelection.current?.clear()
    diagnosticDisplay.current?.dispose(); diagnosticDisplay.current = null
    if (fence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(fence.current)
  }, [gl])
  useFrame(({ camera, gl, scene, size, viewport }, delta) => {
    // React's composer resize effect observes CSS dimensions, not DPR. Keep
    // its offscreen buffers in step with movement-only resolution changes;
    // shrinking just the canvas would still shade the full-sized scene.
    const effects = composer.current
    const currentContent = `${contentRevision}:${scene.userData.viewportMaterialRevision ?? 0}`
    recordRendererFrame(gl, camera)
    if (!startedAt.current) startedAt.current = performance.now()
    // The display gate reads worker state immediately; expensive React scene
    // reconciliation is allowed to follow later as a background transition.
    const workerPending = isWallClippingPending() || isRoofAssemblyPending() || isViewportPreparationPending()
    if (!fullFramePresented.current && startupContent.current !== currentContent) {
      // Initial preparation may overlap wall/window edits. Its snapshots are
      // immutable and belong to that content revision, never to later walls.
      startupContent.current = currentContent; generation.current++
      // Keep this project's prepared basic view navigable until its replacement
      // is uploaded. The project-key boundary prevents cross-project reuse.
      if (!preview.current && opaque.current) { preview.current = opaque.current; opaque.current = null }
      previewWork.current = false; previewFailed.current = false
      opaque.current?.dispose(); opaque.current = null; opaqueWork.current = false; opaqueReady.current = false
      lightingWork.current = false
      if (fence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(fence.current)
      fence.current = null
      opaqueStableSince.current = 0
    }
    const preparing = (blocked || geometryPending || workerPending || scene.userData.shaderWarmupPending ||
      (!designMode && scene.userData.indirectScanPending)) && !gl.xr.isPresenting
    const now = performance.now()
    camera.updateMatrixWorld()
    const viewChanged = !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix)
    const adaptive = modellingDisplay && offscreen && !wireframe && !gl.xr.isPresenting && !scene.userData.lightingDiagnosticUnlit
    const displayBudget = displayPerformance.current.update(now, adaptive && (viewChanged || editing),
      adaptive && fullFramePresented.current && !preparing && !document.hidden)
    const { moving, measure: measureMotion } = displayBudget
    const resolution = adaptive ? displayBudget.resolution : 1
    if (adaptive || adjustedDpr.current) {
      displayDpr.current = viewport.dpr
      const ratio = viewport.dpr * resolution
      if (!gl.xr.isPresenting && gl.getPixelRatio() !== ratio) gl.setPixelRatio(ratio)
      adjustedDpr.current = resolution < 1
    }
    if (offscreen && effects && (effects.inputBuffer.width !== gl.domElement.width ||
      effects.inputBuffer.height !== gl.domElement.height)) effects.setSize(size.width, size.height)
    if (adaptive) scene.userData.modellingDisplay = { resolution, moving }
    else if (scene.userData.modellingDisplay) delete scene.userData.modellingDisplay
    if (preparing) {
      needsSnapshot.current = true
      if (snapshotWork.current) { snapshotGeneration.current++; snapshotWork.current = false }
    }
    // Geometry edits must not wait for new lighting programs to replace a
    // retained placement preview. Prepare a simple view of the finished meshes
    // once all geometry workers settle, then restore the full lit display.
    const showEdit = !designMode && fullFramePresented.current && preparing && currentContent !== presentedContent.current &&
      onSceneReady === presentedCallback.current && !wireframe
    if (editContent.current !== currentContent || !showEdit || geometryPending || workerPending) {
      editPreviewVersion.current++
      editPreviewWork.current = false
      editPreviewFailed.current = false
      if (editPreview.current) {
        editPreviewPrograms.current?.()
        editPreviewPrograms.current = editPreview.current.retainPrograms()
        editPreview.current.dispose()
        editPreview.current = null
      }
      delete scene.userData.geometryEditPreview
      editContent.current = currentContent
    }
    if (showEdit && !geometryPending && !workerPending && !editPreview.current && !editPreviewWork.current && !editPreviewFailed.current) {
      editPreviewWork.current = true
      const version = editPreviewVersion.current, started = performance.now()
      const cancelled = () => version !== editPreviewVersion.current
      void (async () => {
        // Match the completed startup viewport's materials, including its
        // imported models. The early basic preview can precede asset loading.
        const next = await prepareOpaqueViewportScene(scene, {}, cancelled)
        if (!next) return
        try {
          const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, { cancelled })
          if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, false, cancelled) || cancelled()) {
            next.dispose(); return
          }
          editPreview.current = next
          // The replacement now owns the shared programs, so the predecessor's
          // material leases can be released without evicting those programs.
          editPreviewPrograms.current?.(); editPreviewPrograms.current = null
          scene.userData.geometryEditPreview = { readyMs: performance.now() - started, displayed: false }
          invalidate()
        } catch (error) { next.dispose(); throw error }
      })().catch(error => {
        if (!cancelled()) { editPreviewFailed.current = true; console.warn('Updated geometry display unavailable:', error) }
      }).finally(() => { if (!cancelled()) editPreviewWork.current = false })
    }
    if (showEdit && editPreview.current) {
      camera.updateMatrixWorld()
      const transformsChanged = editPreview.current.syncTransforms()
      const visibilityChanged = editPreview.current.syncVisibility(camera.position)
      const now = performance.now(), nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
      const changed = !scene.userData.geometryEditPreview.displayed || transformsChanged || visibilityChanged ||
        !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix) ||
        dimensions.current !== nextDimensions || selection.current !== selectionRevision
      if (!shouldRenderSceneFrame(now, lastDraw.current, changed, editing, undefined, false, false, true)) return
      liveSelection.current!.sync(scene, editPreview.current.scene, selectionRevision)
      const shadows = gl.shadowMap.enabled, autoClear = gl.autoClear
      try {
        gl.shadowMap.enabled = false; gl.autoClear = true
        gl.render(editPreview.current.scene, camera)
      } finally { gl.shadowMap.enabled = shadows; gl.autoClear = autoClear }
      scene.userData.geometryEditPreview.displayed = true
      lastDraw.current = now
      view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
      dimensions.current = nextDimensions; selection.current = selectionRevision
      return
    }
    // Preserve the last complete frame if preparation interrupts its retained
    // snapshot and the updated geometry display is not ready yet.
    if (preparing && fullFramePresented.current && !retained.current) return
    // Geometry readiness is independent of asset, GI and detailed shader
    // readiness. Reuse the existing simple direct/ambient preview materials
    // on the actual meshes while the richer display prepares separately.
    if (!fullFramePresented.current && (!designMode || preparing) && !retained.current && !opaque.current && (!preview.current || previewContent.current !== currentContent) && !previewWork.current && !previewFailed.current &&
      !geometryPending && !workerPending) {
      previewWork.current = true
      const version = generation.current, cancelled = () => version !== generation.current
      void (async () => {
        const next = await prepareOpaqueViewportScene(scene, { basic: true, reuseSceneLights: designMode }, cancelled)
        if (!next) return
        try {
          const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, { cancelled })
          if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, true, cancelled) || cancelled()) { next.dispose(); return }
          if (opaque.current || retained.current) { next.dispose(); return }
          preview.current?.dispose(); preview.current = next; previewContent.current = currentContent; invalidate()
        } catch (error) { next.dispose(); throw error }
      })().catch(error => {
        if (!cancelled()) { previewFailed.current = true; console.warn('Basic geometry display unavailable:', error) }
      })
        .finally(() => { if (!cancelled()) previewWork.current = false })
    }
    if (!designMode && lightingStarted && opaqueReady.current && !lightingWork.current) {
      // The opaque view is already interactive. Prepare the final lighting and
      // effects directly instead of compiling a second, disposable GI scene
      // with different material and tone-mapping variants first.
      lightingWork.current = true
      onLightingReady()
    }
    if (!designMode && !fullFramePresented.current && !retained.current && !opaque.current && !opaqueWork.current) {
      if (opaquePending) opaqueStableSince.current = 0
      else if (!opaqueStableSince.current) opaqueStableSince.current = performance.now()
      else if (performance.now() - opaqueStableSince.current >= 500) {
        opaqueWork.current = true
        const version = generation.current, cancelled = () => version !== generation.current
        void (async () => {
          const next = await prepareOpaqueViewportScene(scene, {}, cancelled)
          if (!next) return
          // Transparent wall selections render both sides. The edit preview
          // inherits the composer's NoToneMapping after the first full frame.
          const selectionGeometry = new BoxGeometry()
          const selectionMeshes = [true, false].flatMap(toneMapped => [BackSide, FrontSide].map(side =>
            new Mesh(selectionGeometry, new MeshBasicMaterial({ ...wallSelectionMaterialParameters, side, toneMapped }))))
          next.scene.add(...selectionMeshes)
          let keepSelectionPrograms = false
          try {
            const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, {
              cancelled,
              compile: batch => {
                const shadows = gl.shadowMap.enabled
                try { gl.shadowMap.enabled = false; return gl.compileAsync(batch, camera, next.scene) }
                finally { gl.shadowMap.enabled = shadows }
              },
            })
            next.scene.remove(...selectionMeshes)
            // A new project legitimately has no meshes. Its prepared background
            // must still advance startup so lighting/effects can mount.
            if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, true, cancelled)) {
              next.dispose(); return
            }
            opaque.current = next
            const lease = next.retainPrograms()
            startupPreviewPrograms.current?.()
            startupPreviewPrograms.current = () => {
              lease()
              selectionMeshes.forEach(mesh => mesh.material.dispose())
            }
            keepSelectionPrograms = true
            preview.current?.dispose(); preview.current = null
          } catch (error) { next.dispose(); throw error }
          finally {
            selectionGeometry.dispose()
            if (!keepSelectionPrograms) selectionMeshes.forEach(mesh => mesh.material.dispose())
          }
        })().catch(error => console.warn('Initial display preparation failed:', error))
          .finally(() => { if (!cancelled()) opaqueWork.current = false })
      }
    }
    if (!retained.current && !opaque.current && preview.current && (!designMode || preparing)) {
      camera.updateMatrixWorld()
      preview.current.syncTransforms(); preview.current.syncVisibility(camera.position)
      liveSelection.current!.sync(scene, preview.current.scene, selectionRevision)
      const shadows = gl.shadowMap.enabled
      try { gl.shadowMap.enabled = false; gl.render(preview.current.scene, camera) }
      finally { gl.shadowMap.enabled = shadows }
      scene.userData.progressiveStartup ??= { startedAtMs: startedAt.current, phase: 'geometry', frames: 0 }
      scene.userData.progressiveStartup.geometryReadyMs ??= performance.now() - startedAt.current
      if (!geometryPending && !workerPending && onSceneReady !== presentedCallback.current) {
        presentedCallback.current = onSceneReady; onSceneReady?.()
      }
      return
    }
    if (designMode && !preparing) {
      scene.userData.progressiveStartup ??= { startedAtMs: startedAt.current, phase: 'geometry', frames: 0 }
      scene.userData.progressiveStartup.geometryReadyMs ??= performance.now() - startedAt.current
      // The staged preview works only until the authored materials are ready.
      if (preview.current) {
        startupPreviewPrograms.current?.()
        startupPreviewPrograms.current = preview.current.retainPrograms()
        preview.current.dispose()
        preview.current = null
      }
    }
    if (!retained.current && opaque.current && (preparing || !opaqueReady.current)) {
      const enabled = gl.shadowMap.enabled, autoClear = gl.autoClear
      const display = opaque.current
      display.syncLighting()
      const transformsChanged = display.syncTransforms()
      const visibilityChanged = display.syncVisibility(camera.position)
      liveSelection.current!.sync(scene, display.scene, selectionRevision)
      camera.updateMatrixWorld()
      const now = performance.now(), nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
      // An unchanged startup view was redrawing the whole house on every frame,
      // competing with shader compilation. Input still gets an immediate draw.
      const changed = visibilityChanged || transformsChanged || !view.current.equals(camera.matrixWorld) ||
        !projection.current.equals(camera.projectionMatrix) || dimensions.current !== nextDimensions ||
        selection.current !== selectionRevision
      if (changed || editing || now - lastDraw.current >= 100) {
        try { gl.shadowMap.enabled = enabled && display.scene.userData.preparedLightingViewport === true; gl.autoClear = true; gl.render(display.scene, camera) }
        finally { gl.shadowMap.enabled = enabled; gl.autoClear = autoClear }
        lastDraw.current = now
        view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
        dimensions.current = nextDimensions; selection.current = selectionRevision
      }
      const context = gl.getContext() as WebGL2RenderingContext
      if (!opaqueReady.current) {
        if (!fence.current) { fence.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0); context.flush() }
        else {
          const status = context.clientWaitSync(fence.current, 0, 0)
          if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) {
            context.deleteSync(fence.current); fence.current = null; opaqueReady.current = true
            scene.userData.progressiveStartup = { ...scene.userData.progressiveStartup, startedAtMs: startedAt.current, opaqueReadyMs: performance.now() - startedAt.current, phase: 'lighting', frames: 0 }
            onOpaqueReady()
          }
        }
      }
      if (scene.userData.progressiveStartup) scene.userData.progressiveStartup.frames++
      return
    }
    if (wireframe) {
      // The hidden-surface wireframe renderer runs before this callback and
      // owns its draw, but must still release the same project loading cover.
      if (!preparing && onSceneReady !== presentedCallback.current) {
        presentedCallback.current = onSceneReady
        onSceneReady?.()
      }
      return
    }
    if (preparing && !retained.current) return
    // A project replacement is not an in-place edit. Keep the last displayed
    // frame beneath its loading cover instead of syncing the old house to
    // detached window/model sources and the incoming project's camera/lights.
    if (preparing && presentedCallback.current && onSceneReady !== presentedCallback.current) return
    const lightingChanged = preparing && retained.current!.syncLighting()
    const transformsChanged = preparing && retained.current!.syncTransforms()
    const visibilityChanged = preparing && retained.current!.syncVisibility(camera.position)
    const geometryChanged = preparing && retained.current!.syncGeometry()
    const openingPreview = getWallOpeningPreview(scene)
    const displayScene = preparing ? retained.current!.scene : scene
    const openingChanged = openingPreview.sync(displayScene)
    const nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
    const changed = onSceneReady !== presentedCallback.current || scene.userData.lightingPublicationAt !== undefined || openingChanged || geometryChanged || visibilityChanged || lightingChanged || transformsChanged || lightRevision.current !== (scene.userData.liveLightRevision ?? 0) || displayEffectRevision.current !== (scene.userData.displayEffectRevision ?? 0) ||
      viewChanged || (!preparing && currentContent !== presentedContent.current) ||
      dimensions.current !== nextDimensions || selection.current !== selectionRevision || exposure.current !== gl.toneMappingExposure
    if (adaptive && limitIdleDraws && !preparing && !moving && !changed && now - lastDraw.current < MODELLING_IDLE_DRAW_INTERVAL_MS) return
    if (!gl.xr.isPresenting && !shouldRenderSceneFrame(now, lastDraw.current, changed, editing, scene.userData.indirectLighting,
      geometryPending, staticScene && !preparing && !needsSnapshot.current, preparing)) return
    const diagnosticUnlit=scene.userData.lightingDiagnosticUnlit===true
    if (diagnosticUnlit) {
      if (!diagnosticDisplay.current) {
        diagnosticDisplay.current = createLightingDiagnosticDisplay(gl, displayScene, camera)
        void diagnosticDisplay.current.preparation.then(() => invalidate()).catch(error => console.error('Diagnostic display preparation failed:', error))
      }
      if (!diagnosticDisplay.current.ready) return
    }
    if (offscreen && !composer.current && !diagnosticUnlit) return
    const autoClear = gl.autoClear
    const shadowAutoUpdate = gl.shadowMap.autoUpdate, shadowNeedsUpdate = gl.shadowMap.needsUpdate
    if (preparing) liveSelection.current!.sync(scene, displayScene, selectionRevision)
    else liveSelection.current!.clear()
    if (openingPreview.active) displayScene.add(openingPreview.group)
    try {
      gl.autoClear = true
      if (preparing) {
        // The retained meshes follow furniture edits. Reusing the old depth
        // map would project the sofa's previous silhouette onto its new pose.
        // Camera-only frames reuse the whole-building map, while the tighter
        // sunlight cascades must follow the current view during preparation.
        gl.shadowMap.autoUpdate = false
        gl.shadowMap.needsUpdate = !!(transformsChanged || geometryChanged || lightingChanged ||
          !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix))
      }
      const draw=()=>floorBatches.current!.draw(displayScene,()=>{
      const lighting = designMode ? undefined : scene.userData
      const restoreFloorGI=lighting?.bindSoftFloorGI?.()
      const restoreSunOffFloorGI=lighting?.bindSunOffSoftFloorGI?.()
      const restoreSunBounceGI=lighting?.bindSunBounceGI?.()
      const restoreLocalSunPreview=lighting?.bindLocalSunPreview?.()
      const restoreHybridGI=import.meta.env.DEV ? lighting?.bindExperimentalHybridGI?.() : undefined
      const restoreSixRayGI=lighting?.bindSixRayGI?.()
      let previewPresented=false
      try {
      if (offscreen && !diagnosticUnlit) {
        const composer = effects!
        if (preparing) composer.setMainScene(displayScene)
        try { composer.render(delta) }
        finally { if (preparing) composer.setMainScene(scene) }
      } else if (diagnosticUnlit) diagnosticDisplay.current!.render(displayScene, camera)
      else gl.render(displayScene, camera)
      previewPresented=true
      } finally { restoreSixRayGI?.(previewPresented && !preparing); restoreHybridGI?.(previewPresented); restoreLocalSunPreview?.(previewPresented); restoreSunBounceGI?.(); restoreSunOffFloorGI?.(); restoreFloorGI?.() }
      })
      if(!designMode&&scene.userData.lightingPublicationAt!==undefined&&scene.userData.measureLightingApplication){scene.userData.measureLightingApplication(draw);delete scene.userData.lightingPublicationAt}
      else draw()
      const overlay = designMode ? undefined : scene.userData.sixRayOverlay
      if (overlay && !gl.xr.isPresenting) {
        // Draw inspection lines over the finished frame, outside the scene's
        // retained geometry, depth prepasses and postprocessing overrides.
        const target = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
        gl.autoClear = false
        gl.setRenderTarget(null)
        try { gl.render(overlay, camera) }
        finally { gl.setRenderTarget(target, face, mip) }
      }
    } finally {
      openingPreview.group.removeFromParent()
      gl.autoClear = autoClear
      gl.shadowMap.autoUpdate = shadowAutoUpdate; gl.shadowMap.needsUpdate = shadowNeedsUpdate
    }
    if (!preparing && needsSnapshot.current && !snapshotWork.current) {
      snapshotWork.current = true
      const version = ++snapshotGeneration.current
      void prepareRetainedViewportScene(scene, () => version !== snapshotGeneration.current).then(next => {
        if (version !== snapshotGeneration.current) { next?.dispose(); return }
        snapshotWork.current = false
        if (!next) return
        // Three draws shadows before it sets up the light counts for a scene's
        // first colour pass. Prime the new snapshot's light state. An empty
        // group submits no materials or shaders.
        gl.compile(new Group(), camera, next.scene)
        retained.current?.dispose(); retained.current = next; needsSnapshot.current = false
        opaque.current?.dispose(); opaque.current = null
        if (scene.userData.progressiveStartup && scene.userData.progressiveStartup.phase !== 'full') {
          scene.userData.progressiveStartup.phase = 'full'
          scene.userData.viewportShaderAudit?.markInteractive()
          scene.userData.progressiveStartup.fullReadyMs = performance.now() - startedAt.current
        }
      }).catch(error => {
        if (version === snapshotGeneration.current) snapshotWork.current = false
        console.warn('Retaining prepared view failed:', error)
      })
    }
    // The basic geometry preview can release the cover earlier. Other retained
    // frames may still belong to the previous house.
    if (!preparing) {
      if (!fullFramePresented.current && scene.userData.progressiveStartup) {
        scene.userData.progressiveStartup.lightingReadyMs = performance.now() - startedAt.current
        scene.userData.progressiveStartup.programsAtLighting = gl.info.programs?.length ?? 0
      }
      fullFramePresented.current = true
      presentedContent.current = currentContent
    }
    if (!preparing && onSceneReady !== presentedCallback.current) {
      presentedCallback.current = onSceneReady
      onSceneReady?.()
    }
    lastDraw.current = now
    if (measureMotion) displayPerformance.current.presented(now)
    view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
    dimensions.current = nextDimensions
    selection.current = selectionRevision
    lightRevision.current = scene.userData.liveLightRevision ?? 0
    displayEffectRevision.current = scene.userData.displayEffectRevision ?? 0
    exposure.current = gl.toneMappingExposure
  }, 1)
  return null
}
