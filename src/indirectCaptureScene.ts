import { BufferGeometry, DirectionalLight, Group, InstancedMesh, Light, Material, Mesh, MeshStandardMaterial,
  Object3D, ObjectSpaceNormalMap, PointLight, Scene, SpotLight, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { isSelectionDecoration } from './shaderWarmup.ts'
import { applyIndirectSurfaceCapture, applyIndirectSurfaceRadianceCapture } from './indirectSurfaceCache.ts'
import { runViewportTask } from './viewportScheduling.ts'

type Renderable = Object3D & { material: Material | Material[]; geometry: BufferGeometry }

/** A retained offscreen scene. Live geometry/textures and sun shadow maps remain
 * owned by the editor; only capture materials and merged buffers are owned here. */
function* captureSceneSteps(source: Scene, localLights: boolean) {
  source.updateMatrixWorld(true)
  const scene = new Scene(), materials = new Map<Material, Material>()
  const geometries = new Set<BufferGeometry>(), instances: InstancedMesh[] = []
  const batches = new Map<string, Mesh[]>()
  const orderedGroups = new Map<number, Group>()
  const centre = new Vector3()
  let sourceMeshes = 0, mergedMeshes = 0
  let disposed = false, completed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    materials.forEach(material => material.dispose())
    geometries.forEach(geometry => geometry.dispose())
    instances.forEach(mesh => mesh.dispose())
    scene.clear()
  }
  try {
  const captureMaterial = (original: Material) => {
    let material = materials.get(original)
    if (material) return material
    material = original.clone()
    if (material instanceof MeshStandardMaterial) {
      material.defines = { ...(original as MeshStandardMaterial).defines, HD_GI_CAPTURE_VISIBILITY: 1 }
    }
    material.onBeforeCompile = original.onBeforeCompile.bind(original)
    const attributes = original as Material & { defaultAttributeValues?: Record<string, number[]> }
    if (attributes.defaultAttributeValues) Object.assign(material, { defaultAttributeValues: attributes.defaultAttributeValues })
    const key = original.customProgramCacheKey()
    material.customProgramCacheKey = () => key
    // Navigation fades and glass are handled once, rather than per capture.
    if (original.transparent) {
      if (!(original instanceof MeshStandardMaterial) || /glass|glazing/i.test(original.name)) material.visible = false
      else { material.transparent = false; material.opacity = 1; material.depthWrite = true }
    }
    materials.set(original, material)
    return material
  }
  const addProxy = (object: Renderable) => {
    const proxy = object.clone(false) as Renderable
    proxy.matrix.copy(object.matrixWorld); proxy.matrixWorld.copy(object.matrixWorld)
    proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false
    proxy.onBeforeRender = object.onBeforeRender; proxy.onAfterRender = object.onAfterRender
    proxy.material = Array.isArray(object.material) ? object.material.map(captureMaterial) : captureMaterial(object.material)
    // Group order has priority over mesh order in Three's render sorting.
    // Retain that ordering without retaining the editor's nested transforms.
    let ancestor = object.parent
    while (ancestor && !(ancestor instanceof Group)) ancestor = ancestor.parent
    const order = ancestor?.renderOrder ?? 0
    if (order) {
      let group = orderedGroups.get(order)
      if (!group) {
        group = new Group(); group.renderOrder = order
        group.matrixAutoUpdate = false; group.matrixWorldAutoUpdate = false
        orderedGroups.set(order, group); scene.add(group)
      }
      group.add(proxy)
    } else scene.add(proxy)
    if (proxy instanceof InstancedMesh) instances.push(proxy)
    return proxy
  }
  const objects: Object3D[] = []
  source.traverseVisible(object => objects.push(object))
  for (const object of objects) {
    yield
    if (isSelectionDecoration(object) || object.userData.houseDesignerRole === 'ground-image') continue
    if (object instanceof Light) {
      if (localLights && (object instanceof PointLight || object instanceof SpotLight)) continue
      const light = object.clone(false)
      object.matrixWorld.decompose(light.position, light.quaternion, light.scale)
      if (light instanceof DirectionalLight || light instanceof SpotLight) {
        const original = object as DirectionalLight | SpotLight
        light.target = new Object3D(); light.target.position.setFromMatrixPosition(original.target.matrixWorld)
        // The capture renderer never renders shadow maps; reuse the display's sun map.
        light.shadow = original.shadow
        scene.add(light.target)
      }
      scene.add(light); continue
    }
    const renderable = object as Renderable
    if (!renderable.geometry || !renderable.material) continue
    const proxy = addProxy(renderable)
    if (!(object instanceof Mesh)) continue
    sourceMeshes++
    const geometry: BufferGeometry = object.geometry
    // Preserve group/draw-range semantics, skinning, morphs, instances, mirrored
    // winding and object callbacks through ordinary proxies.
    if (object.type !== 'Mesh' || 'isInstancedMesh' in object || 'isBatchedMesh' in object ||
      'isInstancedBufferGeometry' in geometry || Array.isArray(object.material) || !proxy.material.visible ||
      proxy.material.transparent || geometry.morphAttributes.position?.length ||
      (object.material instanceof MeshStandardMaterial &&
        (object.material.displacementMap || object.material.normalMapType === ObjectSpaceNormalMap)) ||
      Object.values(geometry.morphAttributes).some(attributes => attributes.length) ||
      geometry.drawRange.start !== 0 || Number.isFinite(geometry.drawRange.count) ||
      object.matrixWorld.determinant() <= 0 || object.onBeforeRender !== Object3D.prototype.onBeforeRender ||
      object.onAfterRender !== Object3D.prototype.onAfterRender) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    geometry.boundingBox?.getCenter(centre).applyMatrix4(object.matrixWorld)
    const attributes = Object.entries(geometry.attributes).map(([name, attribute]) =>
      [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name]).sort()
    const key = JSON.stringify([object.material.uuid, object.receiveShadow, object.layers.mask, object.renderOrder, proxy.parent?.renderOrder,
      object.frustumCulled, !!geometry.index, attributes,
      object.matrixWorld.elements,
      Math.floor(centre.x / 8), Math.floor(centre.y / 4), Math.floor(centre.z / 8)])
    const group = batches.get(key) ?? []; group.push(proxy as Mesh); batches.set(key, group)
  }
  for (const members of batches.values()) {
    yield
    if (members.length < 2) continue
    // Keep vertex/normal/receiver data in the original local coordinates.
    // Baking transforms into float vertices can change coverage at openings.
    const geometry = mergeGeometries(members.map(mesh => mesh.geometry), false)
    if (!geometry) continue
    geometries.add(geometry)
    const first = members[0], merged = new Mesh(geometry, first.material)
    merged.receiveShadow = first.receiveShadow; merged.layers.mask = first.layers.mask
    merged.renderOrder = first.renderOrder; merged.frustumCulled = first.frustumCulled
    merged.matrix.copy(first.matrix); merged.matrixWorld.copy(first.matrixWorld)
    merged.matrixAutoUpdate = false; merged.matrixWorldAutoUpdate = false
    geometry.computeBoundingSphere()
    const parent = first.parent!
    members.forEach(mesh => mesh.removeFromParent()); parent.add(merged)
    mergedMeshes += members.length - 1
  }
  scene.environment = source.environment
  scene.environmentIntensity = source.environmentIntensity
  scene.environmentRotation.copy(source.environmentRotation)
  scene.fog = source.fog
  scene.updateMatrixWorld(true)
  scene.matrixWorldAutoUpdate = false
  completed = true
  return { scene, sourceMeshes, mergedMeshes, materials: materials.size,
    enableSurfaceRadianceCapture() {
      materials.forEach(material => applyIndirectSurfaceRadianceCapture(material))
    },
    enableSurfaceCapture() {
      materials.forEach(material => applyIndirectSurfaceCapture(material))
      // This pass records material data only, with no lighting variants.
      scene.children.filter(object => object instanceof Light).forEach(light => light.removeFromParent())
      scene.environment = null
    },
    dispose,
  }
  } finally { if (!completed) dispose() }
}

export function createIndirectCaptureScene(source: Scene, localLights: boolean) {
  const steps = captureSceneSteps(source, localLights)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** Build capture proxies in small tasks rather than blocking navigation while
 * cloning every model and merging every material batch. */
export function prepareIndirectCaptureScene(source: Scene, localLights: boolean, cancelled: () => boolean = () => false) {
  return runViewportTask(captureSceneSteps(source, localLights),cancelled)
}
