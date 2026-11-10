import { HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three'

/** Keep raw diagnostics in the prepared linear-target PBR shader family.
 * Direct canvas rendering would synchronously compile new output variants. */
export function createLightingDiagnosticDisplay(renderer: WebGLRenderer, source: Scene, view: Camera) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true })
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1), geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { diagnostic: { value: target.texture } },
    vertexShader: 'varying vec2 diagnosticUV;void main(){diagnosticUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 diagnosticUV;uniform sampler2D diagnostic;
      void main(){vec4 value=texture2D(diagnostic,diagnosticUV);vec3 c=max(value.rgb,vec3(0.0));
        gl_FragColor=vec4(mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-.055,step(vec3(.0031308),c)),value.a);}`,
  })
  scene.add(new Mesh(geometry, material))
  let ready = false, disposed = false
  const previous = renderer.getRenderTarget()
  let sourcePreparation: Promise<unknown>
  try { renderer.setRenderTarget(target); sourcePreparation = renderer.compileAsync(source, view) }
  finally { renderer.setRenderTarget(previous) }
  const preparation = sourcePreparation.then(() => renderer.compileAsync(scene, camera)).then(() => { if (!disposed) ready = true })
  return {
    preparation,
    get ready() { return ready },
    render(source: Scene, view: Camera) {
      if (!ready) return false
      const width = renderer.domElement.width, height = renderer.domElement.height
      if (target.width !== width || target.height !== height) target.setSize(width, height)
      const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear
      try {
        renderer.autoClear = true; renderer.setRenderTarget(target); renderer.render(source, view)
        renderer.setRenderTarget(previous); renderer.render(scene, camera)
      } finally { renderer.setRenderTarget(previous); renderer.autoClear = autoClear }
      return true
    },
    dispose() { disposed = true; target.dispose(); material.dispose(); geometry.dispose() },
  }
}
