import { DirectionalLight, Group, HemisphereLight, Light, Material, Mesh, Object3D, PointLight, Scene, SpotLight, type BufferGeometry, type Texture } from 'three'
import { isSelectionDecoration } from './shaderWarmup.ts'
import { cloneViewportObject } from './viewportObjectClone.ts'
import { createViewportModelTransforms } from './viewportModelTransforms.ts'
import { runViewportTask } from './viewportScheduling.ts'
import { createViewportSurfaceVisibility, includeViewportObject } from './viewportSurfaceVisibility.ts'

type Disposable = { dispose: () => void }
const leases = new WeakMap<Disposable, { users: number; pending: boolean; original: () => void }>()
/** An editor unmount may request disposal before the retained display is replaced. */
export function retainResource(resource: Disposable) {
  let lease = leases.get(resource)
  if (!lease) {
    lease = { users: 0, pending: false, original: resource.dispose }
    leases.set(resource, lease)
    resource.dispose = () => { lease!.pending = true }
  }
  lease.users++
  return () => {
    if (--lease!.users) return
    resource.dispose = lease!.original; leases.delete(resource)
    if (lease!.pending) resource.dispose()
  }
}

/** Keep the prepared scene navigable while replacement resources are pending.
 * Own material copies so live shader/finish changes do not alter this version.
 * Geometry and textures are shared; their source owners retain disposal rights. */
function* retainedViewportSteps(source: Scene) {
  source.updateMatrixWorld(true)
  const scene = new Scene(), materials = new Map<Material, Material>()
  const groups = new Map<number,Group>()
  scene.userData.retainedViewport = true
  const resources = new Set<Material | BufferGeometry | Texture>(), releases: (() => void)[] = []
  const ownedMeshes: (() => void)[] = []
  const lightCopies: { source: Light; copy: Light }[] = []
  const transforms = createViewportModelTransforms(source)
  const visibility = createViewportSurfaceVisibility()
  const retain = (resource: Material | BufferGeometry | Texture) => {
    if (!resources.has(resource)) { resources.add(resource); releases.push(retainResource(resource)) }
  }
  scene.background = source.background; scene.environment = source.environment
  scene.environmentIntensity = source.environmentIntensity; scene.environmentRotation.copy(source.environmentRotation)
  scene.backgroundIntensity = source.backgroundIntensity; scene.backgroundBlurriness = source.backgroundBlurriness
  scene.backgroundRotation.copy(source.backgroundRotation); scene.fog = source.fog
  const copyMaterial = (original: Material) => {
    let copy = materials.get(original)
    if (copy) return copy
    retain(original)
    for (const value of Object.values(original)) if (value?.isTexture) retain(value as Texture)
    copy = original.clone(); copy.onBeforeCompile = original.onBeforeCompile.bind(original)
    const key = original.customProgramCacheKey(); copy.customProgramCacheKey = () => key
    if ('defaultAttributeValues' in original) Object.assign(copy, { defaultAttributeValues: original.defaultAttributeValues })
    visibility.bindMaterial(original, copy)
    materials.set(original, copy); return copy
  }
  let disposed = false, completed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    ownedMeshes.forEach(dispose => dispose())
    materials.forEach(material => material.dispose()); releases.forEach(release => release()); scene.clear()
  }
  try {
  const objects: Object3D[] = []
  source.traverse(object => { if (includeViewportObject(object)) objects.push(object) })
  for (const object of objects) {
    yield
    if (isSelectionDecoration(object)) continue
    if (!(object instanceof Light) && !('material' in object)) continue
    const copy=cloneViewportObject(object),proxy=copy.object
    visibility.bindObject(object, proxy)
    ownedMeshes.push(copy.dispose)
    proxy.matrix.copy(object.matrixWorld); proxy.matrixWorld.copy(object.matrixWorld)
    proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false
    if (proxy instanceof Mesh) transforms.bind(object, proxy)
    proxy.onBeforeRender = object.onBeforeRender; proxy.onAfterRender = object.onAfterRender
    if (proxy instanceof Mesh && object instanceof Mesh) {
      retain(object.geometry)
      proxy.material = Array.isArray(object.material) ? object.material.map(copyMaterial) : copyMaterial(object.material)
    }
    if ((proxy instanceof DirectionalLight || proxy instanceof SpotLight) &&
      (object instanceof DirectionalLight || object instanceof SpotLight)) {
      proxy.target = new Object3D(); proxy.target.position.setFromMatrixPosition(object.target.matrixWorld)
      scene.add(proxy.target)
    }
    if (proxy instanceof Light && 'shadow' in proxy && 'shadow' in object) proxy.shadow = object.shadow
    if (proxy instanceof Light && object instanceof Light) lightCopies.push({ source: object, copy: proxy })
    let ancestor=object.parent
    while(ancestor&&!(ancestor instanceof Group))ancestor=ancestor.parent
    const order=ancestor?.renderOrder??0
    if(order&&proxy instanceof Mesh){
      let group=groups.get(order)
      if(!group){group=new Group();group.renderOrder=order;groups.set(order,group);scene.add(group)}
      group.add(proxy)
    }else scene.add(proxy)
  }
  scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false
  completed = true
  return { scene, syncTransforms: transforms.sync, syncVisibility: visibility.sync,
    // Freeze geometry and program features, while keeping light uniforms live.
    // The retained display must acknowledge a switch before GI/shaders finish.
    syncLighting() {
      let changed = false
      for (const { source, copy } of lightCopies) {
        source.updateWorldMatrix(true, false)
        let visible = source.visible && !!source.parent
        for (let parent = source.parent; visible && parent; parent = parent.parent) visible = parent.visible
        const intensity = visible ? source.intensity : 0
        changed ||= copy.intensity !== intensity || !copy.color.equals(source.color) || !copy.matrixWorld.equals(source.matrixWorld)
        copy.intensity = intensity; copy.color.copy(source.color)
        copy.matrix.copy(source.matrixWorld); copy.matrixWorld.copy(source.matrixWorld)
        if (copy instanceof HemisphereLight && source instanceof HemisphereLight) {
          changed ||= !copy.groundColor.equals(source.groundColor); copy.groundColor.copy(source.groundColor)
        }
        if ((copy instanceof PointLight || copy instanceof SpotLight) && (source instanceof PointLight || source instanceof SpotLight)) {
          changed ||= copy.distance !== source.distance || copy.decay !== source.decay
          copy.distance = source.distance; copy.decay = source.decay
        }
        if (copy instanceof SpotLight && source instanceof SpotLight) {
          changed ||= copy.angle !== source.angle || copy.penumbra !== source.penumbra
          copy.angle = source.angle; copy.penumbra = source.penumbra
        }
        if ((copy instanceof DirectionalLight || copy instanceof SpotLight) && (source instanceof DirectionalLight || source instanceof SpotLight)) {
          source.target.updateWorldMatrix(true, false)
          const target = source.target.matrixWorld.elements
          changed ||= copy.target.position.x !== target[12] || copy.target.position.y !== target[13] || copy.target.position.z !== target[14]
          copy.target.position.setFromMatrixPosition(source.target.matrixWorld); copy.target.updateMatrixWorld(true)
        }
      }
      return changed
    },
    dispose }
  } finally { if (!completed) dispose() }
}

export function retainViewportScene(source: Scene) {
  const steps = retainedViewportSteps(source)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

export function prepareRetainedViewportScene(source: Scene, cancelled: () => boolean) {
  return runViewportTask(retainedViewportSteps(source), cancelled)
}
