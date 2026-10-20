import type { BufferAttribute, DirectionalLight, InterleavedBufferAttribute, Material, Mesh, Object3D, Texture } from 'three'

// Keep the receiver offset small enough that contact shadows remain attached
// at wall/roof junctions, while retaining enough separation to avoid acne on
// large coplanar wall and floor surfaces.
export const SUN_SHADOW_NORMAL_BIAS_METERS = 0.015

type ShadowMesh = Mesh & {
  instanceMatrix?: BufferAttribute
  count?: number
  skeleton?: { boneMatrices: Float32Array }
}

/** Compare in place instead of allocating a house-sized array every frame. */
class ShadowState {
  private values: unknown[] = []
  private index = 0
  private changed = false

  begin() { this.index = 0; this.changed = false }
  add(value: unknown) {
    if (this.index >= this.values.length || !Object.is(this.values[this.index], value)) {
      this.changed = true
      this.values[this.index] = value
    }
    this.index++
  }
  elements(values: ArrayLike<unknown>) {
    for (let i = 0; i < values.length; i++) this.add(values[i])
  }
  finish() {
    if (this.values.length !== this.index) {
      this.changed = true
      this.values.length = this.index // Release references to removed casters.
    }
    return this.changed
  }
}

function appendTexture(state: ShadowState, texture: Texture | null | undefined) {
  state.add(texture); state.add(texture?.version)
  if (texture) {
    // Texture transforms may change without a texture upload/version change.
    state.add(texture.offset.x); state.add(texture.offset.y)
    state.add(texture.repeat.x); state.add(texture.repeat.y)
    state.add(texture.center.x); state.add(texture.center.y); state.add(texture.rotation)
    state.elements(texture.matrix.elements)
  }
}

function appendMaterial(state: ShadowState, material: Material | null | undefined) {
  // React can detach a material while its replacement textures are loading.
  // Keep that transition in the signature without aborting the render loop.
  if (!material) { state.add(material); return }
  state.add(material); state.add(material.version); state.add(material.visible)
  state.add(material.side); state.add(material.shadowSide); state.add(material.alphaTest)
  state.add(material.alphaHash); state.add(material.clipShadows); state.add(material.clipIntersection)
  const depth = material as Material & {
    map?: Texture | null; alphaMap?: Texture | null; displacementMap?: Texture | null
    displacementScale?: number; displacementBias?: number; wireframe?: boolean
  }
  state.add(depth.wireframe); state.add(depth.displacementScale); state.add(depth.displacementBias)
  appendTexture(state, depth.map)
  appendTexture(state, depth.alphaMap)
  appendTexture(state, depth.displacementMap)
  if (material.clippingPlanes) for (const plane of material.clippingPlanes) {
    state.add(plane.normal.x); state.add(plane.normal.y); state.add(plane.normal.z); state.add(plane.constant)
  }
}

/** Compare the actual shadow scene after transforms and instance batches update. */
export class SunShadowCache {
  private previous = new WeakMap<DirectionalLight, ShadowState>()

  update(light: DirectionalLight, scene: Object3D, cameraLayers: number, shadowMapType: number) {
    const shadow = light.shadow, camera = shadow.camera
    let state = this.previous.get(light)
    if (!state) { state = new ShadowState(); this.previous.set(light, state) }
    state.begin()
    state.add(scene); state.add(cameraLayers); state.add(shadowMapType)
    state.elements(light.matrixWorld.elements); state.elements(light.target.matrixWorld.elements)
    state.add(shadow.mapSize.x); state.add(shadow.mapSize.y)
    state.add(shadow.bias); state.add(shadow.normalBias); state.add(shadow.radius)
    state.add(camera.left); state.add(camera.right); state.add(camera.top); state.add(camera.bottom)
    state.add(camera.near); state.add(camera.far); state.add(camera.zoom)
    scene.traverseVisible(object => {
      const mesh = object as ShadowMesh
      if (!mesh.isMesh || !mesh.castShadow) return
      state.add(mesh); state.add(mesh.geometry); state.add(mesh.layers.mask); state.add(mesh.frustumCulled)
      state.elements(mesh.matrixWorld.elements)
      const geometry = mesh.geometry
      state.add(geometry.drawRange.start); state.add(geometry.drawRange.count)
      state.add(geometry.index); state.add(geometry.index?.version)
      for (const name in geometry.attributes) {
        if (!Object.hasOwn(geometry.attributes, name)) continue
        const buffer = geometry.attributes[name] as BufferAttribute | InterleavedBufferAttribute
        state.add(name); state.add(buffer); state.add('data' in buffer ? buffer.data.version : buffer.version)
      }
      for (const group of geometry.groups) { state.add(group.start); state.add(group.count); state.add(group.materialIndex) }
      if (Array.isArray(mesh.material)) for (const material of mesh.material) appendMaterial(state, material)
      else appendMaterial(state, mesh.material)
      state.add(mesh.customDepthMaterial)
      if (mesh.customDepthMaterial) appendMaterial(state, mesh.customDepthMaterial)
      state.add(mesh.instanceMatrix); state.add(mesh.instanceMatrix?.version); state.add(mesh.count)
      if (mesh.morphTargetInfluences) state.elements(mesh.morphTargetInfluences)
      if (mesh.skeleton) state.elements(mesh.skeleton.boneMatrices)
    })
    const stateChanged = state.finish()
    const changed = !shadow.map || stateChanged
    if (changed) shadow.needsUpdate = true
    return changed
  }
}
