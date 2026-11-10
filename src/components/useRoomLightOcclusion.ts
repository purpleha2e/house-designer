/* eslint-disable react-hooks/immutability -- These are live Three.js resources, updated after React commits. */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { DataTexture, FloatType, NearestFilter, RGBAFormat, type Object3D } from 'three'
import { snapshotIndirectGeometry } from '../indirectVisibility'
import type { RoomLightOcclusion, RoomOcclusionLight } from '../roomLightOcclusion'
import type { RoomLightShaderUniforms } from '../roomLightShader'

export function useRoomLightOcclusion(scene: Object3D, revision: string, blocked: boolean,
  lights: RoomOcclusionLight[], boundaries: DataTexture, uniforms: RoomLightShaderUniforms, invalidate: () => void) {
  const lightsKey = JSON.stringify(lights)
  const key = revision + lightsKey
  const [prepared, setPrepared] = useState<{ key: string; result: RoomLightOcclusion } | null>(null)
  useEffect(() => {
    if (blocked || !lights.length || prepared?.key === key) return
    let disposed = false, worker: Worker | undefined
    const timer = setTimeout(() => {
      worker = new Worker(new URL('../roomLightOcclusion.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = event => {
        worker?.terminate()
        if (disposed) return
        if (event.data.ok) setPrepared({ key, result: event.data.result })
        else console.warn('Room light occlusion preparation failed:', event.data.error)
      }
      worker.onerror = error => { worker?.terminate(); console.warn('Room light occlusion worker failed:', error.message) }
      worker.postMessage({ geometry: snapshotIndirectGeometry(scene), lights: JSON.parse(lightsKey) })
    }, 100)
    return () => { disposed = true; clearTimeout(timer); worker?.terminate() }
  }, [blocked, key, lightsKey, lights.length, prepared?.key, scene])
  const ready = !blocked && prepared?.key === key ? prepared.result : null
  const combined = useMemo(() => {
    if (!ready) return null
    const base = boundaries.image.data as Float32Array
    const records = base.length / 4 + ready.records.length / 4
    const width = Math.min(1024, records), height = Math.ceil(records / width)
    const data = new Float32Array(width * height * 4)
    data.set(base); data.set(ready.records, base.length)
    const texture = new DataTexture(data, width, height, RGBAFormat, FloatType)
    texture.minFilter = texture.magFilter = NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true
    return { texture, start: base.length / 4 }
  }, [boundaries, ready])
  useLayoutEffect(() => {
    uniforms.occlusionRequired.value = 1
    uniforms.boundaries.value = combined?.texture ?? boundaries
    uniforms.occlusion.value.set(combined?.start ?? 0, ready?.triangles ?? 0, ready?.size ?? 0, ready?.lights.length ?? 0)
    scene.userData.roomLightOcclusion = { ready: !!ready, lights: ready?.lights.length ?? 0, records: ready?.records.length ?? 0 }
    invalidate()
  }, [boundaries, combined, ready, uniforms, invalidate, scene])
  useEffect(() => () => combined?.texture.dispose(), [combined])
  return ready?.lights
}
