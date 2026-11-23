import type { BufferGeometry, ShaderMaterial, Texture, Vector2, WebGLRenderTarget } from 'three'
import type { WebGLPathTracer } from 'three-gpu-pathtracer'

export type PreparedIntegrator = {
  material: ShaderMaterial
  samples: number
  isCompiling: boolean
  target: WebGLRenderTarget
  tiles: Vector2
  setSize(width: number, height: number): void
  reset(): void
  update(): void
  dispose(): void
  _blendQuad: { material: ShaderMaterial }
}

type PreparedTracer = {
  _pathTracer: PreparedIntegrator
  _lowResPathTracer: PreparedIntegrator
  _generator: { geometry: BufferGeometry }
  _internalBackground: Texture | null
}

/** Adapter for the pinned three-gpu-pathtracer 0.0.24 surface integrator. */
export function preparedIntegrator(tracer: WebGLPathTracer): PreparedIntegrator {
  const integrator = (tracer as unknown as PreparedTracer)._pathTracer
  if (!integrator?.material || typeof integrator.setSize !== 'function') {
    throw Error('Unsupported reference renderer version')
  }
  return integrator
}

/** The pinned wrapper disposes its targets but leaves the packed scene textures
 * and materials allocated. Our lab shares a renderer across preparations, so
 * explicitly release only these owned resources, never the receiver textures. */
export function disposePreparedTracer(tracer: WebGLPathTracer) {
  const adapter = tracer as unknown as PreparedTracer
  const integrators = [adapter._pathTracer, adapter._lowResPathTracer]
  tracer.dispose()
  adapter._lowResPathTracer.dispose()
  const materials = new Set(integrators.map(integrator => integrator.material))
  for (const material of materials) {
    for (const name of ['bvh', 'attributesArray', 'materialIndexAttribute', 'materials',
      'textures', 'iesProfiles', 'envMapInfo', 'stratifiedTexture', 'stratifiedOffsetTexture']) {
      const resource = material.uniforms[name]?.value as {
        dispose(): void
        renderTarget?: WebGLRenderTarget & { fsQuad?: { material: ShaderMaterial } }
      } | undefined
      if (resource?.renderTarget) {
        resource.renderTarget.fsQuad?.material.dispose()
        resource.renderTarget.dispose()
      } else resource?.dispose()
    }
    material.uniforms.lights?.value.tex.dispose()
    material.dispose()
  }
  integrators.forEach(integrator => integrator._blendQuad.material.dispose())
  adapter._generator.geometry.dispose()
  adapter._internalBackground?.dispose()
}
