/* eslint-disable react-hooks/immutability -- Owned renderer resources and scene diagnostics. */
import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DataUtils, DirectionalLight, Mesh, SpotLight, Vector3, type PointLight, type Texture } from 'three'
import { daylightTransportSkyBase, type DaylightSkyMode } from '../daylightSky'
import type { ReferenceTexture } from '../diffuseSceneMaterials'
import { diffuseSceneTransferList, snapshotReferenceScene } from '../diffuseSceneSnapshot'
import { restoreIndirectField, type IndirectField, type IndirectFloor } from '../indirectLighting'
import { createIndirectUniforms, type IndirectUniforms } from '../indirectLightingShader'
import { indirectSurfaceSun } from '../indirectSurfaceRelighting'
import type { IndirectSHOrder } from '../indirectSH'
import { isLightingGlazing } from '../lightingVisibility'
import { SIX_RAY_VOLUME_RESOLUTION, type SixRayInspection, type SixRayLighting as Sources, type SixRayOpening, type SixRayOptions } from '../sixRayLighting'
import type { SixRayReply, SixRayRequest } from '../sixRayLighting.worker'

function glazedOpening(mesh: Mesh, authored: readonly SixRayOpening[]): SixRayOpening | undefined {
  if (!(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(isLightingGlazing)) return
  let isOpening = false
  for (let parent = mesh as typeof mesh.parent; parent; parent = parent.parent) {
    if (/window|skylight|dormer/i.test(parent.name + ' ' + (parent.userData.houseDesignerRole ?? '')) || parent.userData.exteriorSkyReceiver)
      isOpening = true
  }
  if (!isOpening) return
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (!box || box.isEmpty()) return
  const center = box.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld)
  if (authored.some(opening => center.distanceToSquared(new Vector3().fromArray(opening.center)) < .25)) return
  const size = box.getSize(new Vector3()), m = mesh.matrixWorld.elements
  const axes = [size.x, size.y, size.z].map((width, i) => {
    const direction = new Vector3().fromArray(m, i * 4)
    return { width: width * direction.length(), direction: direction.normalize() }
  }).sort((a, b) => b.width - a.width)
  if (axes[1].width < .15 || axes[2].width > axes[1].width * .3) return
  return { id: mesh.name || 'Roof or glazed opening', center: center.toArray(), width: axes[0].width, height: axes[1].width,
    normal: axes[2].direction.toArray(), u: axes[0].direction.toArray(), v: axes[1].direction.toArray() }
}

type LightingProps = {
  revision: string; layout: string; openings: readonly SixRayOpening[]; options: SixRayOptions; blocked: boolean;
  daylight: boolean; gain: number; skyMode: DaylightSkyMode; skyStrength: number; order: IndirectSHOrder
  lamps: readonly (PointLight | SpotLight)[]; uniforms: IndirectUniforms
}

