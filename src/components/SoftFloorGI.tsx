/* eslint-disable react-hooks/immutability -- Three.js scene metadata and shader uniforms are imperative resources. */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Data3DTexture } from 'three'
import { snapshotIndirectGeometrySteps } from '../indirectVisibility'
import type { createIndirectUniforms } from '../indirectLightingShader'
import { prepareTextureReplacement } from '../textureUpload'
import { runViewportTask } from '../viewportScheduling'
import { softFloorGISource, softFloorGISourceMatches, type SoftFloorGISnapshot, type SoftFloorGISource } from '../softFloorGISource'
export type { SoftFloorGISnapshot } from '../softFloorGISource'

/** Optional display filtering owns one cancellable job and publishes only fully
 * uploaded textures. The transport/persistence floor remains authoritative. */
export function SoftFloorGI({ cm, snapshot, uniforms, onStatus, sourceUniform = 'hdGIFloorLayer', bindingKey = 'bindSoftFloorGI', statusKey = 'softFloorGI' }: {
  sourceUniform?: 'hdGIFloorLayer' | 'hdSunOffFloor'; bindingKey?: string; statusKey?: string; cm: number;
  snapshot: () => SoftFloorGISnapshot; uniforms: ReturnType<typeof createIndirectUniforms>; onStatus?: (status: string) => void
}) {
  const { scene, gl, invalidate } = useThree()
  const latest = useRef({ cm, snapshot, onStatus })
  useLayoutEffect(() => { latest.current = { cm, snapshot, onStatus } }, [cm, snapshot, onStatus])
  const runtime = useRef<{ worker?: Worker; id: number; source?: SoftFloorGISource; workerGeometryKey?: string;
    radius?: number; texture?: Data3DTexture; readyId?: number; busy: boolean; failed?: SoftFloorGISource }>({ id: 0, busy: false })
  const stop = useCallback(() => {
    const state = runtime.current
    state.id++; state.worker?.terminate(); state.worker = undefined; state.workerGeometryKey = undefined
    state.source = undefined; state.readyId = undefined; state.busy = false
  }, [])
  useEffect(() => {
    const state = runtime.current
    const bind = () => {
      const current = latest.current, now = current.snapshot()
      if (!current.cm || state.readyId !== state.id || state.radius !== current.cm ||
        !softFloorGISourceMatches(state.source, now) || !state.texture) return
      const original = uniforms[sourceUniform].value
      uniforms[sourceUniform].value = state.texture
      return () => { uniforms[sourceUniform].value = original }
    }
    scene.userData[bindingKey] = bind
    return () => {
      stop(); state.texture?.dispose(); state.texture = undefined
      if (scene.userData[bindingKey] === bind) delete scene.userData[bindingKey]
      delete scene.userData[statusKey]
    }
  }, [scene, uniforms, sourceUniform, bindingKey, statusKey, stop])
  useEffect(() => {
    if (!cm) {
      stop(); runtime.current.texture?.dispose(); runtime.current.texture = undefined; runtime.current.failed = undefined
      onStatus?.(''); scene.userData[statusKey] = { state: 'off', cm: 0 }
    }
    scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1; invalidate()
  }, [cm, invalidate, scene, onStatus, statusKey, stop])
  useFrame(() => {
    const state = runtime.current, current = latest.current
    if (!current.cm) return
    const now = current.snapshot(), field = now.field
    if (state.source && !softFloorGISourceMatches(state.source, now) && state.busy) stop()
    if (!now.ready || !field.floorLayer.ready) { current.onStatus?.('Waiting for lighting…'); return }
    if (softFloorGISourceMatches(state.failed, now)) return
    if (field.shOrder !== 1) { state.failed = softFloorGISource(now); current.onStatus?.('Soft floor GI requires L1 lighting'); return }
    if (softFloorGISourceMatches(state.source, now) && state.radius === current.cm) return
    // Never queue another expensive graph behind one already superseded.
    if (state.busy) stop()
    const source = softFloorGISource(now), id = ++state.id
    state.source = source; state.radius = current.cm; state.readyId = undefined; state.busy = true
    const cancelled = () => state.id !== id || !latest.current.cm || latest.current.cm !== state.radius ||
      !softFloorGISourceMatches(source, latest.current.snapshot())
    const fail = (error: unknown) => {
      if (state.id !== id) return
      stop(); state.failed = source; latest.current.onStatus?.('Soft floor GI unavailable')
      scene.userData[statusKey] = { state: 'error', error: String(error) }
    }
    try {
      if (!state.worker) state.worker = new Worker(new URL('../indirectFloorFilter.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) { fail(error); return }
    const worker = state.worker
    worker.onerror = event => fail(event.message)
    worker.onmessageerror = () => fail('Floor filter response could not be decoded')
    worker.onmessage = ({ data }) => {
      if (data.id !== id || cancelled()) return
      if (data.error) { fail(data.error); return }
      scene.userData[statusKey] = { state: 'uploading', cm: state.radius }
      void prepareTextureReplacement(gl, source.texture, cancelled, data.output).then(texture => {
        if (!texture) return
        if (cancelled()) { texture.dispose(); return }
        state.texture?.dispose(); state.texture = texture; state.readyId = id; state.busy = false
        latest.current.onStatus?.(`${state.radius} cm ready`)
        scene.userData[statusKey] = { state: 'ready', cm: state.radius, statistics: data.statistics }
        scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1; invalidate()
      }).catch(fail)
    }
    current.onStatus?.('Preparing soft floor GI…'); scene.userData[statusKey] = { state: 'preparing', cm: current.cm }
    void (async () => {
      const geometryChanged = state.workerGeometryKey !== now.geometryKey
      const geometry = geometryChanged ? await runViewportTask(snapshotIndirectGeometrySteps(scene), cancelled) : undefined
      if (cancelled()) return
      state.workerGeometryKey = now.geometryKey
      worker.postMessage({ id, radius: current.cm / 100,
        field: { shOrder: field.shOrder, bounds: field.bounds, floors: field.floors.map(f => ({ elevation: f.elevation })), floorLayer: { n: field.floorLayer.n, data: field.floorLayer.data } },
        ...(geometryChanged ? { geometry } : {}) })
    })().catch(fail)
  })
  return null
}
