import type { BufferAttribute, DirectionalLight, InterleavedBufferAttribute, Material, Mesh, Object3D, Texture } from 'three'

type ShadowMesh = Mesh & {
  instanceMatrix?: BufferAttribute
  count?: number
  skeleton?: { boneMatrices: Float32Array }
}

function appendTexture(state: unknown[], texture: Texture | null | undefined) {
  state.push(texture, texture?.version)
  if (texture) {
    // Texture transforms may change without a texture upload/version change.
    state.push(texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y,
      texture.center.x, texture.center.y, texture.rotation, ...texture.matrix.elements)
  }
}

function appendMaterial(state: unknown[], material: Material | null | undefined) {
  // React can detach a material while its replacement textures are loading.
  // Keep that transition in the signature without aborting the render loop.
  if (!material) { state.push(material); return }
  state.push(material, material.version, material.visible, material.side, material.shadowSide,
    material.alphaTest, material.alphaHash, material.clipShadows, material.clipIntersection)
  const depth = material as Material & {
    map?: Texture | null; alphaMap?: Texture | null; displacementMap?: Texture | null
    displacementScale?: number; displacementBias?: number; wireframe?: boolean
  }
  state.push(depth.wireframe, depth.displacementScale, depth.displacementBias)
  appendTexture(state, depth.map)
  appendTexture(state, depth.alphaMap)
  appendTexture(state, depth.displacementMap)
  for (const plane of material.clippingPlanes ?? []) {
    state.push(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
  }
}

/** Compare the actual shadow scene after transforms and instance batches update. */
export class SunShadowCache {
  private previous = new WeakMap<DirectionalLight, unknown[]>()

  update(light: DirectionalLight, scene: Object3D, cameraLayers: number, shadowMapType: number) {
    const shadow = light.shadow, camera = shadow.camera
    const state: unknown[] = [scene, cameraLayers, shadowMapType,
      ...light.matrixWorld.elements, ...light.target.matrixWorld.elements,
      shadow.mapSize.x, shadow.mapSize.y, shadow.bias, shadow.normalBias, shadow.radius,
      camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far, camera.zoom]
    scene.traverseVisible(object => {
      const mesh = object as ShadowMesh
      if (!mesh.isMesh || !mesh.castShadow) return
      state.push(mesh, mesh.geometry, mesh.layers.mask, mesh.frustumCulled, ...mesh.matrixWorld.elements)
      const geometry = mesh.geometry
      state.push(geometry.drawRange.start, geometry.drawRange.count, geometry.index, geometry.index?.version)
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const buffer = attribute as BufferAttribute | InterleavedBufferAttribute
        state.push(name, buffer, 'data' in buffer ? buffer.data.version : buffer.version)
      }
      for (const group of geometry.groups) state.push(group.start, group.count, group.materialIndex)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) appendMaterial(state, material)
      state.push(mesh.customDepthMaterial)
      if (mesh.customDepthMaterial) appendMaterial(state, mesh.customDepthMaterial)
      state.push(mesh.instanceMatrix, mesh.instanceMatrix?.version, mesh.count)
      if (mesh.morphTargetInfluences) state.push(...mesh.morphTargetInfluences)
      if (mesh.skeleton) state.push(...mesh.skeleton.boneMatrices)
    })
    const previous = this.previous.get(light)
    const changed = !shadow.map || !previous || state.length !== previous.length ||
      state.some((value, index) => !Object.is(value, previous[index]))
    if (changed) shadow.needsUpdate = true
    this.previous.set(light, state)
    return changed
  }
}
