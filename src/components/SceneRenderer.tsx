import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, NoToneMapping } from 'three'
import type { EffectComposer } from 'postprocessing'
import { shouldRenderSceneFrame } from '../sceneRenderSchedule'
import { retainViewportScene, prepareRetainedViewportScene } from '../retainedViewportScene'
import { createOpaqueViewportScene, prepareOpaqueViewportScene } from '../opaqueViewportScene'
import { compileShaderWarmup, drainShaderWarmupPrograms, prepareShaderWarmupResources } from '../shaderWarmup'
import { createViewportSelection } from '../viewportSelection'
import { isWallClippingPending } from '../wallEngine/wallRoofClipClient'
import { isRoofAssemblyPending } from '../roofAssemblyClient'
import { isViewportPreparationPending } from '../viewportScheduling'
import { getWallOpeningPreview } from '../wallOpeningPreview'
import { createLightingDiagnosticDisplay } from '../lightingDiagnosticDisplay'
import { installRendererAttributeDefaults } from '../rendererAttributeDefaults'
import { recordRendererFrame } from '../rendererHealth'

/** Own the display draw so asset/shader preparation cannot trigger synchronous
 * first-use compilation, and static display frames do not compete with GI. */
export function SceneRenderer({ blocked, geometryPending, contentRevision = '', offscreen, postprocessingExpected = offscreen, composer, editing, wireframe, selectionRevision, opaquePending, onOpaqueReady, lightingStarted, onLightingReady, onSceneReady, staticScene = false }: {
  blocked: boolean; offscreen: boolean; composer: RefObject<EffectComposer | null>
  postprocessingExpected?: boolean
  editing: boolean; wireframe: boolean; geometryPending: boolean
  selectionRevision: string; opaquePending: boolean; onOpaqueReady: () => void
  lightingStarted: boolean; onLightingReady: () => void
  staticScene?: boolean
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
  const diagnosticDisplay = useRef<ReturnType<typeof createLightingDiagnosticDisplay> | null>(null)
  const liveSelection = useRef<ReturnType<typeof createViewportSelection> | null>(null)
  if (liveSelection.current === null) liveSelection.current = createViewportSelection()
  const retained = useRef<ReturnType<typeof retainViewportScene> | null>(null)
  const opaque = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const opaqueReady = useRef(false)
  const opaqueWork = useRef(false)
  const preview = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const previewWork = useRef(false)
  const previewFailed = useRef(false)
  const previewContent = useRef(contentRevision)
  const startupContent = useRef(contentRevision)
  const lit = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const lightingWork = useRef(false), lightingReady = useRef(false), generation = useRef(0)
  const litFence = useRef<WebGLSync | null>(null)
  const diffuseFence = useRef<WebGLSync | null>(null)
  const opaqueStableSince = useRef(0)
  const fence = useRef<WebGLSync | null>(null)
  const startedAt = useRef(0)
  const needsSnapshot = useRef(true)
  const snapshotWork = useRef(false), snapshotGeneration = useRef(0)
  const {gl,invalidate}=useThree()
  useEffect(() => installRendererAttributeDefaults(gl), [gl])
  useEffect(() => {
    const restore = () => { needsSnapshot.current = true; previewFailed.current = false }
    gl.domElement.addEventListener('webglcontextrestored', restore)
    return () => gl.domElement.removeEventListener('webglcontextrestored', restore)
  }, [gl])
  useEffect(() => () => {
    generation.current++
    snapshotGeneration.current++
    retained.current?.dispose(); opaque.current?.dispose(); lit.current?.dispose(); preview.current?.dispose()
    liveSelection.current?.clear()
    diagnosticDisplay.current?.dispose(); diagnosticDisplay.current = null
    if (fence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(fence.current)
    if (litFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(litFence.current)
    if (diffuseFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(diffuseFence.current)
  }, [gl])
  useFrame(({ camera, gl, scene, size }, delta) => {
    recordRendererFrame(gl, camera)
    if (!startedAt.current) startedAt.current = performance.now()
    // The display gate reads worker state immediately; expensive React scene
    // reconciliation is allowed to follow later as a background transition.
    const workerPending = isWallClippingPending() || isRoofAssemblyPending() || isViewportPreparationPending()
    if (!fullFramePresented.current && startupContent.current !== contentRevision) {
      // Initial preparation may overlap wall/window edits. Its snapshots are
      // immutable and belong to that content revision, never to later walls.
      startupContent.current = contentRevision; generation.current++
      // Keep this project's prepared basic view navigable until its replacement
      // is uploaded. The project-key boundary prevents cross-project reuse.
      if (!preview.current && opaque.current) { preview.current = opaque.current; opaque.current = null }
      previewWork.current = false; previewFailed.current = false
      opaque.current?.dispose(); opaque.current = null; opaqueWork.current = false; opaqueReady.current = false
      lit.current?.dispose(); lit.current = null; lightingWork.current = false; lightingReady.current = false
      for (const ref of [fence, litFence, diffuseFence]) {
        if (ref.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(ref.current)
        ref.current = null
      }
      opaqueStableSince.current = 0
    }
    const preparing = (blocked || geometryPending || workerPending || scene.userData.shaderWarmupPending || scene.userData.indirectScanPending) && !gl.xr.isPresenting
    if (preparing) {
      needsSnapshot.current = true
      if (snapshotWork.current) { snapshotGeneration.current++; snapshotWork.current = false }
    }
    // A new shader/resource request can arrive between the first completed
    // display and its asynchronous retained snapshot. Keep that completed
    // frame instead of replacing it with the shadow-free startup preview.
    if (preparing && fullFramePresented.current && !retained.current) return
    // Geometry readiness is independent of asset, GI and detailed shader
    // readiness. Reuse the existing simple direct/ambient preview materials
    // on the actual meshes while the richer display prepares separately.
    if (!retained.current && !opaque.current && (!preview.current || previewContent.current !== contentRevision) && !previewWork.current && !previewFailed.current &&
      !geometryPending && !workerPending) {
      previewWork.current = true
      const version = generation.current, cancelled = () => version !== generation.current
      void (async () => {
        const next = await prepareOpaqueViewportScene(scene, { basic: true }, cancelled)
        if (!next) return
        try {
          const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, { cancelled })
          if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, true, cancelled) || cancelled()) { next.dispose(); return }
          if (opaque.current || retained.current) { next.dispose(); return }
          preview.current?.dispose(); preview.current = next; previewContent.current = contentRevision; invalidate()
        } catch (error) { next.dispose(); throw error }
      })().catch(error => {
        if (!cancelled()) { previewFailed.current = true; console.warn('Basic geometry display unavailable:', error) }
      })
        .finally(() => { if (!cancelled()) previewWork.current = false })
    }
    if (lightingStarted && opaqueReady.current && !lightingWork.current && !opaquePending &&
      !scene.userData.indirectScanPending && scene.userData.indirectLighting) {
      lightingWork.current = true
      const version = generation.current, started = performance.now()
      scene.userData.viewportPreparation = { message: 'Preparing lighting shaders...', startedAt: started }
      void (async () => {
        const cancelled = () => version !== generation.current
        const next = await prepareOpaqueViewportScene(scene, { lighting: true }, cancelled)
        if (!next) return
        try {
          const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, {
            cancelled: () => version !== generation.current,
            onProgress: (completed, total) => {
              if (version === generation.current) scene.userData.viewportPreparation = {
                message: 'Preparing lighting shaders...', startedAt: started, completed, total,
              }
            },
            compile: batch => {
              const target = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
              const toneMapping = gl.toneMapping
              try {
                gl.setRenderTarget(null)
                const direct = gl.compileAsync(batch, camera, next.scene)
                // EffectComposer takes ownership of tone mapping when it is
                // constructed. That can happen after this lit preview starts
                // preparing. Retain both actual direct-display configurations
                // so its shared shadow blockers cannot link on the first draw.
                if (postprocessingExpected && toneMapping !== NoToneMapping) {
                  gl.toneMapping = NoToneMapping
                  try { return drainShaderWarmupPrograms([direct, gl.compileAsync(batch, camera, next.scene)]) }
                  catch (error) {
                    // A synchronous second-submission failure must still drain
                    // the first poller before its source snapshot is released.
                    return drainShaderWarmupPrograms([direct]).then(() => { throw error }, () => { throw error })
                  }
                }
                return direct
              } finally { gl.toneMapping = toneMapping; gl.setRenderTarget(target, face, mip) }
            },
          })
          if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, true, cancelled)) { next.dispose(); return }
          lit.current = next
          delete scene.userData.viewportPreparation
          scene.userData.progressiveStartup.lightingCompileMs = performance.now() - started
        } catch (error) { next.dispose(); throw error }
      })().catch(error => {
        if (version !== generation.current) return
        console.warn('Early lighting unavailable:', error)
        scene.userData.progressiveStartup.lightingError = String(error)
        delete scene.userData.viewportPreparation
        onLightingReady()
      })
    }
    if (!retained.current && !opaque.current && !opaqueWork.current) {
      if (opaquePending) opaqueStableSince.current = 0
      else if (!opaqueStableSince.current) opaqueStableSince.current = performance.now()
      else if (performance.now() - opaqueStableSince.current >= 500) {
        opaqueWork.current = true
        const version = generation.current, cancelled = () => version !== generation.current
        void (async () => {
          const next = await prepareOpaqueViewportScene(scene, {}, cancelled)
          if (!next) return
          try {
            const ready = await compileShaderWarmup(gl, next.scene, camera, next.scene, {
              cancelled,
              compile: batch => {
                const shadows = gl.shadowMap.enabled
                try { gl.shadowMap.enabled = false; return gl.compileAsync(batch, camera, next.scene) }
                finally { gl.shadowMap.enabled = shadows }
              },
            })
            if (!ready || !await prepareShaderWarmupResources(gl, next.scene, camera, next.scene, true, cancelled) || !next.meshes) {
              next.dispose(); return
            }
            opaque.current = next
            preview.current?.dispose(); preview.current = null
          } catch (error) { next.dispose(); throw error }
        })().catch(error => console.warn('Initial display preparation failed:', error))
          .finally(() => { if (!cancelled()) opaqueWork.current = false })
      }
    }
    if (!retained.current && !opaque.current && preview.current) {
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
    if (!retained.current && opaque.current && (preparing || !opaqueReady.current)) {
      const enabled = gl.shadowMap.enabled, autoClear = gl.autoClear
      const display = lit.current ?? opaque.current
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
      if (changed || editing || now - lastDraw.current >= 100 || (lit.current && !litFence.current && !lightingReady.current)) {
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
      if (lit.current && !lightingReady.current) {
        if (!litFence.current) { litFence.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0); context.flush() }
        else {
          const status = context.clientWaitSync(litFence.current, 0, 0)
          if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) {
            context.deleteSync(litFence.current); litFence.current = null; lightingReady.current = true
            Object.assign(scene.userData.progressiveStartup, { phase: 'lit', lightingReadyMs: performance.now() - startedAt.current,
              programsAtLighting: gl.info.programs?.length ?? 0 })
            onLightingReady()
          }
        }
      }
      // The lit preview now has the real sun, shadow casters and camera
      // cascades. It can release the loading cover while final effects compile.
      if (lightingReady.current && lit.current?.scene.userData.preparedLightingViewport &&
        !geometryPending && !workerPending && !opaquePending &&
        !scene.userData.indirectScanPending && onSceneReady !== presentedCallback.current) {
        presentedCallback.current = onSceneReady
        onSceneReady?.()
      }
      if (lit.current && scene.userData.indirectLighting?.diffuseReady && !scene.userData.progressiveStartup.diffuseReadyMs) {
        if (!diffuseFence.current) { diffuseFence.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0); context.flush() }
        else {
          const status = context.clientWaitSync(diffuseFence.current, 0, 0)
          if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) {
            context.deleteSync(diffuseFence.current); diffuseFence.current = null
            scene.userData.progressiveStartup.diffuseReadyMs = performance.now() - startedAt.current
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
    camera.updateMatrixWorld()
    const lightingChanged = preparing && retained.current!.syncLighting()
    const transformsChanged = preparing && retained.current!.syncTransforms()
    const visibilityChanged = preparing && retained.current!.syncVisibility(camera.position)
    const geometryChanged = preparing && retained.current!.syncGeometry()
    const openingPreview = getWallOpeningPreview(scene)
    const displayScene = preparing ? retained.current!.scene : scene
    const openingChanged = openingPreview.sync(displayScene)
    const nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
    const changed = onSceneReady !== presentedCallback.current || scene.userData.lightingPublicationAt !== undefined || openingChanged || geometryChanged || visibilityChanged || lightingChanged || transformsChanged || lightRevision.current !== (scene.userData.liveLightRevision ?? 0) || displayEffectRevision.current !== (scene.userData.displayEffectRevision ?? 0) ||
      !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix) ||
      dimensions.current !== nextDimensions || selection.current !== selectionRevision || exposure.current !== gl.toneMappingExposure
    const now = performance.now()
    if (!gl.xr.isPresenting && !shouldRenderSceneFrame(now, lastDraw.current, changed, editing, scene.userData.indirectLighting,
      geometryPending, staticScene && !preparing && !needsSnapshot.current)) return
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
      const draw=()=>{
      const restoreFloorGI=scene.userData.bindSoftFloorGI?.()
      const restoreSunOffFloorGI=scene.userData.bindSunOffSoftFloorGI?.()
      const restoreSunBounceGI=scene.userData.bindSunBounceGI?.()
      const restoreLocalSunPreview=scene.userData.bindLocalSunPreview?.()
      let previewPresented=false
      try {
      if (offscreen && !diagnosticUnlit) {
        if (preparing) composer.current!.setMainScene(displayScene)
        try { composer.current!.render(delta) }
        finally { if (preparing) composer.current!.setMainScene(scene) }
      } else if (diagnosticUnlit) diagnosticDisplay.current!.render(displayScene, camera)
      else gl.render(displayScene, camera)
      previewPresented=true
      } finally { restoreLocalSunPreview?.(previewPresented); restoreSunBounceGI?.(); restoreSunOffFloorGI?.(); restoreFloorGI?.() }
      }
      if(scene.userData.lightingPublicationAt!==undefined&&scene.userData.measureLightingApplication){scene.userData.measureLightingApplication(draw);delete scene.userData.lightingPublicationAt}
      else draw()
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
        retained.current?.dispose(); retained.current = next; needsSnapshot.current = false
        opaque.current?.dispose(); opaque.current = null
        lit.current?.dispose(); lit.current = null
        if (scene.userData.progressiveStartup && scene.userData.progressiveStartup.phase !== 'full') {
          scene.userData.progressiveStartup.phase = 'full'
          scene.userData.progressiveStartup.fullReadyMs = performance.now() - startedAt.current
        }
      }).catch(error => {
        if (version === snapshotGeneration.current) snapshotWork.current = false
        console.warn('Retaining prepared view failed:', error)
      })
    }
    // The prepared lit preview can release the cover earlier. Other retained
    // frames may still belong to the previous house.
    if (!preparing) fullFramePresented.current = true
    if (!preparing && onSceneReady !== presentedCallback.current) {
      presentedCallback.current = onSceneReady
      onSceneReady?.()
    }
    lastDraw.current = now
    view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
    dimensions.current = nextDimensions
    selection.current = selectionRevision
    lightRevision.current = scene.userData.liveLightRevision ?? 0
    displayEffectRevision.current = scene.userData.displayEffectRevision ?? 0
    exposure.current = gl.toneMappingExposure
  }, 1)
  return null
}
