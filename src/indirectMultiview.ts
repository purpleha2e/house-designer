import { Color, DataArrayTexture, Frustum, HalfFloatType, LinearSRGBColorSpace, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NearestFilter, ShaderChunk, WebGLRenderTarget,
  type Camera, type CubeCamera, type Material, type Scene, type WebGLRenderer } from 'three'
import { createIndirectCaptureScene } from './indirectCaptureScene.ts'
import { createIndirectProbeIntegrator } from './indirectProbeIntegration.ts'

type MultiviewExtension = {
  MAX_VIEWS_OVR: number
  framebufferTextureMultiviewOVR(target: number, attachment: number, texture: WebGLTexture, level: number, first: number, views: number): void
}

/** Keep native cube projection/coverage, grouping three faces (or two on older
 * hardware). Camera rotations are signed permutations, preserving base-view
 * model/normal matrices and the renderer's camera-space light uniforms. */
export function indirectMultiviewShader(source: string, vertex: boolean, views: number) {
  if (!source.includes('#define HD_GI_MULTIVIEW')) return source
  return source.replace(/^(#version[^\n]*\n)/, `$1#extension GL_OVR_multiview2 : require\n${vertex ? `layout(num_views = ${views}) in;\n` : ''}`)
}

export function indirectMultiviewRotations(camera: CubeCamera, first: number, views: number, rotations: Matrix4[], faceOrder: readonly number[] = [0, 1, 2, 3, 4, 5]) {
  const base = camera.children[faceOrder[first]] as Camera
  const inverseBase = new Matrix4().extractRotation(base.matrixWorld)
  for (let view = 0; view < views; view++) {
    rotations[view].extractRotation((camera.children[faceOrder[first + view]] as Camera).matrixWorldInverse).multiply(inverseBase)
    // Cube face orientations contain roundoff from quaternion conversion. The
    // exact relative rotation is a signed axis permutation, with no translation.
    rotations[view].elements.forEach((value, index) => { rotations[view].elements[index] = Math.round(value) })
  }
}

export function createIndirectMultiview(renderer: WebGLRenderer, size: number, source: Scene, preferredViews: 2 | 3 = 3) {
  const nativeRenderer = renderer as WebGLRenderer & {
    setRenderTargetFramebuffer(target: WebGLRenderTarget, framebuffer: WebGLFramebuffer): void
  }
  if (typeof nativeRenderer.setRenderTargetFramebuffer !== 'function') return null
  const gl = renderer.getContext() as WebGL2RenderingContext
  const extension = gl.getExtension('OVR_multiview2') as MultiviewExtension | null
  if (!extension || !gl.getExtension('EXT_color_buffer_float')) return null
  const maxViews = Math.min(gl.getParameter(extension.MAX_VIEWS_OVR) as number, preferredViews)
  const views = maxViews >= 3 ? 3 : maxViews >= 2 ? 2 : 0
  if (!views) return null
  let supported = true
  source.traverse(object => {
    if ('material' in object && !(object instanceof Mesh)) supported = false
    if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial)) supported = false
      if (material.clippingPlanes?.length) supported = false
      if ((material as Material & { transmission?: number }).transmission) supported = false
    }
    if ('isRectAreaLight' in object && object.isRectAreaLight) supported = false
  })
  if (!supported || source.fog || renderer.clippingPlanes.length) return null
  const capture = createIndirectCaptureScene(source, true)
  // Adjacent views share more boundary geometry than opposite views. Preserve
  // cube orientation through an explicit layer mapping during integration.
  const faceOrder = [0, 2, 4, 1, 3, 5]
  const rotations = Array.from({ length: views }, () => new Matrix4())
  const patched = new Set<Material>()
  capture.scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    object.frustumCulled = false
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (patched.has(material)) continue
      patched.add(material)
      const compile = material.onBeforeCompile, key = material.customProgramCacheKey()
      material.customProgramCacheKey = () => key + ':hd-multiview-v1-' + views
      material.onBeforeCompile = (shader: Parameters<Material['onBeforeCompile']>[0], context: WebGLRenderer) => {
        compile.call(material, shader, context)
        shader.uniforms.hdGIViewRotations = { value: rotations }
        const common = `#define HD_GI_MULTIVIEW\nuniform mat4 hdGIViewRotations[${views}];
          #define viewMatrix (hdGIViewRotations[int(gl_ViewID_OVR)] * viewMatrix)
          #define modelViewMatrix (hdGIViewRotations[int(gl_ViewID_OVR)] * modelViewMatrix)
          #define normalMatrix (mat3(hdGIViewRotations[int(gl_ViewID_OVR)]) * normalMatrix)
          vec3 hdGIViewRotate(vec3 value) { return mat3(hdGIViewRotations[int(gl_ViewID_OVR)]) * value; }
        `
        // Common's helper arguments are also named viewMatrix. Rename those
        // locals before installing the macro for the renderer's global uniform.
        const helpers = ShaderChunk.common.replace(/\bviewMatrix\b/g, 'hdGIHelperViewMatrix')
        shader.vertexShader = common + shader.vertexShader.replace('#include <common>', helpers)
        shader.fragmentShader = common + shader.fragmentShader.replace('#include <common>', helpers)
          .replace('#include <normalmap_pars_fragment>', `#undef normalMatrix\n${ShaderChunk.normalmap_pars_fragment}\n#define normalMatrix (mat3(hdGIViewRotations[int(gl_ViewID_OVR)]) * normalMatrix)\n`)
          .replace('#include <lights_pars_begin>', ShaderChunk.lights_pars_begin
          .replace('light.direction = directionalLight.direction;', 'light.direction = hdGIViewRotate(directionalLight.direction);')
          .replace('pointLight.position - geometryPosition', 'hdGIViewRotate(pointLight.position) - geometryPosition')
          .replace('spotLight.position - geometryPosition', 'hdGIViewRotate(spotLight.position) - geometryPosition')
          .replace('dot( light.direction, spotLight.direction )', 'dot( light.direction, hdGIViewRotate(spotLight.direction) )')
          .replace('dot( normal, hemiLight.direction )', 'dot( normal, hdGIViewRotate(hemiLight.direction) )'))
      }
      material.needsUpdate = true
    }
  })
  const texture = new DataArrayTexture(new Uint16Array(size * size * 6 * 4), size, size, 6)
  texture.type = HalfFloatType; texture.minFilter = texture.magFilter = NearestFilter
  texture.colorSpace = LinearSRGBColorSpace; texture.needsUpdate = true
  const target = new WebGLRenderTarget(size, size, { depthBuffer: false, type: HalfFloatType })
  const integrator = createIndirectProbeIntegrator(size, 'array', [0, 3, 1, 4, 2, 5])
  const depth = gl.createTexture()!, framebuffer = gl.createFramebuffer()!
  const previousTarget = renderer.getRenderTarget(), previousFace = renderer.getActiveCubeFace(), previousMip = renderer.getActiveMipmapLevel()
  let disposed = false
  try {
    renderer.initTexture(texture)
    const color = (renderer.properties.get(texture) as { __webglTexture: WebGLTexture }).__webglTexture
    renderer.resetState()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, depth)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, size, size, 6)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    extension.framebufferTextureMultiviewOVR(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, color, 0, 0, views)
    extension.framebufferTextureMultiviewOVR(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, depth, 0, 0, views)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Multiview HDR framebuffer is incomplete')
    nativeRenderer.setRenderTargetFramebuffer(target, framebuffer)
  } catch (error) {
    texture.dispose(); target.dispose(); integrator.dispose(); capture.dispose()
    gl.deleteTexture(depth); gl.deleteFramebuffer(framebuffer)
    throw error
  } finally {
    renderer.resetState(); renderer.setRenderTarget(previousTarget, previousFace, previousMip)
  }
  const meshes: { mesh: Mesh; visible: boolean }[] = []
  capture.scene.traverse(object => { if (object instanceof Mesh) meshes.push({ mesh: object, visible: object.visible }) })
  const frustums = Array.from({ length: views }, () => new Frustum()), projection = new Matrix4()
  const withShaderSource = <T>(operation: () => T): T => {
    // Three prepends its GLSL prefix after onBeforeCompile. Insert the extension
    // immediately after #version in only our tagged shaders, during synchronous
    // program construction; restore the native method before yielding.
    const shaderSource = gl.shaderSource
    gl.shaderSource = (shader, source) => shaderSource.call(gl, shader,
      indirectMultiviewShader(source, source.includes('#define varying out'), views))
    try { return operation() } finally { gl.shaderSource = shaderSource }
  }
  let integrationReady = false
  let integrationPending: Promise<void> | null = null
  return {
    scene: capture.scene, texture, target, views, faceOrder,
    get ready() { return integrationReady },
    compileIntegration() {
      integrationPending ??= integrator.compile(renderer, { texture }).then(() => { integrationReady = true })
      return integrationPending
    },
    withShaders: withShaderSource,
    /** The outer bake already owns state restoration and the shared light list. */
    render(camera: CubeCamera, first: number, sky: Color) {
      indirectMultiviewRotations(camera, first, views, rotations, faceOrder)
      for (let view = 0; view < views; view++) {
        const face = camera.children[faceOrder[first + view]] as Camera
        frustums[view].setFromProjectionMatrix(projection.multiplyMatrices(face.projectionMatrix, face.matrixWorldInverse))
      }
      for (const { mesh, visible } of meshes) mesh.visible = visible && frustums.some(frustum => frustum.intersectsObject(mesh))
      const color = (renderer.properties.get(texture) as { __webglTexture: WebGLTexture }).__webglTexture
      renderer.setRenderTarget(target)
      extension.framebufferTextureMultiviewOVR(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, color, 0, first, views)
      extension.framebufferTextureMultiviewOVR(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, depth, 0, first, views)
      const clearColor = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha()
      const background = capture.scene.background
      try {
        capture.scene.background = null
        renderer.setClearColor(sky, 1); renderer.clear()
        withShaderSource(() => renderer.render(capture.scene, camera.children[faceOrder[first]] as Camera))
      } finally { capture.scene.background = background; renderer.setClearColor(clearColor, clearAlpha) }
    },
    read() { return integrator.read(renderer, { texture }) },
    dispose() {
      if (disposed) return
      disposed = true
      capture.dispose(); texture.dispose()
      // compileAsync polls the material's current program. Retain that material
      // when an edit cancels this capture while integration is still compiling.
      if (integrationPending && !integrationReady) void integrationPending.then(() => integrator.dispose(), () => integrator.dispose())
      else integrator.dispose()
      // The external framebuffer was never allocated by Three's target owner.
      renderer.properties.remove(target); target.dispose()
      gl.deleteTexture(depth); gl.deleteFramebuffer(framebuffer)
    },
  }
}
