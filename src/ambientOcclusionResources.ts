import { BufferAttribute, BufferGeometry, Material, Mesh, OrthographicCamera, Scene, WebGLRenderTarget, type WebGLRenderer } from 'three'
import type { EffectComposer } from 'postprocessing'
import { waitForViewportIdle } from './viewportScheduling.ts'

export type AmbientOcclusionPass = {
  renderTransparency: (renderer: WebGLRenderer) => void
  dispose: () => void
  scene?: Scene
  firstFrame?: () => void
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
  // N8AO owns `scene` but inherits an empty mainScene setter from Pass. Make
  // composer scene replacement also reach AO's geometry/transparency draws.
  if (pass.scene) Object.defineProperty(pass, 'mainScene', { configurable: true,
    set(scene: Scene) { pass.scene = scene; pass.firstFrame?.() },
  })
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

/** Fullscreen effects are separate scenes; compiling building materials does
 * not prepare them. Submit their shaders before the first compositor draw. */
export async function preparePostprocessingShaders(renderer: WebGLRenderer, composer: EffectComposer, cancelled: () => boolean) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0,0,2,0,0,2]), 2))
  const camera = new OrthographicCamera(), scene = new Scene(), target = new WebGLRenderTarget(1,1)
  const seen = new Set<Material>()
  try {
    for (const pass of composer.passes) {
      const resources = [pass.fullscreenMaterial, ...Object.values(pass)]
      for (const resource of resources) {
        const wrapper = resource as { material?: Material; _mesh?: Mesh } | undefined
        const material = resource instanceof Material ? resource : wrapper?.material
        if (!(material instanceof Material) || seen.has(material)) continue
        seen.add(material)
        if (!await waitForViewportIdle(cancelled)) return false
        const proxy = new Mesh(wrapper?._mesh?.geometry ?? geometry, material)
        const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
        let pending: Promise<unknown>
        try {
          renderer.setRenderTarget(pass.renderToScreen ? null : target)
          pending = renderer.compileAsync(proxy, camera, scene)
        } finally { renderer.setRenderTarget(previous, face, mip) }
        await pending
      }
    }
    return !cancelled()
  } finally { geometry.dispose(); target.dispose() }
}
