import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4 } from 'three'
import type { EffectComposer } from 'postprocessing'
import { shouldRenderSceneFrame } from '../sceneRenderSchedule'
import { retainViewportScene, prepareRetainedViewportScene } from '../retainedViewportScene'
import { createOpaqueViewportScene, prepareOpaqueViewportScene } from '../opaqueViewportScene'
import { compileShaderWarmup, prepareShaderWarmupResources } from '../shaderWarmup'
import { prepareInitialViewportPreview } from '../initialViewportPreview'
import { createViewportSelection } from '../viewportSelection'
import { isWallClippingPending } from '../wallEngine/wallRoofClipClient'
import { isRoofAssemblyPending } from '../roofAssemblyClient'
import { isViewportPreparationPending } from '../viewportScheduling'

/** Own the display draw so asset/shader preparation cannot trigger synchronous
 * first-use compilation, and static display frames do not compete with GI. */
export function SceneRenderer({ blocked, geometryPending, offscreen, composer, editing, wireframe, selectionRevision, opaquePending, onOpaqueReady, lightingStarted, onLightingReady, staticScene = false }: {
  blocked: boolean; offscreen: boolean; composer: RefObject<EffectComposer | null>
  editing: boolean; wireframe: boolean; geometryPending: boolean
  selectionRevision: string; opaquePending: boolean; onOpaqueReady: () => void
  lightingStarted: boolean; onLightingReady: () => void
  staticScene?: boolean
}) {
  const lastDraw = useRef(-Infinity)
  const view = useRef(new Matrix4()), projection = useRef(new Matrix4())
  const dimensions = useRef('')
  const selection = useRef('')
  const lightRevision = useRef(0)
  const liveSelection = useRef<ReturnType<typeof createViewportSelection> | null>(null)
  if (liveSelection.current === null) liveSelection.current = createViewportSelection()
  const retained = useRef<ReturnType<typeof retainViewportScene> | null>(null)
  const opaque = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const opaqueReady = useRef(false)
  const opaqueWork = useRef(false)
  const preview = useRef<Awaited<ReturnType<typeof prepareInitialViewportPreview>>>(undefined)
  const lit = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const lightingWork = useRef(false), lightingReady = useRef(false), generation = useRef(0)
  const litFence = useRef<WebGLSync | null>(null)
  const diffuseFence = useRef<WebGLSync | null>(null)
  const opaqueStableSince = useRef(0)
  const fence = useRef<WebGLSync | null>(null)
  const startedAt = useRef(0)
  const needsSnapshot = useRef(true)
  const snapshotWork = useRef(false), snapshotGeneration = useRef(0)
  const {gl}=useThree()
  useEffect(() => {
    const restore = () => { needsSnapshot.current = true }
    gl.domElement.addEventListener('webglcontextrestored', restore)
    return () => gl.domElement.removeEventListener('webglcontextrestored', restore)
  }, [gl])
  useEffect(() => () => {
    generation.current++
    snapshotGeneration.current++
    retained.current?.dispose(); opaque.current?.dispose(); lit.current?.dispose(); preview.current?.dispose()
    liveSelection.current?.clear()
    if (fence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(fence.current)
    if (litFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(litFence.current)
    if (diffuseFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(diffuseFence.current)
  }, [gl])
  useFrame(({ camera, gl, scene, size }, delta) => {
    if (!startedAt.current) startedAt.current = performance.now()
    // The display gate reads worker state immediately; expensive React scene
    // reconciliation is allowed to follow later as a background transition.
    const workerPending = isWallClippingPending() || isRoofAssemblyPending() || isViewportPreparationPending()
    const preparing = (blocked || geometryPending || workerPending || scene.userData.shaderWarmupPending || scene.userData.indirectScanPending) && !gl.xr.isPresenting
    if (preparing) {
      needsSnapshot.current = true
      if (snapshotWork.current) { snapshotGeneration.current++; snapshotWork.current = false }
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
              const shadows = gl.shadowMap.enabled, target = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
              try { gl.shadowMap.enabled = false; gl.setRenderTarget(null); return gl.compileAsync(batch, camera, next.scene) }
              finally { gl.shadowMap.enabled = shadows; gl.setRenderTarget(target, face, mip) }
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
          preview.current = await prepareInitialViewportPreview(scene, gl, camera, cancelled)
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
            preview.current?.dispose(); preview.current = undefined
          } catch (error) { next.dispose(); throw error }
        })().catch(error => console.warn('Initial display preparation failed:', error))
          .finally(() => { if (!cancelled()) opaqueWork.current = false })
      }
    }
    if (!retained.current && !opaque.current && preview.current) {
      camera.updateMatrixWorld()
      const shadows = gl.shadowMap.enabled
      try { gl.shadowMap.enabled = false; gl.render(preview.current.scene, camera) }
      finally { gl.shadowMap.enabled = shadows }
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
        try { gl.shadowMap.enabled = false; gl.autoClear = true; gl.render(display.scene, camera) }
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
            scene.userData.progressiveStartup = { startedAtMs: startedAt.current, opaqueReadyMs: performance.now() - startedAt.current, phase: 'lighting', frames: 0 }
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
    if (wireframe || (preparing && !retained.current)) return
    camera.updateMatrixWorld()
    const lightingChanged = preparing && retained.current!.syncLighting()
    const transformsChanged = preparing && retained.current!.syncTransforms()
    const visibilityChanged = preparing && retained.current!.syncVisibility(camera.position)
    const nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
    const changed = visibilityChanged || lightingChanged || transformsChanged || lightRevision.current !== (scene.userData.liveLightRevision ?? 0) ||
      !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix) ||
      dimensions.current !== nextDimensions || selection.current !== selectionRevision
    const now = performance.now()
    if (!gl.xr.isPresenting && !shouldRenderSceneFrame(now, lastDraw.current, changed, editing, scene.userData.indirectLighting,
      geometryPending, staticScene && !preparing && !needsSnapshot.current)) return
    if (offscreen && !composer.current) return
    const autoClear = gl.autoClear
    const shadowAutoUpdate = gl.shadowMap.autoUpdate, shadowNeedsUpdate = gl.shadowMap.needsUpdate
    const displayScene = preparing ? retained.current!.scene : scene
    if (preparing) liveSelection.current!.sync(scene, displayScene, selectionRevision)
    else liveSelection.current!.clear()
    try {
      gl.autoClear = true
      if (preparing) { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = false }
      if (offscreen) {
        if (preparing) composer.current!.setMainScene(displayScene)
        try { composer.current!.render(delta) }
        finally { if (preparing) composer.current!.setMainScene(scene) }
      } else gl.render(displayScene, camera)
    } finally {
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
    lastDraw.current = now
    view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
    dimensions.current = nextDimensions
    selection.current = selectionRevision
    lightRevision.current = scene.userData.liveLightRevision ?? 0
  }, 1)
  return null
}