/** A private, geometry-only worker and an ordinary renderer SH volume. */
export function SixRayLighting(props: LightingProps) {
  const { gl, scene, invalidate } = useThree()
  const { uniforms } = props
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props }, [props])
  const tick = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const status = {
      state: 'waiting', detail: '', geometryBuilds: 0, probes: 0, openings: 0, triangles: 0, textures: 0,
      generation: 0, published: 0, visible: 0, active: '', geometryMs: 0, snapshotMs: 0, bvhMs: 0, layoutMs: 0,
      volumeMs: 0, uploadMs: 0, visibleMs: 0, presentedAt: 0, gpuCompletedMs: 0, gpuCompleted: 0,
      unsupported: {} as Record<string, number>, stats: undefined as Extract<SixRayReply, { kind: 'result' }>['stats'] | undefined,
    }
    scene.userData.sixRayGI = status
    const context = gl.getContext() as WebGL2RenderingContext
    let fence: { sync: WebGLSync; started: number; generation: number } | undefined
    let sun: DirectionalLight | undefined
    let disposed = false, worker: Worker | undefined, layoutField: IndirectField | undefined, ready = false
    let displayField: IndirectField | undefined, display: IndirectUniforms | undefined
    let displayLighting: Sources | undefined
    let revision = '', pending = false, submitted = 0, geometryStarted = 0, presentStarted = 0
    let desired: { id: number; key: string; started: number; options: SixRayOptions; lighting: Sources } | undefined
    let coefficients: Float32Array | undefined
    let probeVisualization: { field: IndirectField; captured: Set<number>; completed: number; generation: number } | undefined
    const textureCache = new WeakMap<Texture, { key: string; value: ReferenceTexture }>()
    const direction = new Vector3(), rgb = new Vector3()
    const inspection = new Map<number, (value?: SixRayInspection) => void>()
    let inspectionId = 0
    const refresh = () => {
      scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1
      invalidate()
    }
    function stopWorker() {
      worker?.terminate(); worker = undefined
      for (const resolve of inspection.values()) resolve()
      inspection.clear()
      if (layoutField !== displayField) layoutField?.dispose()
      layoutField = undefined
      ready = pending = false
    }
    const fail = (error: unknown) => {
      stopWorker()
      status.state = 'error'
      status.detail = error instanceof Error ? error.message : String(error)
      refresh()
    }
    async function prepare(current: LightingProps) {
      stopWorker(); status.state = 'preparing'; status.detail = ''
      geometryStarted = performance.now()
      const channel = new Worker(new URL('../sixRayLighting.worker.ts', import.meta.url), { type: 'module' })
      worker = channel
      const cancelled = () => disposed || worker !== channel
      const openings = [...current.openings]
      channel.onerror = event => { if (!cancelled()) fail(event.message || 'Six-ray worker failed') }
      channel.onmessage = ({ data: reply }: MessageEvent<SixRayReply>) => {
        if (cancelled()) return
        if (reply.kind === 'error') { fail(reply.detail); return }
        if (reply.kind === 'inspection') {
          inspection.get(reply.id)?.(reply.report); inspection.delete(reply.id)
          return
        }
        if (reply.kind === 'ready') {
          layoutField = restoreIndirectField(reply.field, SIX_RAY_VOLUME_RESOLUTION)
          ready = true
          Object.assign(status, { geometryBuilds: status.geometryBuilds + 1, probes: layoutField.probes.length,
            geometryMs: performance.now() - geometryStarted, bvhMs: reply.bvhMs, layoutMs: reply.layoutMs })
        } else {
          pending = false
          if (desired?.id === reply.id && layoutField) {
            const started = performance.now()
            try {
              const volume = layoutField.volume.maps[0]
              layoutField.volume.data = reply.volume as typeof layoutField.volume.data
              volume.image.data = reply.volume
              volume.needsUpdate = true
              gl.initTexture(volume)
              if (displayField !== layoutField) {
                gl.initTexture(layoutField.mask)
                displayField?.dispose()
                displayField = layoutField
                display = createIndirectUniforms(layoutField)
              }
              coefficients = reply.coefficients
              displayLighting = desired.lighting
              presentStarted = Math.min(desired.started, status.published ? Infinity : geometryStarted)
              Object.assign(status, { state: 'ready', active: desired.options.mode, published: reply.id,
                volumeMs: reply.volumeMs, uploadMs: performance.now() - started, stats: reply.stats })
              refresh()
            } catch (error) { fail(error) }
          }
        }
        invalidate()
      }
      try {
        const snapshot = await snapshotReferenceScene({ scene, gl }, undefined, { textureLimit: 128, diffusePbr: true,
          cancelled, interactive: { textureCache, visitMesh: mesh => {
            const opening = glazedOpening(mesh, openings)
            if (opening) openings.push(opening)
          } } })
        if (cancelled()) return
        const data = { ...snapshot.data, textures: snapshot.data.textures.map(texture => ({ ...texture, pixels: texture.pixels.slice() })) }
        Object.assign(status, { snapshotMs: snapshot.snapshotMs, triangles: snapshot.triangles,
          textures: snapshot.textures, unsupported: snapshot.unsupported, openings: openings.length })
        const request: SixRayRequest = { kind: 'prepare', data, openings, floors: JSON.parse(current.layout) as IndirectFloor[], order: current.order }
        channel.postMessage(request, diffuseSceneTransferList(data))
      } catch (error) { if (!cancelled()) fail(error) }
    }

    tick.current = () => {
      const current = latest.current
      if (fence) {
        const result = context.clientWaitSync(fence.sync, 0, 0)
        if (result === context.TIMEOUT_EXPIRED) invalidate()
        else {
          if (result !== context.WAIT_FAILED && fence.generation === status.visible) {
            status.gpuCompleted = fence.generation
            status.gpuCompletedMs = performance.now() - fence.started
          }
          context.deleteSync(fence.sync); fence = undefined
        }
      }
      if (current.blocked || gl.xr.isPresenting) return
      const geometryKey = current.revision + ':' + current.layout + ':' + current.order
      if (revision !== geometryKey) {
        revision = geometryKey
        desired = undefined
        void prepare(current).catch(fail)
      }
      if (!sun?.parent) sun = indirectSurfaceSun(scene)
      direction.set(0, 1, 0)
      if (sun) direction.subVectors(sun.position, sun.target.position).normalize()
      const gain = current.daylight ? current.gain : 0
      const solar = current.daylight && sun ? rgb.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity).toArray() : [0, 0, 0] as [number, number, number]
      const lighting: Sources = {
        sunDirection: direction.toArray(), sunIrradiance: solar, daylightGain: gain, skyMode: current.skyMode,
        skyBase: daylightTransportSkyBase(rgb).multiplyScalar(gain * current.skyStrength).toArray(),
        skySun: solar.map(c => c * gain * Math.max(0, direction.y)) as Sources['skySun'],
        lights: current.lamps.filter(lamp => lamp.intensity > 0).map((lamp): Sources['lights'][number] => ({
          position: lamp.position.toArray(), color: [lamp.color.r, lamp.color.g, lamp.color.b], intensity: lamp.intensity, distance: lamp.distance, decay: lamp.decay,
          ...(lamp instanceof SpotLight ? { direction: rgb.subVectors(lamp.target.position, lamp.position).normalize().toArray(),
            cone: Math.cos(lamp.angle), penumbra: Math.cos(lamp.angle * (1 - lamp.penumbra)) } : {}),
        })),
      }
      const key = JSON.stringify([current.options, lighting])
      if (desired?.key !== key) desired = { id: ++status.generation, key, started: performance.now(), options: current.options, lighting }
      if (!ready || pending || submitted === desired.id) return
      submitted = desired.id
      pending = true
      status.state = 'updating'
      const request: SixRayRequest = { kind: 'solve', id: desired.id, options: desired.options, lighting: desired.lighting }
      worker?.postMessage(request)
    }

    scene.userData.bindSixRayGI = () => {
      const undo: (() => void)[] = []
      function bind<T>(uniform: { value: T }, value: T) {
        const previous = uniform.value
        uniform.value = value
        undo.push(() => { uniform.value = previous })
      }
      bind(uniforms.hdGIDisplayStrength, display ? 1 : 0)
      bind(uniforms.hdGIUseVolume, display ? 1 : 0)
      bind(uniforms.hdFastWeight, 0)
      bind(uniforms.hdSunBounceReady, 0)
      bind(uniforms.hdLocalSunReady, 0)
      bind(uniforms.hdGIFloorLayerReady, 0)
      bind(uniforms.hdGIReceiverSafetyReady, 0)
      bind(uniforms.hdGIContactLayout, 0)
      if (display && displayField) {
        bind(uniforms.hdGIVolume, displayField.volume.maps[0])
        bind(uniforms.hdGIVolumeSize, display.hdGIVolumeSize.value)
        bind(uniforms.hdGIMask, display.hdGIMask.value)
        bind(uniforms.hdGIBounds, display.hdGIBounds.value)
        bind(uniforms.hdGIMaskSize, display.hdGIMaskSize.value)
        bind(uniforms.hdGIFloorCount, display.hdGIFloorCount.value)
        bind(uniforms.hdGIFloorRanges, display.hdGIFloorRanges.value)
        bind(uniforms.hdGIGrids, display.hdGIGrids.value)
      }
      return (presented: boolean) => {
        undo.forEach(reset => reset())
        if (presented && status.published > status.visible) {
          status.visible = status.published
          status.presentedAt = performance.now()
          status.visibleMs = status.presentedAt - presentStarted
          if (fence) context.deleteSync(fence.sync)
          const sync = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0)
          fence = sync ? { sync, started: presentStarted, generation: status.visible } : undefined
          if (fence) { context.flush(); invalidate() }
        }
      }
    }
    scene.userData.inspectSixRayProbe = (point: number[], normal: number[]) => new Promise<SixRayInspection | undefined>(resolve => {
      if (!worker || status.published !== submitted || pending || status.state !== 'ready') { resolve(undefined); return }
      const id = ++inspectionId
      inspection.set(id, resolve)
      const request: SixRayRequest = { kind: 'inspect', id, point, normal }
      worker.postMessage(request)
    })
    scene.userData.getSixRayField = () => ({ field: displayField, coefficients, lighting: displayLighting })
    scene.userData.getSixRayProbeSnapshot = () => {
      const field = displayField, values = coefficients
      if (!field || !values) return undefined
      if (probeVisualization?.generation !== status.published) {
        const captured = new Set<number>()
        for (const [i, probe] of field.probes.entries()) {
          captured.add(probe.index)
          for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) {
            field.coefficients[c][probe.index * field.coefficientCount + k] = DataUtils.toHalfFloat(values[i * 12 + k * 3 + c])
          }
        }
        probeVisualization = { field, captured, completed: captured.size, generation: status.published }
      }
      return probeVisualization
    }
    return () => {
      disposed = true
      tick.current = () => {}
      stopWorker(); displayField?.dispose()
      if (fence) context.deleteSync(fence.sync)
      delete scene.userData.sixRayGI
      delete scene.userData.bindSixRayGI
      delete scene.userData.inspectSixRayProbe
      delete scene.userData.getSixRayField
      delete scene.userData.getSixRayProbeSnapshot
      refresh()
    }
  }, [gl, scene, invalidate, uniforms])

  useFrame(() => tick.current(), .5)
  return null
}
