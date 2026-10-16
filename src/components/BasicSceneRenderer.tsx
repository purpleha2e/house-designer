import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, DirectionalLight, HemisphereLight, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, RawShaderMaterial, Scene, type Material } from 'three'
import { basicSceneReport, opaqueMaterialDiagnostic, pbrMaterialDiagnostic, updateBasicSceneReport } from '../basicSceneDiagnostic'

/** One opaque program for ordinary AND instanced source geometry. Instance
 * transforms become ordinary meshes so no instancing shader variant is needed.
 * Colours encode normals for legibility; there are no lights or texture reads. */
export function BasicSceneRenderer({ pending }: { pending: string[] }) {
  const renderer = useThree(state => state.gl)
  const material = useMemo(() => new RawShaderMaterial({
    side: DoubleSide,
    vertexShader: `precision highp float;
      uniform mat4 projectionMatrix, modelViewMatrix, modelMatrix;
      attribute vec3 position, normal;
      varying vec3 surfaceNormal;
      void main() {
        surfaceNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `precision highp float;
      varying vec3 surfaceNormal;
      void main() { gl_FragColor = vec4(vec3(0.45) + abs(normalize(surfaceNormal)) * 0.35, 1.0); }`,
  }), [])
  const display = useMemo(() => { const scene = new Scene(); scene.background = new Color('#233041'); return scene }, [])
  const opaqueMaterials = useMemo(() => new Map<Material, MeshBasicMaterial | MeshStandardMaterial>(), [])
  const lights = useMemo(() => {
    if (!pbrMaterialDiagnostic) return []
    const key = new DirectionalLight(0xffffff, 3)
    key.position.set(4, 8, 5)
    return [key, new HemisphereLight(0xffffff, 0x888888, 1)]
  }, [])
  const state = useRef({ signature: '', changedAt: 0, displayed: '', fence: null as WebGLSync | null, reported: false })
  useEffect(() => {
    const current = state.current
    return () => {
      if (current.fence) (renderer.getContext() as WebGL2RenderingContext).deleteSync(current.fence)
      material.dispose(); opaqueMaterials.forEach(m => m.dispose()); display.clear()
    }
  }, [display, material, opaqueMaterials, renderer])
  useFrame(({ scene, camera, gl }) => {
    const now = performance.now(), current = state.current
    scene.updateMatrixWorld(true)
    const meshes: Mesh[] = []
    scene.traverseVisible(object => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!materials.some(m => m.visible && m.colorWrite && m.opacity > 0) || !object.geometry.attributes.position?.count) return
      // Selection/collision geometry is not part of the visible model.
      if (object.userData.selectionDecoration || object.userData.houseDesignerRole === 'wall-engine-pick') return
      meshes.push(object)
    })
    const materialKey = (material: Material) => {
      const m = material as MeshStandardMaterial
      return `${m.uuid}:${m.version}:${m.color?.getHex()}:` +
        [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap].map(t => `${t?.uuid}:${t?.version}`).join(',')
    }
    const signature = meshes.map(m => `${m.uuid}:${m.geometry.uuid}:${m instanceof InstancedMesh ? m.count : 1}:${m.matrixWorld.elements.join(',')}:` +
      (opaqueMaterialDiagnostic ? (Array.isArray(m.material) ? m.material : [m.material]).map(materialKey).join(',') : '')).join('|')
    if (signature !== current.signature || pending.length) {
      current.signature = signature; current.changedAt = now
      if (current.reported) { current.reported = false; updateBasicSceneReport({ firstFrameMs: undefined, gpuCompleteMs: undefined }) }
    }
    const pendingKey = pending.join(',')
    if (basicSceneReport.pending?.join(',') !== pendingKey) updateBasicSceneReport({ pending })
    // Explicit settlement time is reported separately, never called geometry CPU time.
    const ready = !pending.length && meshes.length > 0 && now - current.changedAt >= 500
    if (ready && current.displayed !== signature) {
      const start = performance.now()
      display.clear()
      if (lights.length) display.add(...lights)
      opaqueMaterials.forEach(m => m.dispose()); opaqueMaterials.clear()
      const opaque = (source: Material) => {
        let result = opaqueMaterials.get(source)
        if (!result) {
          const m = source as MeshStandardMaterial
          const common = { color: m.color ?? 0xffffff, map: m.map ?? null,
            side: DoubleSide, transparent: false, opacity: 1, alphaTest: 0, depthWrite: true,
            vertexColors: m.vertexColors, visible: m.visible && m.colorWrite && m.opacity > 0, toneMapped: false,
            polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits }
          result = pbrMaterialDiagnostic ? new MeshStandardMaterial({ ...common,
            roughness: m.roughness ?? 1, metalness: m.metalness ?? 0,
            roughnessMap: m.roughnessMap ?? null, metalnessMap: m.metalnessMap ?? null,
            normalMap: m.normalMap ?? null, ...(m.normalScale ? { normalScale: m.normalScale } : {}),
            ...(m.normalMapType !== undefined ? { normalMapType: m.normalMapType } : {}),
            aoMap: m.aoMap ?? null, aoMapIntensity: m.aoMapIntensity ?? 1,
            emissive: m.emissive ?? 0x000000, emissiveIntensity: m.emissiveIntensity ?? 1, emissiveMap: m.emissiveMap ?? null,
          }) : new MeshBasicMaterial(common)
          opaqueMaterials.set(source, result)
        }
        return result
      }
      for (const source of meshes) {
        const add = (matrix: Matrix4) => {
          const mesh = new Mesh(source.geometry, opaqueMaterialDiagnostic
            ? Array.isArray(source.material) ? source.material.map(opaque) : opaque(source.material)
            : material)
          mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.frustumCulled = false
          mesh.renderOrder = source.renderOrder
          display.add(mesh)
        }
        if (source instanceof InstancedMesh) {
          const matrix = new Matrix4()
          for (let i = 0; i < source.count; i++) { source.getMatrixAt(i, matrix); add(matrix.premultiply(source.matrixWorld)) }
        } else add(source.matrixWorld)
      }
      current.displayed = signature
      updateBasicSceneReport({ geometryReadyMs: current.changedAt - basicSceneReport.mountedAt!,
        settledMs: now - current.changedAt, snapshotMs: performance.now() - start, meshes: display.children.length - lights.length })
    }
    if (!current.displayed) return
    gl.info.reset()
    const started = performance.now()
    gl.render(display, camera)
    if (ready && current.displayed === signature && !current.reported) {
      current.reported = true
      updateBasicSceneReport({ drawMs: performance.now() - started,
        firstFrameMs: performance.now() - basicSceneReport.startedAt,
        triangles: gl.info.render.triangles, programs: gl.info.programs?.length, textures: gl.info.memory.textures })
      updateBasicSceneReport({ materials: opaqueMaterialDiagnostic ? opaqueMaterials.size : 1,
        lights: lights.length,
        mapUsage: Object.fromEntries((['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const)
          .map(key => [key, [...opaqueMaterials.values()].filter(m => !!(m as MeshStandardMaterial)[key]).length])),
        transparentMaterials: [...opaqueMaterials.values()].filter(m => m.transparent || m.opacity !== 1 || m.alphaTest !== 0).length })
      const context = gl.getContext() as WebGL2RenderingContext
      if (current.fence) context.deleteSync(current.fence)
      current.fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0); context.flush()
    }
    if (current.fence) {
      const context = gl.getContext() as WebGL2RenderingContext
      const status = context.clientWaitSync(current.fence, 0, 0)
      if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) {
        context.deleteSync(current.fence); current.fence = null
        updateBasicSceneReport({ gpuCompleteMs: performance.now() - basicSceneReport.startedAt })
      }
    }
  }, 1)
  return null
}
