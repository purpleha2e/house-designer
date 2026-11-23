import { DoubleSide, Mesh, MeshStandardMaterial, PointLight, SpotLight, type Scene } from 'three'

/** Keep the capture variant stable for the renderer's lifetime, with room for
 * authored maps, the physical BRDF lookup, sun shadow and material extensions.
 * WebGL2's minimum sixteen samplers supports two point and two spot shadows. */
export function fastGICaptureShadowSlots(maxTextures: number, requested = 4) {
  const limit = Math.max(1, Math.min(4, Math.floor(requested) || 4))
  return Math.max(1, Math.min(limit, Math.floor((maxTextures - 12) / 2)))
}

/** Preview captures use bounded GPU shadow maps instead of the probe baker's
 * CPU ray atlas. These lights/materials belong to the capture scene only. */
export function configureFastGIShadows(scene: Scene, stableLayout = false) {
  const lights: (PointLight | SpotLight)[] = []
  scene.traverse(object => {
    if (object instanceof PointLight || object instanceof SpotLight) {
      object.castShadow = stableLayout || object.intensity > 0
      if (!object.castShadow) return
      object.shadow.mapSize.set(512, 512)
      object.shadow.camera.near = .03
      object.shadow.camera.far = Math.min(80, object.distance || 80)
      object.shadow.bias = -.0001; object.shadow.normalBias = .01
      // Disabled slots still count towards the shader layout but do not render
      // or allocate shadow maps until they contain a contributing lamp.
      object.shadow.autoUpdate = !stableLayout || object.intensity > 0
      object.shadow.needsUpdate = !stableLayout || object.intensity > 0
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
