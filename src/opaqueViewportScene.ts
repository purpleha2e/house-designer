import { BatchedMesh, Color, DirectionalLight, HemisphereLight, DoubleSide, InstancedMesh, Light, Matrix4, Mesh, MeshStandardMaterial, PointLight, SpotLight, Scene, type Material } from 'three'
import { cloneViewportObject } from './viewportObjectClone.ts'
import { retainResource } from './retainedViewportScene.ts'
import { isSelectionDecoration, recordViewportGeometryUpload } from './shaderWarmup.ts'
import { applyIndirectLightingShader, getIndirectLightingUniforms } from './indirectLightingShader.ts'
import { applyRoomLightShader, getRoomLightUniforms } from './roomLightShader.ts'

/** A display-only PBR copy: shared geometry/textures, no custom lighting hooks,
 * shadows, transparency or postprocessing. Source objects remain the pick targets. */
export function createOpaqueViewportScene(source: Scene, options: { lighting?: boolean } = {}) {
  source.updateMatrixWorld(true)
  const display = new Scene()
  display.background = source.background instanceof Color ? source.background.clone() : new Color('#233041')
  const lightCopies: { source: Light; copy: Light }[] = []
  if (options.lighting) {
    source.traverseVisible(object => {
      if (!(object instanceof Light)) return
      const copy = object.clone(false); copy.castShadow = false
      if (copy instanceof DirectionalLight || copy instanceof SpotLight) display.add(copy.target)
      display.add(copy); lightCopies.push({ source: object, copy })
    })
  } else {
    const key = new DirectionalLight(0xffffff, 3)
    key.position.set(4, 8, 5)
    display.add(key, new HemisphereLight(0xffffff, 0x888888, 1))
  }
  const syncLighting = () => {
    for (const { source, copy } of lightCopies) {
      source.updateWorldMatrix(true, false)
      copy.position.setFromMatrixPosition(source.matrixWorld)
      copy.color.copy(source.color); copy.intensity = source.intensity
      if (copy instanceof HemisphereLight && source instanceof HemisphereLight) copy.groundColor.copy(source.groundColor)
      if ((copy instanceof PointLight || copy instanceof SpotLight) && (source instanceof PointLight || source instanceof SpotLight)) {
        copy.distance = source.distance; copy.decay = source.decay
      }
      if (copy instanceof SpotLight && source instanceof SpotLight) { copy.angle = source.angle; copy.penumbra = source.penumbra }
      if ((copy instanceof DirectionalLight || copy instanceof SpotLight) && (source instanceof DirectionalLight || source instanceof SpotLight)) {
        source.target.updateWorldMatrix(true, false)
        copy.target.position.setFromMatrixPosition(source.target.matrixWorld)
      }
    }
  }
  syncLighting()
  const meshes: Mesh[] = []
  source.traverseVisible(object => {
    if (!(object instanceof Mesh) || !object.geometry.attributes.position?.count) return
    if (isSelectionDecoration(object) || object.userData.houseDesignerRole === 'wall-engine-pick') return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (materials.some(m => m.visible && m.colorWrite && m.opacity > 0)) meshes.push(object)
  })
  const opaqueMaterials = new Map<Material, MeshStandardMaterial>()
  const resources = new Set<{ dispose(): void }>(), releases: (() => void)[] = []
  const retain = (resource: { dispose(): void }) => {
    if (!resources.has(resource)) { resources.add(resource); releases.push(retainResource(resource)) }
  }
  const opaque = (source: Material) => {
    let result = opaqueMaterials.get(source)
    if (!result) {
      const m = source as MeshStandardMaterial
      const common = { color: m.color ?? 0xffffff, map: m.map ?? null,
        side: DoubleSide, transparent: false, opacity: 1, alphaTest: 0, depthWrite: true,
        vertexColors: m.vertexColors, visible: m.visible && m.colorWrite && m.opacity > 0, toneMapped: false,
        polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits }
      result = new MeshStandardMaterial({ ...common,
        roughness: m.roughness ?? 1, metalness: m.metalness ?? 0,
        roughnessMap: m.roughnessMap ?? null, metalnessMap: m.metalnessMap ?? null,
        normalMap: m.normalMap ?? null, ...(m.normalScale ? { normalScale: m.normalScale } : {}),
        ...(m.normalMapType !== undefined ? { normalMapType: m.normalMapType } : {}),
        aoMap: m.aoMap ?? null, aoMapIntensity: m.aoMapIntensity ?? 1,
        emissive: m.emissive ?? 0x000000, emissiveIntensity: m.emissiveIntensity ?? 1, emissiveMap: m.emissiveMap ?? null,
      })
      if (options.lighting) {
        const room = getRoomLightUniforms(source), indirect = getIndirectLightingUniforms(source)
        if (room) applyRoomLightShader(result, { ...room,
          pointRoomIds: room.unshadowedPointRoomIds, spotRoomIds: room.unshadowedSpotRoomIds })
        if (indirect) applyIndirectLightingShader(result, indirect)
      }
      for (const value of Object.values(result)) if (value?.isTexture) retain(value)
      opaqueMaterials.set(source, result)
    }
    return result
  }
  for (const source of meshes) {
    retain(source.geometry)
    const add = (matrix: Matrix4) => {
      const mesh = new Mesh(source.geometry, Array.isArray(source.material) ? source.material.map(opaque) : opaque(source.material))
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.frustumCulled = false
      mesh.renderOrder = source.renderOrder
      display.add(mesh)
    }
    if (source instanceof BatchedMesh) {
      const copy = cloneViewportObject(source)
      copy.object.material = opaque(source.material)
      copy.object.matrixAutoUpdate = false; copy.object.matrix.copy(source.matrixWorld)
      copy.object.castShadow = copy.object.receiveShadow = false
      display.add(copy.object); releases.push(copy.dispose)
    } else if (source instanceof InstancedMesh) {
      const matrix = new Matrix4()
      for (let i = 0; i < source.count; i++) { source.getMatrixAt(i, matrix); add(matrix.premultiply(source.matrixWorld)) }
    } else add(source.matrixWorld)
  }

  display.updateMatrixWorld(true)
  // Only meshes that actually reach a display draw can certify an upload.
  // Hidden groups/materials must still be prepared if they become visible later.
  display.traverse(object => {
    if (!(object instanceof Mesh)) return
    const afterRender = object.onAfterRender
    object.onAfterRender = function(renderer, scene, camera, geometry, material, group) {
      afterRender.call(this, renderer, scene, camera, geometry, material, group)
      recordViewportGeometryUpload(renderer, geometry)
      this.onAfterRender = afterRender
    }
  })
  let disposed = false
  return { scene: display, meshes: meshes.length, syncLighting, dispose() {
    if (disposed) return
    disposed = true
    opaqueMaterials.forEach(m => m.dispose())
    lightCopies.forEach(({ copy }) => { if (copy instanceof PointLight || copy instanceof SpotLight || copy instanceof DirectionalLight) copy.dispose() })
    releases.forEach(release => release()); display.clear()
  } }
}
