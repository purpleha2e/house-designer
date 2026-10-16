import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4 } from 'three'
import type { EffectComposer } from 'postprocessing'
import { shouldRenderSceneFrame } from '../sceneRenderSchedule'
import { retainViewportScene } from '../retainedViewportScene'
import { createOpaqueViewportScene } from '../opaqueViewportScene'
import { compileShaderWarmup } from '../shaderWarmup'
import { createViewportSelection } from '../viewportSelection'

/** Own the display draw so asset/shader preparation cannot trigger synchronous
 * first-use compilation, and static display frames do not compete with GI. */
export function SceneRenderer({ blocked, geometryPending, offscreen, composer, editing, wireframe, selectionRevision, opaquePending, onOpaqueReady, lightingStarted, onLightingReady }: {
  blocked: boolean; offscreen: boolean; composer: RefObject<EffectComposer | null>
  editing: boolean; wireframe: boolean; geometryPending: boolean
  selectionRevision: string; opaquePending: boolean; onOpaqueReady: () => void
  lightingStarted: boolean; onLightingReady: () => void
}) {
  const lastDraw = useRef(-Infinity)
  const view = useRef(new Matrix4()), projection = useRef(new Matrix4())
  const dimensions = useRef('')
  const selection = useRef('')
  const liveSelection = useRef<ReturnType<typeof createViewportSelection> | null>(null)
  if (!liveSelection.current) liveSelection.current = createViewportSelection()
  const retained = useRef<ReturnType<typeof retainViewportScene> | null>(null)
  const opaque = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const opaqueReady = useRef(false)
  const lit = useRef<ReturnType<typeof createOpaqueViewportScene> | null>(null)
  const lightingWork = useRef(false), lightingReady = useRef(false), generation = useRef(0)
  const litFence = useRef<WebGLSync | null>(null)
  const diffuseFence = useRef<WebGLSync | null>(null)
  const opaqueStableSince = useRef(0)
  const fence = useRef<WebGLSync | null>(null)
  const startedAt = useRef(performance.now())
  const needsSnapshot = useRef(true)
  const {gl}=useThree()
  useEffect(() => () => {
    generation.current++
    retained.current?.dispose(); opaque.current?.dispose(); lit.current?.dispose()
    liveSelection.current?.clear()
    if (fence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(fence.current)
    if (litFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(litFence.current)
    if (diffuseFence.current) (gl.getContext() as WebGL2RenderingContext).deleteSync(diffuseFence.current)
  }, [gl])
  useFrame(({ camera, gl, scene, size }, delta) => {
    const preparing = (blocked || geometryPending || scene.userData.shaderWarmupPending || scene.userData.indirectScanPending) && !gl.xr.isPresenting
    if (preparing) needsSnapshot.current = true
    if (lightingStarted && opaqueReady.current && !lightingWork.current && !opaquePending &&
      !scene.userData.indirectScanPending && scene.userData.indirectLighting) {
      lightingWork.current = true
      const version = generation.current, started = performance.now()
      const next = createOpaqueViewportScene(scene, { lighting: true })
      void compileShaderWarmup(gl, next.scene, camera, next.scene, {
        cancelled: () => version !== generation.current,
        compile: batch => {
          const shadows = gl.shadowMap.enabled, target = gl.getRenderTarget(), face = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel()
          try { gl.shadowMap.enabled = false; gl.setRenderTarget(null); return gl.compileAsync(batch, camera, next.scene) }
          finally { gl.shadowMap.enabled = shadows; gl.setRenderTarget(target, face, mip) }
        },
      }).then(ready => {
        if (!ready || version !== generation.current) { next.dispose(); return }
        lit.current = next
        scene.userData.progressiveStartup.lightingCompileMs = performance.now() - started
      }).catch(error => {
        next.dispose()
        if (version !== generation.current) return
        console.warn('Early lighting unavailable:', error)
        scene.userData.progressiveStartup.lightingError = String(error)
        onLightingReady()
      })
    }
    if (!retained.current && !opaque.current) {
      if (opaquePending) opaqueStableSince.current = 0
      else if (!opaqueStableSince.current) opaqueStableSince.current = performance.now()
      else if (performance.now() - opaqueStableSince.current >= 500) {
        const next = createOpaqueViewportScene(scene)
        if (next.meshes) opaque.current = next
        else next.dispose()
      }
    }
    if (!retained.current && opaque.current && (preparing || !opaqueReady.current)) {
      const enabled = gl.shadowMap.enabled, autoClear = gl.autoClear
      const display = lit.current ?? opaque.current
      display.syncLighting()
      liveSelection.current!.sync(scene, display.scene)
      try { gl.shadowMap.enabled = false; gl.autoClear = true; gl.render(display.scene, camera) }
      finally { gl.shadowMap.enabled = enabled; gl.autoClear = autoClear }
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
    const nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
    const changed = !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix) ||
      dimensions.current !== nextDimensions || selection.current !== selectionRevision
    const now = performance.now()
    if (!gl.xr.isPresenting && !shouldRenderSceneFrame(now, lastDraw.current, changed, editing, scene.userData.indirectLighting, geometryPending)) return
    if (offscreen && !composer.current) return
    const autoClear = gl.autoClear
    const shadowAutoUpdate = gl.shadowMap.autoUpdate, shadowNeedsUpdate = gl.shadowMap.needsUpdate
    const displayScene = preparing ? retained.current!.scene : scene
    if (preparing) liveSelection.current!.sync(scene, displayScene)
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
    if (!preparing && needsSnapshot.current) {
      const next = retainViewportScene(scene)
      retained.current?.dispose(); retained.current = next; needsSnapshot.current = false
      opaque.current?.dispose(); opaque.current = null
      lit.current?.dispose(); lit.current = null
      if (scene.userData.progressiveStartup && scene.userData.progressiveStartup.phase !== 'full') {
        scene.userData.progressiveStartup.phase = 'full'
        scene.userData.progressiveStartup.fullReadyMs = performance.now() - startedAt.current
      }
    }
    lastDraw.current = now
    view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
    dimensions.current = nextDimensions
    selection.current = selectionRevision
  }, 1)
  return null
}
