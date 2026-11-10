import { DataTexture, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat,
  Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { fastGIShader } from '../../src/fastGIShader'

// Exercise the actual display sampler against a known field. A padded ceiling
// voxel covers the top of a wall although its receiving side remains indoors.
Object.assign(window, { fastGIReceiverRegression: (async () => {
  const renderer = new WebGLRenderer(), n = 8, width = 128
  const data = new Float32Array(n ** 3 * 4 * 4)
  const light = new DataTexture(data, n * n, n * 4, RGBAFormat, FloatType)
  light.minFilter = light.magFilter = NearestFilter
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: {
    hdFastLight: { value: light }, hdFastMin: { value: new Vector3() }, hdFastSize: { value: new Vector3(8, 1, 8) },
    hdFastN: { value: n }, hdFastReady: { value: 1 }, hdFastWeight: { value: 1 }, mode: { value: 0 },
  }, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}', fragmentShader: `
    #define HD_FAST_GI
    ${fastGIShader}
    uniform int mode;
    void main() {
      float t = gl_FragCoord.x / ${width}.0;
      vec3 q = mode == 0 ? vec3(1.8, 5.0 + 1.6 * t, 2.5) : vec3(1.8, 6.55, 1.2 + 4.8 * t);
      vec3 normal = vec3(1.0, 0.0, 0.0);
      if (mode == 2 || mode == 3) { q = vec3(mode == 2 ? 3.95 : 4.05, 3.5, 1.2 + 4.8 * t); if (mode == 2) normal.x = -1.0; }
      if (mode == 4) q = vec3(1.8, 6.55, 2.5);
      if (mode == 5) q = vec3(1.8, 4.02 + .96 * t, 2.5);
      if (mode == 6) q = vec3(1.8, 3.4 + 2.2 * t, 2.5);
      gl_FragColor = vec4(hdFastIrradiance(q / hdFastN * hdFastSize, normal, normal, vec3(0.0)), 1.0);
    }` })
  const geometry = new PlaneGeometry(2, 2), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  scene.add(new Mesh(geometry, material))
  const target = new WebGLRenderTarget(width, 1, { type: FloatType, depthBuffer: false })
  try {
    const result: Record<string, { min: number; max: number; maxStep: number }> = {}
    for (const [mode, name] of ['ceilingJoin', 'tangentGradient', 'partitionDarkSide', 'partitionLitSide', 'thinCeiling', 'doorRecess', 'recessBoundary'].entries()) {
      data.fill(0)
      for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const index = (x + z * n + y * n * n) * 4
        const occupied = mode >= 5 ? x <= 1 || (x === 2 && y === 4) : mode === 4 ? x <= 1 || y === 6 : mode < 2 ? x <= 1 || y >= 6 : x === 4
        const energy = mode >= 5 ? (y + .5) / n : mode === 4 ? y > 6 ? 20 : 1 : mode === 1 ? (z + .5) / n : mode >= 2 ? x > 4 ? 4 : 0 : 1
        data[index] = data[index + 1] = data[index + 2] = occupied ? 0 : energy / .282095
        data[index + 3] = occupied ? 1 : 0
        data[index + 2 * n ** 3 * 4 + 3] = !occupied && (mode !== 4 || y < 6) ? 1 : 0
      }
      light.needsUpdate = true; material.uniforms.mode.value = mode
      renderer.setRenderTarget(target); await renderer.compileAsync(scene, camera); renderer.render(scene, camera)
      const pixels = new Float32Array(width * 4)
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, 1, pixels)
      const values = Array.from({ length: width }, (_, x) => pixels[x * 4])
      result[name] = { min: Math.min(...values), max: Math.max(...values),
        maxStep: Math.max(...values.slice(1).map((value, x) => Math.abs(value - values[x]))) }
    }
    return result
  } finally { renderer.setRenderTarget(null); target.dispose(); light.dispose(); geometry.dispose(); material.dispose(); renderer.dispose() }
})() })
