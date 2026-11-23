import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BackSide, BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh, Scene } from 'three'
import { createLocalShadowAtlas, createLocalShadowDepthMaterials, type AtlasLight, type LocalShadowAtlasUniforms } from '../localShadowAtlas'
import { snapshotIndirectGeometrySteps } from '../indirectVisibility'
import { runViewportTask } from '../viewportScheduling'
import { subscribeShaderWarmup } from '../shaderWarmupState'
import type { LightShadowState } from '../lightShadowResources'

/** Frozen opaque geometry, including camera-hidden ceilings. Use the same
 * glazing/physical-visibility rules as GI; never bake navigation fades. */
export function* shadowSceneSteps(source: Scene, sharedMaterials?: ReturnType<typeof createLocalShadowDepthMaterials>) {
  const snapshot = yield* snapshotIndirectGeometrySteps(source, mesh => {
    for (let parent = mesh.parent; parent; parent = parent.parent) if (parent.userData.indirectLightModel) return false
    return true
  }, true)
  const scene = new Scene(), materials = sharedMaterials ?? createLocalShadowDepthMaterials(), geometries: BufferGeometry[] = []
  let complete = false
  const dispose = () => { geometries.forEach(geometry => geometry.dispose()); if (!sharedMaterials) materials.dispose(); scene.clear() }
  try {
    for (const part of snapshot) {
      yield
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(part.position, part.stride), 3, part.offset, part.normalized))
      if (part.index) geometry.setIndex(new BufferAttribute(part.index, 1))
      part.ranges.forEach((range, index) => geometry.addGroup(range.start, range.count, index))
      const meshMaterials = part.ranges.map(range => materials.get(range.shadowSide ?? BackSide))
      geometries.push(geometry)
      for (const matrix of part.matrices) {
        const mesh = new Mesh(geometry, meshMaterials)
        mesh.matrix.fromArray(matrix); mesh.matrixAutoUpdate = false
        scene.add(mesh)
      }
    }
    scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false
    complete = true
    return { scene, dispose }
  } finally { if (!complete) dispose() }
}

export function useLocalShadowAtlas(lights: AtlasLight[], revision: string, blocked: boolean,
  control: LightShadowState, enabled: boolean, uniforms: LocalShadowAtlasUniforms) {
  const { gl, scene, invalidate } = useThree()
  const lightKey = JSON.stringify(lights)
  useEffect(() => {
    const context = gl.getContext()
    uniforms.hdLocalShadowRasterSteps ??= { value: 256 }
    uniforms.hdLocalShadowRasterSteps.value = Math.max(16, 2 ** context.getParameter(context.SUBPIXEL_BITS))
  }, [gl, uniforms])
  const displayed = useRef<ReturnType<typeof createLocalShadowAtlas> | null>(null)
  const displayedSources = useRef('')
  const pending = useRef<{ atlas: ReturnType<typeof createLocalShadowAtlas>; capture: { scene: Scene; dispose: () => void }; key: string } | null>(null)
  const preparedKey = useRef('')
  const revisionCounter = useRef(0)
  const depthMaterials = useRef<ReturnType<typeof createLocalShadowDepthMaterials> | null>(null)
  useEffect(() => () => { depthMaterials.current?.dispose(); depthMaterials.current = null }, [gl])
  useEffect(() => subscribeShaderWarmup(scene, () => { revisionCounter.current++; invalidate() }), [scene, invalidate])
  const rebuild = useRef<() => void>(() => {})
  const preparing = useRef<object | null>(null)
  useEffect(() => {
    let cancelled = false
    const releasePending = () => { pending.current?.capture.dispose(); pending.current?.atlas.dispose(); pending.current = null }
    releasePending(); preparing.current = null
    // A new source ordering must never read tiles belonging to the old house.
    const showPrepared = () => {
      uniforms.hdLocalShadowAtlasRequested ??= { value: 1 }
      uniforms.hdLocalShadowAtlasRequested.value = enabled && control.get() ? 1 : 0
      uniforms.hdLocalShadowAtlasEnabled.value = enabled && control.get() && displayed.current && displayedSources.current === lightKey ? 1 : 0
    }
    showPrepared()
    rebuild.current = () => {
      if (cancelled || blocked || !enabled || !control.get() || !lights.length || preparing.current || pending.current) return
      const key = revision + lightKey + ':' + revisionCounter.current
      if (preparedKey.current === key) return
      const request = {}
      preparing.current = request
      const version = revisionCounter.current
      depthMaterials.current ??= createLocalShadowDepthMaterials()
      void runViewportTask(shadowSceneSteps(scene, depthMaterials.current), () => cancelled || version !== revisionCounter.current).then(capture => {
        if (preparing.current !== request) { capture?.dispose(); return }
        preparing.current = null
        if (!capture) return
        if (cancelled || version !== revisionCounter.current) { capture.dispose(); return }
        const context = gl.getContext()
        const maximum = Math.min(gl.capabilities.maxTextureSize, context.getParameter(context.MAX_RENDERBUFFER_SIZE))
        const atlas = createLocalShadowAtlas(JSON.parse(lightKey), maximum)
        pending.current = { capture, atlas, key }
        scene.userData.localShadowAtlas = { ready: false, lights: lights.length, faces: atlas.faceCount, completed: 0 }
        invalidate()
      }).catch(error => { if (preparing.current === request) preparing.current = null; console.warn('Local shadow atlas preparation failed:', error) })
    }
    rebuild.current()
    const unsubscribe = control.subscribe(() => {
      showPrepared()
      rebuild.current(); scene.userData.liveLightRevision = (scene.userData.liveLightRevision ?? 0) + 1; invalidate()
    })
    return () => { cancelled = true; unsubscribe(); releasePending() }
  }, [blocked, control, enabled, gl, invalidate, lightKey, lights.length, revision, scene, uniforms])

  useFrame(() => {
    rebuild.current()
    const job = pending.current
    if (!job || blocked || !enabled || !control.get()) return
    // One face per display frame bounds initial work; walking never refreshes
    // an already prepared atlas. The outgoing complete atlas stays displayed.
    const more = job.atlas.renderNext(gl, job.capture.scene, true)
    scene.userData.localShadowAtlas.completed = job.atlas.completed
    if (!more) {
      const old = displayed.current
      displayed.current = job.atlas; pending.current = null; preparedKey.current = job.key
      displayedSources.current = lightKey
      uniforms.hdLocalShadowAtlas.value = job.atlas.target.texture
      uniforms.hdLocalShadowData.value = job.atlas.metadata
      uniforms.hdLocalShadowAtlasSize.value.set(job.atlas.layout.width, job.atlas.layout.height)
      uniforms.hdLocalShadowDataRows.value = job.atlas.metadata.image.height
      uniforms.hdLocalShadowAtlasEnabled.value = 1
      Object.assign(scene.userData.localShadowAtlas, { ready: true, texture: job.atlas.target.texture.uuid,
        width: job.atlas.layout.width, height: job.atlas.layout.height, tile: job.atlas.layout.tile,
        builds: (scene.userData.localShadowAtlasBuilds ?? 0) + 1 })
      scene.userData.localShadowAtlasBuilds = scene.userData.localShadowAtlas.builds
      job.capture.dispose(); old?.dispose()
      scene.userData.liveLightRevision = (scene.userData.liveLightRevision ?? 0) + 1
    }
    invalidate()
  }, -.25)
  useEffect(() => {
    const placeholder = uniforms.hdLocalShadowAtlas.value
    return () => { displayed.current?.dispose(); placeholder.dispose() }
  }, [uniforms])
}
