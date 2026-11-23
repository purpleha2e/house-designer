/* eslint-disable react-hooks/immutability -- Owned Three.js GPU resources. */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Mesh, SpotLight, type PointLight } from 'three'
import { createFastGI } from '../fastGI'
import { prepareFastCaptureScene } from '../indirectCaptureScene'
import { indirectSurfaceSun } from '../indirectSurfaceRelighting'
import type { IndirectFloor } from '../indirectLighting'
import type { IndirectUniforms } from '../indirectLightingShader'
import type { DaylightSkyMode } from '../daylightSky'
import { MODELLING_LIGHTING_OPTIONS, createModellingLightingSchedule, modellingLightingStatus,
  modellingLightingVolume, type ModellingLightingVolume } from '../modellingLighting'
import { includeViewportObject } from '../viewportSurfaceVisibility'
import { isWallClippingPending } from '../wallEngine/wallRoofClipClient'
import { isRoofAssemblyPending } from '../roofAssemblyClient'
import { isViewportNavigating } from '../viewportScheduling'
import { isModellingLightingArchitecture, modellingLightingArchitectureRevision } from '../modellingLightingGeometry'

/** Interactive GPU diffuse transport. Shader features belong to the parent;
 * navigation, lamp changes and geometry edits only replace capture data. */
