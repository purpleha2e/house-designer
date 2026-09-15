import type { Material, WebGLRenderer } from 'three'

export type AmbientOcclusionPass = {
  renderTransparency: (renderer: WebGLRenderer) => void
  dispose: () => void
}

const configured = new WeakSet<AmbientOcclusionPass>()

/** N8AO's transparency-only renders must use the complete scene's shadows. */
export function configureAmbientOcclusionPass(pass: AmbientOcclusionPass | null) {
  if (!pass) return
  // The upstream effect cleanup tracks disposed instances in a WeakSet. React's
  // development remount can reuse one and allocate fresh GPU resources, so its
  // eventual removal still needs an explicit cleanup from the primitive ref.
  if (configured.has(pass)) return () => pass.dispose()
  configured.add(pass)
  const renderTransparency = pass.renderTransparency
  pass.renderTransparency = function(renderer) {
    const { shadowMap } = renderer
    const { autoUpdate, needsUpdate } = shadowMap
    shadowMap.autoUpdate = false
    shadowMap.needsUpdate = false
    try {
      renderTransparency.call(this, renderer)
    } finally {
      shadowMap.autoUpdate = autoUpdate
      shadowMap.needsUpdate = needsUpdate
    }
  }

  // Pass.dispose handles targets/textures and direct material properties, but
  // misses N8AO's FullScreenTriangle wrappers. Dispose their materials too.
  // Their geometry is shared by all N8AO passes and must remain alive.
  const dispose = pass.dispose
  pass.dispose = function() {
    const directResources = new Set<unknown>(Object.values(this))
    const materials = new Set<Material>()
    for (const resource of directResources) {
      if (!resource || typeof resource !== 'object' || !('material' in resource)) continue
      const material = resource.material as Material | undefined
      if (material?.isMaterial && !directResources.has(material)) materials.add(material)
    }
    for (const material of materials) material.dispose()
    dispose.call(this)
  }
  return () => pass.dispose()
}
