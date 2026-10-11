import { Camera, DataUtils, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, RGBAFormat,
  Scene, ShaderMaterial, SphericalHarmonics3, WebGLRenderTarget, type WebGLCubeRenderTarget, type WebGLRenderer } from 'three'

/** Integrate first-order RGB SH on the GPU; read four pixels instead of six images. */
export function createIndirectProbeIntegrator(size: number) {
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { radiance: { value: null } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform samplerCube radiance;
      void main() {
        int coefficient = int(gl_FragCoord.x);
        vec3 sum = vec3(0.0); float totalWeight = 0.0;
        for (int face = 0; face < 6; face++) {
          for (int y = 0; y < ${size}; y++) for (int x = 0; x < ${size}; x++) {
            float col = -1.0 + (float(x) + .5) * ${2 / size};
            float row = 1.0 - (float(y) + .5) * ${2 / size};
            vec3 p;
            if (face == 0) p = vec3(1.0, row, -col);
            else if (face == 1) p = vec3(-1.0, row, col);
            else if (face == 2) p = vec3(col, 1.0, -row);
            else if (face == 3) p = vec3(col, -1.0, row);
            else if (face == 4) p = vec3(col, row, 1.0);
            else p = vec3(-col, row, -1.0);
            float lengthSquared = dot(p, p);
            float weight = 4.0 / (sqrt(lengthSquared) * lengthSquared);
            vec3 direction = normalize(p);
            float basis = coefficient == 0 ? .2820947918 : .4886025119 *
              (coefficient == 1 ? direction.y : coefficient == 2 ? direction.z : direction.x);
            sum += textureCube(radiance, direction).rgb * basis * weight;
            totalWeight += weight;
          }
        }
        gl_FragColor = vec4(sum * (12.5663706144 / totalWeight), 1.0);
      }`,
  })
  scene.add(new Mesh(geometry, material))
  const target = new WebGLRenderTarget(4, 1, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false })
  const pixels = new Uint16Array(16)
  return {
    compile(renderer: WebGLRenderer, cube: WebGLCubeRenderTarget) {
      material.uniforms.radiance.value = cube.texture
      return renderer.compileAsync(scene, camera as Camera)
    },
    async read(renderer: WebGLRenderer, cube: WebGLCubeRenderTarget) {
      const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
      const stats = { ...renderer.info.render }
      material.uniforms.radiance.value = cube.texture
      try { renderer.setRenderTarget(target); renderer.render(scene, camera) }
      finally { renderer.setRenderTarget(previous, face, mip); Object.assign(renderer.info.render, stats) }
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 4, 1, pixels)
      const sh = new SphericalHarmonics3()
      for (let i = 0; i < 4; i++) sh.coefficients[i].set(DataUtils.fromHalfFloat(pixels[i * 4]), DataUtils.fromHalfFloat(pixels[i * 4 + 1]), DataUtils.fromHalfFloat(pixels[i * 4 + 2]))
      return sh
    },
    dispose() { geometry.dispose(); material.dispose(); target.dispose() },
  }
}

/** Keep costly frames conservative; otherwise finish a cubemap within a bounded CPU budget. */
export function indirectCaptureFaceBudget(frameSeconds: number) { return frameSeconds > 1 / 35 ? 1 : 6 }
