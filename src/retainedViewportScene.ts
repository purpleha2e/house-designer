import { DirectionalLight, Group, Light, Material, Mesh, Object3D, Scene, SpotLight, type BufferGeometry, type Texture } from 'three'
import { isSelectionDecoration } from './shaderWarmup.ts'
import { cloneViewportObject } from './viewportObjectClone.ts'

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
export function retainViewportScene(source: Scene) {
  source.updateMatrixWorld(true)
  const scene = new Scene(), materials = new Map<Material, Material>()
  const groups = new Map<number,Group>()
  scene.userData.retainedViewport = true
  const resources = new Set<Material | BufferGeometry | Texture>(), releases: (() => void)[] = []
  const ownedMeshes: (() => void)[] = []
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
    materials.set(original, copy); return copy
  }
  source.traverseVisible(object => {
    if (isSelectionDecoration(object)) return
    if (!(object instanceof Light) && !('material' in object)) return
    const copy=cloneViewportObject(object),proxy=copy.object
    ownedMeshes.push(copy.dispose)
    proxy.matrix.copy(object.matrixWorld); proxy.matrixWorld.copy(object.matrixWorld)
    proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false
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
    let ancestor=object.parent
    while(ancestor&&!(ancestor instanceof Group))ancestor=ancestor.parent
    const order=ancestor?.renderOrder??0
    if(order&&proxy instanceof Mesh){
      let group=groups.get(order)
      if(!group){group=new Group();group.renderOrder=order;groups.set(order,group);scene.add(group)}
      group.add(proxy)
    }else scene.add(proxy)
  })
  scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false
  let disposed = false
  return { scene, dispose() {
    if (disposed) return
    disposed = true
    ownedMeshes.forEach(dispose => dispose())
    materials.forEach(material => material.dispose()); releases.forEach(release => release()); scene.clear()
  } }
}
