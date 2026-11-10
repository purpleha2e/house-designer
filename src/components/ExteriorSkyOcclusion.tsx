import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Data3DTexture, LinearFilter, Mesh, RGBAFormat, UnsignedByteType } from 'three'
import { indirectGeometryRanges, snapshotIndirectGeometrySteps } from '../indirectVisibility'
import { enableExteriorSkyMaterial, ensureExteriorSkyUniforms, getIndirectLightingUniforms, type IndirectUniforms } from '../indirectLightingShader'
import { requestShaderWarmup } from '../shaderWarmupState'
import { runViewportTask } from '../viewportScheduling'
import type { ExteriorSkyField } from '../exteriorSkyOcclusion'
import type { ExteriorEaveField } from '../exteriorEaveOcclusion'
import { packExteriorSkyTexture } from '../exteriorSkyTexture'
import { isExteriorSkyOccluder as include, isExteriorSkyReceiver, isExteriorEaveOccluder } from '../exteriorSkyReceivers'

type Cache = { key: string; field: ExteriorSkyField; texture: Data3DTexture; eaves: ExteriorEaveField | null }

export function ExteriorSkyOcclusion({ enabled, strength, blocked, onStatus }: {
  enabled: boolean; strength: number; blocked: boolean; onStatus: (status: string) => void
}) {
  const { scene, gl, invalidate } = useThree()
  const cache = useRef<Cache | null>(null), tick = useRef(() => {})
  const latest = useRef({ enabled, strength, blocked, onStatus })
  useEffect(() => { latest.current = { enabled, strength, blocked, onStatus } }, [enabled, strength, blocked, onStatus])
  useEffect(() => {
    let stopped = false, worker: Worker | null = null, pendingKey = '', lastCheck = 0, collecting = false, failedKey = '', bakes = 0
    let bound: IndirectUniforms | undefined, lastApplied = -1
    const changed = () => { scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1; invalidate() }
    const apply = (value: number) => {
      const uniforms = scene.userData.getIndirectUniforms?.() as IndirectUniforms | undefined
      if (!uniforms) return false
      const data = cache.current
      const upgraded = ensureExteriorSkyUniforms(uniforms)
      let shadersChanged = false
      if (data && (upgraded || bound !== uniforms || uniforms.hdExteriorSkyField.value !== data.texture)) {
        uniforms.hdExteriorSkyField.value = data.texture
        uniforms.hdExteriorSkyMin.value.fromArray(data.field.min); uniforms.hdExteriorSkySize.value.fromArray(data.field.size)
        uniforms.hdExteriorSkyDimensions.value.fromArray(data.field.dimensions); uniforms.hdExteriorSkyCell.value = data.field.cell
        uniforms.hdExteriorEaveLayers.value = data.eaves?.layers ?? 0
        if (data.eaves) {
          uniforms.hdExteriorEaveMin.value.fromArray(data.eaves.min); uniforms.hdExteriorEaveSize.value.fromArray(data.eaves.size)
          uniforms.hdExteriorEaveDimensions.value.fromArray(data.eaves.dimensions)
          uniforms.hdExteriorEaveHeight.value.set(data.eaves.heightMin, data.eaves.heightRange)
        }
      }
      // Materials may arrive or be replaced without changing the architecture
      // field (window finishes, selection clones and newly loaded models).
      if (data && value > 0) scene.traverse(object => {
        if (!(object instanceof Mesh)) return
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material && isExteriorSkyReceiver(object, material) && getIndirectLightingUniforms(material)) {
            if (upgraded) { material.needsUpdate = true; shadersChanged = true }
            shadersChanged = enableExteriorSkyMaterial(material) || shadersChanged
          }
        }
      })
      if (value > 0 && !uniforms.hdExteriorSkyFeature.value) {
        uniforms.hdExteriorSkyFeature.value = 1
        scene.traverse(object => {
          if (!(object instanceof Mesh)) return
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material && isExteriorSkyReceiver(object, material) && getIndirectLightingUniforms(material)) material.needsUpdate = true
          }
        })
        shadersChanged = true
      }
      if (shadersChanged) requestShaderWarmup(scene)
      uniforms.hdExteriorSkyStrength.value = value
      if (bound !== uniforms || lastApplied !== value) { bound = uniforms; lastApplied = value; changed() }
      return true
    }
    const cancel = () => { worker?.terminate(); worker = null; pendingKey = '' }
    const report = (text: string) => latest.current.onStatus(text)
    tick.current = () => {
      const settings = latest.current
      if (!settings.enabled || settings.blocked) {
        apply(0); cancel()
        if (!settings.enabled) failedKey = ''
        if (scene.userData.exteriorSkyOcclusion) scene.userData.exteriorSkyOcclusion.enabled = false
        return
      }
      if (!scene.userData.getIndirectUniforms || scene.userData.shaderWarmupPending || scene.userData.indirectScanPending) return
      if (performance.now() - lastCheck < 600 || collecting) return
      lastCheck = performance.now()
      scene.updateMatrixWorld(true)
      const keys: string[] = []
      scene.traverse(object => {
        if (!(object instanceof Mesh) || !include(object)) return
        keys.push(`${object.geometry.uuid}:${object.geometry.attributes.position?.version}:${object.geometry.index?.version}:${JSON.stringify(indirectGeometryRanges(object))}:${object.matrixWorld.elements.join(',')}`)
      })
      const key = 'eave-field-v1|' + keys.sort().join('|')
      if (cache.current?.key === key) {
        if (!apply(settings.strength)) return
        scene.userData.exteriorSkyOcclusion = { ...scene.userData.exteriorSkyOcclusion, state: 'ready', enabled: true, strength: settings.strength }
        report(`${cache.current.eaves ? 'Sky and eave shading ready' : 'Sky visibility ready'} · ${(cache.current.field.ms / 1000).toFixed(1)} s bake · cached`)
        return
      }
      apply(0)
      if (failedKey === key) return
      if (pendingKey === key) return
      cancel(); pendingKey = key; collecting = true
      report('Preparing exterior sky visibility…')
      scene.userData.exteriorSkyOcclusion = { state: 'preparing', bakes }
      function* collectGeometry() {
        const parts = yield* snapshotIndirectGeometrySteps(scene, include)
        const roofParts = yield* snapshotIndirectGeometrySteps(scene, isExteriorEaveOccluder)
        return { parts, roofParts }
      }
      void runViewportTask(collectGeometry(), () => stopped || !latest.current.enabled || latest.current.blocked || pendingKey !== key).then(snapshot => {
        collecting = false
        if (!snapshot || stopped || pendingKey !== key) return
        worker = new Worker(new URL('../exteriorSkyOcclusion.worker.ts', import.meta.url), { type: 'module' })
        const fail = (message: string) => { failedKey = key; cancel(); scene.userData.exteriorSkyOcclusion = { state: 'error', message, bakes }; report(`Sky visibility failed: ${message}`) }
        worker.onerror = event => fail(event.message)
        worker.onmessage = event => {
          if (stopped || pendingKey !== key) return
          const message = event.data
          if (message.kind === 'progress') { report(`Baking exterior sky visibility: ${message.percent}%`); return }
          if (message.kind === 'error') { fail(message.message); return }
          const field = message.field as ExteriorSkyField
          const eaves = message.eaves as ExteriorEaveField | null
          const packed = packExteriorSkyTexture(field, eaves)
          const texture = () => {
            const t = new Data3DTexture(packed.data, packed.width, packed.height, packed.depth)
            t.format = RGBAFormat; t.type = UnsignedByteType; t.minFilter = t.magFilter = LinearFilter
            t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true
            gl.initTexture(t); return t
          }
          const previous = cache.current
          cache.current = { key, field, texture: texture(), eaves }
          bakes++
          scene.userData.exteriorSkyOcclusion = { state: 'ready', bakes, ms: field.ms, rays: field.rays, cell: field.cell,
            dimensions: field.dimensions, eaveLayers: eaves?.layers ?? 0, eaveDimensions: eaves?.dimensions,
            bytes: packed.data.byteLength }
          cancel(); apply(latest.current.enabled && !latest.current.blocked ? latest.current.strength : 0)
          previous?.texture.dispose(); changed()
        }
        worker.postMessage(snapshot)
      }).catch(error => { collecting = false; failedKey = key; cancel(); scene.userData.exteriorSkyOcclusion = { state: 'error', message: String(error), bakes }; report(`Sky visibility failed: ${String(error)}`) })
    }
    const timer = window.setInterval(() => { if (latest.current.enabled) invalidate() }, 600)
    return () => {
      stopped = true; cancel(); tick.current = () => {}; window.clearInterval(timer); apply(0)
      const uniforms = scene.userData.getIndirectUniforms?.() as IndirectUniforms | undefined
      if (uniforms) {
        uniforms.hdExteriorSkyField.value = uniforms.hdGIVolume.value
        uniforms.hdExteriorEaveLayers.value = 0
      }
      cache.current?.texture.dispose(); cache.current = null
      delete scene.userData.exteriorSkyOcclusion
    }
  }, [scene, gl, invalidate])
  useFrame(() => tick.current(), -1)
  return null
}
