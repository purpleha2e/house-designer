import { Box3, DepthTexture, DoubleSide, Mesh, MeshNormalMaterial, OrthographicCamera,
  PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget, type Object3D } from 'three'
import { installNonBlockingShaderDiagnostics } from './shaderDiagnostics'
import { waitForViewportIdle } from './viewportScheduling'

// One temporary context at a time, with a cached result per model in the plan.
// Never compile the imported model's lit/textured materials just for a thumbnail.
let pending: Promise<unknown> = Promise.resolve()
export function renderModelPlanPreview(source: Object3D): Promise<HTMLCanvasElement> {
  const result = pending.then(() => renderPreview(source))
  pending = result.catch(() => undefined)
  return result
}

async function renderPreview(source: Object3D) {
  await waitForViewportIdle()
  const canvas = document.createElement('canvas'), scene = new Scene(), model = source.clone(true)
  scene.add(model)
  const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3())
  const width = Math.max(size.x, .001), depth = Math.max(size.z, .001)
  canvas.width = Math.max(1, Math.round(512 * width / Math.max(width, depth)))
  canvas.height = Math.max(1, Math.round(512 * depth / Math.max(width, depth)))
  const far = Math.max(size.y * 4, 20)
  const camera = new OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, .01, far)
  camera.position.set(centre.x, bounds.max.y + Math.max(size.y, 5), centre.z)
  camera.up.set(0, 0, -1)
  camera.lookAt(centre)
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true })
  installNonBlockingShaderDiagnostics(renderer)
  renderer.setPixelRatio(1); renderer.setSize(canvas.width, canvas.height, false)
  renderer.setClearColor(0, 0)
  const target = new WebGLRenderTarget(canvas.width, canvas.height, { depthTexture: new DepthTexture(canvas.width, canvas.height) })
  const normal = new MeshNormalMaterial({ side: DoubleSide, toneMapped: false })
  scene.overrideMaterial = normal
  const outline = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { normals: { value: target.texture }, depths: { value: target.depthTexture },
      pixel: { value: new Vector2(1 / canvas.width, 1 / canvas.height) }, depthStep: { value: .02 / (far - .01) } },
    vertexShader: 'varying vec2 uvPlan; void main(){uvPlan=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `
      uniform sampler2D normals; uniform sampler2D depths; uniform vec2 pixel; uniform float depthStep;
      varying vec2 uvPlan;
      void main(){
        vec4 centre=texture2D(normals,uvPlan);float z=texture2D(depths,uvPlan).r;
        float ink=0.0,coverage=step(.5,centre.a);
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 uv=uvPlan+vec2(float(x),float(y))*pixel*1.5;
          vec4 next=texture2D(normals,uv);float present=step(.5,next.a);
          coverage=max(coverage,present);
          ink=max(ink,abs(step(.5,centre.a)-present));
          if(centre.a>.5&&next.a>.5){
            ink=max(ink,step(depthStep,abs(z-texture2D(depths,uv).r)));
            ink=max(ink,step(.3,length(centre.rgb-next.rgb)));
          }
        }
        if(centre.a>.5&&(uvPlan.x<pixel.x*1.5||uvPlan.y<pixel.y*1.5||uvPlan.x>1.0-pixel.x*1.5||uvPlan.y>1.0-pixel.y*1.5))ink=1.0;
        gl_FragColor=vec4(vec3(1.0-ink),coverage);
      }`,
  })
  const plane = new PlaneGeometry(2, 2), output = new Scene()
  const quad = new Mesh(plane, outline)
  quad.frustumCulled = false
  output.add(quad)
  try {
    await renderer.compileAsync(scene, camera)
    await renderer.compileAsync(output, camera)
    await waitForViewportIdle()
    renderer.setRenderTarget(target); renderer.render(scene, camera)
    await waitForViewportIdle()
    renderer.setRenderTarget(null); renderer.render(output, camera)
    // Copy before releasing the WebGL context; Konva receives a plain cached canvas.
    const result = document.createElement('canvas')
    result.width = canvas.width; result.height = canvas.height
    result.getContext('2d')!.drawImage(canvas, 0, 0)
    return result
  } finally {
    target.dispose(); normal.dispose(); outline.dispose(); plane.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
