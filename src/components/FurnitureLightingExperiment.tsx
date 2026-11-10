import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Mesh, MeshStandardMaterial, Vector4, type Material, type Object3D } from 'three'
import type { IndirectField } from '../indirectLighting'
import { sampleObjectGI, patchObjectGIShader } from '../furnitureObjectGI'
import { furnitureLightingSources } from '../furnitureLightingMaterials'
import { requestShaderWarmup } from '../shaderWarmupState'

/** Private materials isolate the chosen object. The active uniform also
 * restores any retained viewport copies when this experiment is disabled. */
export function FurnitureLightingExperiment({ modelId, onStatus }: {
  modelId: string
  onStatus: (status: string) => void
}) {
  const { scene, invalidate } = useThree()
  useEffect(() => {
    const uniforms = {
      objectSHR: { value: new Vector4() }, objectSHG: { value: new Vector4() },
      objectSHB: { value: new Vector4() }, objectGIActive: { value: 0 },
    }
    const originals = new Map<Mesh, Material | Material[]>()
    const copies = new Map<Material, Material>()
    let root: Object3D | undefined, lastField: IndirectField | undefined
    let matrix: number[] = [], stamp = '', lastScan = -Infinity, lastAttempt = -Infinity, lastMessage = ''
    let started = false, updates = 0
    const report = (message: string) => {
      scene.userData.furnitureLightingExperiment = { modelId, active: uniforms.objectGIActive.value === 1, updates, message }
      if (message !== lastMessage) { lastMessage = message; onStatus(message) }
    }
    const restore = () => {
      uniforms.objectGIActive.value = 0
      const hadMaterials = originals.size > 0
      if (hadMaterials) requestShaderWarmup(scene)
      for (const [mesh, material] of originals) {
        const current = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        if (current.every(m => [...copies.values()].includes(m) || !(m instanceof MeshStandardMaterial))) mesh.material = material
      }
      originals.clear()
      for (const material of copies.values()) material.dispose()
      copies.clear()
      started = false
    }
    const clone = (source: Material) => {
      if (!(source instanceof MeshStandardMaterial)) return source
      let copy = copies.get(source)
      if (copy) return copy
      copy = source.clone()
      Object.assign(copy, { defaultAttributeValues: Reflect.get(source, 'defaultAttributeValues') })
      const compile = source.onBeforeCompile, key = source.customProgramCacheKey()
      copy.onBeforeCompile = (shader, renderer) => {
        compile.call(source, shader, renderer)
        Object.assign(shader.uniforms, uniforms)
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nuniform vec4 objectSHR;uniform vec4 objectSHG;uniform vec4 objectSHB;uniform float objectGIActive;')
        shader.fragmentShader = patchObjectGIShader(shader.fragmentShader)
          .replace('hdGICapture < .5 ? 0.0', 'hdGICapture < .5 && objectGIActive > .5 ? 0.0')
          .replace('if(hdGICapture<.5){vec4 basis', 'if(hdGICapture<.5 && objectGIActive>.5){vec4 basis')
      }
      copy.customProgramCacheKey = () => key + ':furniture-preview-v1:' + modelId
      copy.needsUpdate = true
      copies.set(source, copy)
      furnitureLightingSources.set(copy, source)
      return copy
    }
    const tick = () => {
      const now = performance.now()
      let changed = false
      // Detect asynchronously loaded/replaced meshes, including finish edits.
      if (now - lastScan > 250) {
        lastScan = now
        const next = scene.getObjectByName(`model-transform-${modelId}`)
        if (next !== root) { restore(); root = next; matrix = []; changed = true }
        if (root) {
          const live = new Set<Mesh>()
          root.traverse(o => {
            if (o instanceof Mesh && !o.userData.selectionDecoration &&
                (Array.isArray(o.material) ? o.material : [o.material]).some(m => m instanceof MeshStandardMaterial)) live.add(o)
          })
          if (started && (live.size !== originals.size || [...live].some(mesh => !originals.has(mesh) ||
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => m instanceof MeshStandardMaterial && ![...copies.values()].includes(m))))) {
            restore(); changed = true
          }
        }
      }
      if (!root || root.userData.indirectLightModel || root.userData.indirectStairModel) {
        report('Waiting for the furniture to load.'); return
      }
      const field = scene.userData.getLightingField?.() as IndirectField | undefined
      const progress = scene.userData.indirectLighting
      if (!field || field.shOrder !== 1 || (!started && progress?.state !== 'ready')) {
        uniforms.objectGIActive.value = 0
        report(field && field.shOrder !== 1 ? 'This experiment needs L1 lighting.' : 'Waiting for room lighting.'); return
      }
      root.updateWorldMatrix(true, true)
      const publication = [progress?.generation, progress?.previewUpdates, progress?.fullPassPublications, progress?.state].join(':')
      if (!changed && started && lastField === field && stamp === publication && matrix.every((v, i) => v === root!.matrixWorld.elements[i])) return
      if (!changed && !started && now - lastAttempt < 250) return
      lastAttempt = now
      const otherBounds: Box3[] = []
      scene.traverse(o => { if (o !== root && o.name.startsWith('model-transform-') && !o.userData.indirectLightModel) otherBounds.push(new Box3().setFromObject(o)) })
      const result = sampleObjectGI(field, new Box3().setFromObject(root), 'above', otherBounds)
      uniforms.objectGIActive.value = result.ok ? 1 : 0
      if (result.ok) {
        for (let c = 0; c < 3; c++) [uniforms.objectSHR, uniforms.objectSHG, uniforms.objectSHB][c].value.fromArray(result.coefficients, c * 4)
        if (!started) {
          // Material swaps change shader features even though no house geometry
          // changed. Prepare them through the normal cached-display handoff.
          requestShaderWarmup(scene)
          root.traverse(o => {
          if (!(o instanceof Mesh) || o.userData.selectionDecoration) return
          if (!(Array.isArray(o.material) ? o.material : [o.material]).some(m => m instanceof MeshStandardMaterial)) return
          originals.set(o, o.material)
          o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material)
          })
        }
        started = true
      }
      lastField = field; stamp = publication; matrix = root.matrixWorld.elements.slice(); updates++
      report(result.ok ? 'Experimental lighting active.' : `Original lighting: ${result.reason}.`)
      invalidate()
    }
    const timer = window.setInterval(() => invalidate(), 250)
    scene.userData.updateFurnitureLightingExperiment = tick
    invalidate()
    return () => {
      clearInterval(timer); restore()
      delete scene.userData.updateFurnitureLightingExperiment
      delete scene.userData.furnitureLightingExperiment
      invalidate()
    }
  }, [scene, invalidate, modelId, onStatus])
  useFrame(() => scene.userData.updateFurnitureLightingExperiment?.())
  return null
}
