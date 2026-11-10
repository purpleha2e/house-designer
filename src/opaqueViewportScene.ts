import { BatchedMesh, Color, DirectionalLight, HemisphereLight, DoubleSide, InstancedMesh, Light, Matrix4, Mesh, MeshStandardMaterial, PointLight, SpotLight, Scene, type Material } from 'three'
import { runViewportTask } from './viewportScheduling.ts'
import { cloneViewportObject } from './viewportObjectClone.ts'
import { retainResource } from './retainedViewportScene.ts'
import { isSelectionDecoration, recordViewportGeometryUpload } from './shaderWarmup.ts'
import { applyIndirectLightingShader, getIndirectLightingUniforms } from './indirectLightingShader.ts'
import { applyRoomLightShader, getRoomLightUniforms } from './roomLightShader.ts'
import { createViewportModelTransforms } from './viewportModelTransforms.ts'
import { createViewportSurfaceVisibility, hasViewportSurfaceVisibility, includeViewportObject } from './viewportSurfaceVisibility.ts'

/** A display-only PBR copy: shared geometry/textures and alpha glass. The lit
 * stage preserves sunlight shadows while the full effects prepare. */
type OpaqueViewportOptions = { lighting?: boolean; basic?: boolean }
function* opaqueViewportSteps(source: Scene, options: OpaqueViewportOptions = {}) {
  const sourceRoot = source
  source.updateMatrixWorld(true)
  const display = new Scene()
  display.userData.basicGeometryViewport = options.basic === true
  display.userData.projectGeneration = source.userData.projectGeneration
  let sunShadows = false
  source.traverse(object => {
    if (options.lighting && object instanceof DirectionalLight &&
      object.userData.houseDesignerRole === 'sun-light' && object.castShadow) sunShadows = true
  })
  display.userData.preparedLightingViewport = sunShadows
  display.background = source.background instanceof Color ? source.background.clone() : new Color('#233041')
  const lightCopies: { source: Light; copy: Light }[] = []
  const transforms = createViewportModelTransforms(source)
  const visibility = createViewportSurfaceVisibility()
  const opaqueMaterials = new Map<Material, MeshStandardMaterial>()
  if (options.lighting) {
    source.traverseVisible(object => {
      if (!(object instanceof Light)) return
      const copy = object.clone(false); copy.castShadow = false
      if (sunShadows && object instanceof DirectionalLight && copy instanceof DirectionalLight &&
        object.userData.houseDesignerRole === 'sun-light') {
        copy.castShadow = true
        copy.shadow = object.shadow // The display's source owns this GPU map.
      }
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
  source.traverse(object => {
    if (!(object instanceof Mesh) || !object.geometry.attributes.position?.count) return
    const blocker = sunShadows && object.userData.houseDesignerSunShadowBlocker &&
      object.parent && includeViewportObject(object.parent)
    if (!includeViewportObject(object) && !blocker) return
    if (isSelectionDecoration(object) || object.userData.houseDesignerRole === 'wall-engine-pick') return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (blocker || materials.some(m => (m.visible || hasViewportSurfaceVisibility(m)) && m.colorWrite && m.opacity > 0)) meshes.push(object)
  })
  const resources = new Set<{ dispose(): void }>(), releases: (() => void)[] = []
  const retain = (resource: { dispose(): void }) => {
    if (!resources.has(resource)) { resources.add(resource); releases.push(retainResource(resource)) }
  }
  const opaque = (source: Material) => {
    let result = opaqueMaterials.get(source)
    if (!result) {
      const m = source as MeshStandardMaterial
      // Physical transmission needs the full scene render target. Until that is
      // ready, approximate it with alpha instead of turning windows into walls.
      const transmission = 'transmission' in m ? Number(m.transmission) || 0 : 0
      const opacity = transmission > 0 ? m.opacity * (1 - Math.min(1, transmission) * .9) : m.opacity
      const transparent = m.transparent || transmission > 0
      const common = { color: m.color ?? 0xffffff, map: m.map ?? null,
        side: DoubleSide, transparent, opacity, alphaTest: m.alphaTest,
        alphaMap: m.alphaMap ?? null, depthWrite: transparent ? false : m.depthWrite,
        shadowSide: m.shadowSide,
        forceSinglePass: true,
        vertexColors: m.vertexColors, visible: m.visible && m.colorWrite && m.opacity > 0, toneMapped: false,
        polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits }
      result = new MeshStandardMaterial({ ...common,
        // The first geometry display keeps colour, glass and alpha coverage,
        // but does not wait for detailed PBR shader variants. The authored
        // material and subsequent full display are unchanged.
        roughness: options.basic ? 1 : m.roughness ?? 1, metalness: options.basic ? 0 : m.metalness ?? 0,
        roughnessMap: options.basic ? null : m.roughnessMap ?? null, metalnessMap: options.basic ? null : m.metalnessMap ?? null,
        normalMap: options.basic ? null : m.normalMap ?? null, ...(m.normalScale ? { normalScale: m.normalScale } : {}),
        ...(m.normalMapType !== undefined ? { normalMapType: m.normalMapType } : {}),
        aoMap: options.basic ? null : m.aoMap ?? null, aoMapIntensity: m.aoMapIntensity ?? 1,
        emissive: m.emissive ?? 0x000000, emissiveIntensity: m.emissiveIntensity ?? 1, emissiveMap: m.emissiveMap ?? null,
      })
      if (options.lighting) {
        const room = getRoomLightUniforms(source), indirect = getIndirectLightingUniforms(source)
        if (room) applyRoomLightShader(result, { ...room,
          pointRoomIds: room.unshadowedPointRoomIds, spotRoomIds: room.unshadowedSpotRoomIds })
        // Share lighting values while freezing this prepared display's shader
        // feature. Enabling fast GI prepares the live scene in the background.
        if (indirect) applyIndirectLightingShader(result, indirect, !!indirect.hdFastFeature.value)
      }
      for (const value of Object.values(result)) if (value?.isTexture) retain(value)
      opaqueMaterials.set(source, result)
      visibility.bindMaterial(source, result)
    }
    return result
  }
  let completed = false, disposed = false, preparedMeshes = 0
  const dispose = () => {
    if (disposed) return
    disposed = true
    opaqueMaterials.forEach(m => m.dispose())
    lightCopies.forEach(({ source, copy }) => {
      if (copy instanceof PointLight || copy instanceof SpotLight || copy instanceof DirectionalLight) {
        if (!('shadow' in source) || source.shadow !== copy.shadow) copy.dispose()
      }
    })
    releases.forEach(release => release()); display.clear()
  }
  try {
  for (const source of meshes) {
    yield
    let owner: typeof source.parent = source
    while (owner && owner !== sourceRoot) owner = owner.parent
    if (!owner) continue
    preparedMeshes++
    retain(source.geometry)
    if (sunShadows && source.userData.houseDesignerSunShadowBlocker) {
      const blocker = cloneViewportObject(source)
      for (const material of Array.isArray(source.material) ? source.material : [source.material]) retain(material)
      blocker.object.matrixAutoUpdate = false; blocker.object.matrix.copy(source.matrixWorld)
      display.add(blocker.object); releases.push(blocker.dispose)
      continue
    }
    const add = (matrix: Matrix4) => {
      const mesh = new Mesh(source.geometry, Array.isArray(source.material) ? source.material.map(opaque) : opaque(source.material))
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.frustumCulled = false
      mesh.castShadow = sunShadows && source.castShadow
      mesh.receiveShadow = sunShadows && source.receiveShadow
      mesh.renderOrder = source.renderOrder
      transforms.bind(source, mesh, matrix)
      visibility.bindObject(source, mesh)
      display.add(mesh)
    }
    if (source instanceof BatchedMesh || source instanceof InstancedMesh) {
      const copy = cloneViewportObject(source)
      copy.object.material = Array.isArray(source.material) ? source.material.map(opaque) : opaque(source.material)
      copy.object.matrixAutoUpdate = false; copy.object.matrix.copy(source.matrixWorld)
      copy.object.castShadow = sunShadows && source.castShadow
      copy.object.receiveShadow = sunShadows && source.receiveShadow
      transforms.bind(source, copy.object)
      visibility.bindObject(source, copy.object)
      display.add(copy.object); releases.push(copy.dispose)
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
  completed = true
  return { scene: display, meshes: preparedMeshes, syncLighting, syncTransforms: transforms.sync, syncVisibility: visibility.sync, dispose }
  } finally { if (!completed) dispose() }
}

export function createOpaqueViewportScene(source: Scene, options: OpaqueViewportOptions = {}) {
  const steps = opaqueViewportSteps(source, options)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

export function prepareOpaqueViewportScene(source: Scene, options: OpaqueViewportOptions, cancelled: () => boolean) {
  return runViewportTask(opaqueViewportSteps(source, options), cancelled)
}
