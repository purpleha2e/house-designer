import { Color, FloatType, NearestFilter, WebGLRenderTarget, type Mesh, type MeshStandardMaterial, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

/** Clean first-hit guides, using the same UVs, alpha tests and normal maps as
 * the source materials. No cached illumination or display tone mapping. */
export async function captureDenoiseGuides(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, width: number, height: number) {
  const target = new WebGLRenderTarget(width, height, { count: 2, type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter })
  const originals = new Map<Mesh, Mesh['material']>(), copies = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const background = scene.background, environment = scene.environment, oldTarget = renderer.getRenderTarget()
  const clearColour = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear
  const copy = (source: MeshStandardMaterial) => {
    let material = copies.get(source)
    if (material) return material
    material = source.clone(); material.envMap = null; material.transparent = false; material.depthWrite = true
    // Clear panes must not replace exterior detail with a flat glass guide.
    if ('transmission' in material && Number(material.transmission) > 0) material.visible = false
    material.onBeforeCompile = shader => {
      shader.fragmentShader = 'layout(location=1) out vec4 guideNormal;\n' + shader.fragmentShader
      const marker = '#include <opaque_fragment>'
      if (!shader.fragmentShader.includes(marker)) throw Error('Unsupported material shader for denoising guides')
      shader.fragmentShader = shader.fragmentShader.replace(marker, `
        gl_FragColor = vec4(clamp(diffuseColor.rgb, 0.0, 1.0), 1.0);
        guideNormal = vec4(normalize(normal) * 0.5 + 0.5, 1.0);
      `)
      for (const chunk of ['tonemapping_fragment', 'colorspace_fragment', 'fog_fragment', 'premultiplied_alpha_fragment', 'dithering_fragment']) {
        shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, '')
      }
    }
    material.customProgramCacheKey = () => 'oidn-clean-guides-v1'
    copies.set(source, material)
    return material
  }
  try {
    scene.background = null; scene.environment = null
    scene.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      originals.set(mesh, mesh.material)
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => copy(m as MeshStandardMaterial)) : copy(mesh.material as MeshStandardMaterial)
    })
    renderer.setClearColor(0, 0); renderer.autoClear = true; renderer.setRenderTarget(target)
    await renderer.compileAsync(scene, camera)
    renderer.render(scene, camera)
    const albedo = new Float32Array(width * height * 4), normal = new Float32Array(albedo.length)
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, albedo, undefined, 0)
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, normal, undefined, 1)
    for (let i = 0; i < albedo.length; i += 4) {
      if (albedo[i + 3] === 0) normal.set([.5, .5, .5, 1], i)
      albedo[i + 3] = normal[i + 3] = 1
    }
    return { albedo, normal }
  } finally {
    originals.forEach((material, mesh) => mesh.material = material)
    copies.forEach(material => material.dispose()); target.dispose()
    scene.background = background; scene.environment = environment
    renderer.setRenderTarget(oldTarget); renderer.setClearColor(clearColour, clearAlpha); renderer.autoClear = autoClear
  }
}