export function ModellingLighting({ floors, revision, enabled, blocked, daylight,
  daylightBounceStrength, skyMode = 'clear', skyStrength = 1, captureLights, uniforms, liveEditPending, onUnavailable }: {
  floors: IndirectFloor[]; revision: string; enabled: boolean; blocked: boolean
  daylight: boolean; daylightBounceStrength: number; skyMode?: DaylightSkyMode; skyStrength?: number
  captureLights: readonly (PointLight | SpotLight)[]; uniforms: IndirectUniforms
  liveEditPending?: () => boolean
  onUnavailable?: (reason: string) => void
}) {
  const { gl, scene, camera, invalidate } = useThree()
  const current = useRef({
    engine: null as ReturnType<typeof createFastGI>, schedule: createModellingLightingSchedule(),
    geometryKey: '', geometryBounds: new Box3(), volume: null as ModellingLightingVolume | null,
    lastSelection: -Infinity, publishedAt: 0, unavailable: false, requests: 0, publications: 0,
    inputKey: '', active: false, lastLightCheck: -Infinity, lightingKey: '', failureReported: false,
    architectureKey: '', signatureInput: '', lastSignature: -Infinity, failureReason: '',
  })
  useEffect(() => {
    const state = current.current
    const diagnostic = { state: 'disabled', pending: false, requests: 0, publications: 0,
      scope: '', status: '', frameBudgetMs: MODELLING_LIGHTING_OPTIONS.frameBudgetMs,
      bounces: MODELLING_LIGHTING_OPTIONS.bounces, stats: state.engine?.stats }
    scene.userData.modellingLighting = diagnostic
    return () => {
      state.engine?.dispose(); state.engine = null; state.schedule.reset(); state.unavailable = false
      state.publishedAt = 0; state.active = false; state.geometryKey = ''; state.lastSelection = -Infinity
      uniforms.hdFastWeight.value = 0
      if (scene.userData.modellingLighting === diagnostic) delete scene.userData.modellingLighting
    }
  }, [gl, scene, uniforms])

  useFrame((_, delta) => {
    const state = current.current, now = performance.now()
    const diagnostic = scene.userData.modellingLighting
    const report = (phase: string) => {
      if (!diagnostic) return
      Object.assign(diagnostic, { state: phase, pending: state.schedule.pending, requests: state.requests,
        publications: state.publications, scope: state.volume?.key ?? '', stats: state.engine?.stats,
        status: modellingLightingStatus(phase, state.schedule.pending, !!state.publishedAt),
        error: state.unavailable ? state.failureReason : state.engine?.stats.error })
    }
    if (!enabled || gl.xr.isPresenting) {
      if (state.active) {
        state.engine?.pause(); state.schedule.reset()
        uniforms.hdFastWeight.value = 0
        scene.userData.liveLightRevision = (scene.userData.liveLightRevision ?? 0) + 1
        invalidate()
      }
      state.active = false; report('disabled'); return
    }
    if (!state.active) {
      state.active = true
      // The existing mode owns these shared uniforms while we are inactive.
      // Never present its texture using this engine's previous volume bounds.
      state.schedule.reset(); state.publishedAt = 0; state.failureReported = false
      if (state.engine?.stats.state === 'error' || state.unavailable) { state.engine?.dispose(); state.engine = null }
      state.unavailable = false; state.failureReason = ''
      uniforms.hdFastReady.value = 0; uniforms.hdFastWeight.value = 0
      state.lastSelection = -Infinity; state.lastLightCheck = -Infinity; state.lastSignature = -Infinity
      scene.userData.liveLightRevision = (scene.userData.liveLightRevision ?? 0) + 1
    }
    const preparing = blocked || !!liveEditPending?.() || !!scene.userData.shaderWarmupPending ||
      (!!scene.userData.indirectScanPending && !scene.userData.indirectMaterialsReady) ||
      isWallClippingPending() || isRoofAssemblyPending()
    // Selection stays stable while the authoritative wall/roof workers publish.
    if (!preparing && (state.signatureInput !== revision || now - state.lastSignature > 150)) {
      state.architectureKey = modellingLightingArchitectureRevision(scene)
      state.signatureInput = revision; state.lastSignature = now
    }
    const geometryKey = `${revision}:${state.architectureKey}`
    if (!preparing && (geometryKey !== state.geometryKey || now - state.lastSelection > 150)) {
      if (geometryKey !== state.geometryKey) {
        state.geometryKey = geometryKey; state.geometryBounds.makeEmpty()
        if (!floors.some(floor => floor.rooms.length)) {
          scene.updateMatrixWorld(true)
          const bounds = new Box3()
          scene.traverse(object => {
            if (!(object instanceof Mesh) || !includeViewportObject(object) || object.userData.selectionDecoration) return
            if (!isModellingLightingArchitecture(object) || object.userData.houseDesignerRole === 'ground-plane') return
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
            if (object.geometry.boundingBox) state.geometryBounds.union(bounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld))
          })
        }
      }
      state.volume = modellingLightingVolume(floors, camera.position, state.geometryBounds)
      state.lastSelection = now
    }
    // The imperative lighting controls update these objects before React props.
    if (now - state.lastLightCheck > 80 || state.inputKey !== revision) {
      const sun = indirectSurfaceSun(scene)
      state.lightingKey = JSON.stringify([daylight, daylightBounceStrength, skyMode, skyStrength,
        sun?.position.toArray(), sun?.target.position.toArray(), sun?.color.toArray(), sun?.intensity,
        captureLights.map(light => [light.type, light.position.toArray(), light.color.toArray(), light.intensity,
          light.distance, light.decay, light instanceof SpotLight ? [light.target.position.toArray(), light.angle, light.penumbra] : null])])
      state.lastLightCheck = now; state.inputKey = revision
    }
    if (!state.volume) {
      uniforms.hdFastWeight.value = 0; report('empty'); return
    }
    state.schedule.observe(`${state.volume.key}:${geometryKey}:${state.lightingKey}`, now)
    if (preparing) { report('paused'); invalidate(); return }
    const unavailable = (reason: string) => {
      uniforms.hdFastWeight.value = 0
      if (!state.failureReported) { state.failureReported = true; onUnavailable?.(reason) }
    }
    if (state.unavailable) { unavailable(state.failureReason); report('unavailable'); return }
    if (!state.engine) {
      try {
        state.engine = createFastGI(gl, scene, uniforms, 32, 64,
          { stableCaptureLights: true, retainPassPrograms: true, lightSlotsPerKind: 4, architectureOnly: true })
      } catch (error) { state.failureReason = String(error) }
      if (!state.engine) {
        state.unavailable = true; state.failureReason ||= 'Requires WebGL2 float render targets and standard depth.'
        unavailable(state.failureReason); report('unavailable'); return
      }
    }
    const engine = state.engine
    if (state.schedule.take(now, false)) {
      try {
        const id = engine.request(state.volume, true, daylight, daylightBounceStrength, skyMode, skyStrength)
        state.requests++
        void engine.prepare(id, () => prepareFastCaptureScene(scene,
          () => current.current.engine !== engine || engine.stats.revision !== id, isModellingLightingArchitecture), captureLights)
      } catch (error) {
        state.schedule.finish(); state.unavailable = true; state.failureReason = String(error)
        unavailable(state.failureReason); report('unavailable'); return
      }
    }
    if (state.schedule.running) {
      const options = state.volume.additionalAnchors?.length && !isViewportNavigating()
        ? { ...MODELLING_LIGHTING_OPTIONS, viewsPerFrame: 3 }
        : MODELLING_LIGHTING_OPTIONS
      const pending = engine.step(options, false, Math.min(delta, .05))
      if (engine.stats.state === 'ready' || engine.stats.state === 'error') state.schedule.finish()
      if (engine.stats.publishedAt && engine.stats.publishedAt !== state.publishedAt) {
        state.publishedAt = engine.stats.publishedAt; state.publications++
      }
      if (pending) invalidate()
    }
    if (engine.stats.state === 'error') unavailable(engine.stats.error ?? 'GPU lighting could not be prepared.')
    if (state.schedule.pending) invalidate()
    report(engine.stats.state)
  })
  return null
}
