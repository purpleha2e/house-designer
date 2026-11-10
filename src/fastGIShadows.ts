import { DoubleSide, Mesh, MeshStandardMaterial, PointLight, SpotLight, type Scene } from 'three'

/** Preview captures use bounded GPU shadow maps instead of the probe baker's
 * CPU ray atlas. These lights/materials belong to the capture scene only. */
export function configureFastGIShadows(scene: Scene) {
  const lights: (PointLight | SpotLight)[] = []
  scene.traverse(object => {
    if (object instanceof PointLight || object instanceof SpotLight) {
      object.castShadow = object.intensity > 0
      if (!object.castShadow) return
      object.shadow.mapSize.set(512, 512)
      object.shadow.camera.near = .03
      object.shadow.camera.far = Math.min(80, object.distance || 80)
      object.shadow.bias = -.0001; object.shadow.normalBias = .01
      object.shadow.needsUpdate = true
      lights.push(object)
    }
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue
      material.defines = { ...material.defines }
      delete material.defines.HD_GI_CAPTURE_VISIBILITY
      material.shadowSide = DoubleSide
      material.needsUpdate = true
    }
    object.castShadow = true; object.receiveShadow = true
  })
  return { lights, dispose: () => lights.forEach(light => light.shadow.dispose()) }
}
