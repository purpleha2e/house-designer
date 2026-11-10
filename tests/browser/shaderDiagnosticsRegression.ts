import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'

async function run() {
  const renderer = new WebGLRenderer({ preserveDrawingBuffer: true }), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 10)
  renderer.setSize(32, 32); document.body.append(renderer.domElement); camera.position.z = 2
  const geometry = new PlaneGeometry(2, 2), material = new MeshBasicMaterial({ color: '#ffffff' })
  scene.add(new Mesh(geometry, material)); installNonBlockingShaderDiagnostics(renderer)
  const gl = renderer.getContext(), programLog = gl.getProgramInfoLog.bind(gl), shaderLog = gl.getShaderInfoLog.bind(gl), parameter = gl.getProgramParameter.bind(gl)
  let logs = 0, checks = 0
  gl.getProgramInfoLog = p => { logs++; return programLog(p) }
  gl.getShaderInfoLog = s => { logs++; return shaderLog(s) }
  gl.getProgramParameter = (p, name) => { if (name === gl.LINK_STATUS) checks++; return parameter(p, name) }
  let inputRan = false
  setTimeout(() => { inputRan = true }, 0)
  renderer.render(scene, camera) // Deliberately no compileAsync / prewarm.
  const inlineChecks = checks, end = performance.now() + 10000
  while (!checks && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 5))
  const pixels = new Uint8Array(4); gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const result = { logs, checks, inlineChecks, inputRan, pixel: Array.from(pixels), error: gl.getError() }
  geometry.dispose(); material.dispose(); renderer.dispose()
  return result
}
void run().then(result => Object.assign(window, { shaderDiagnosticsResult: result }))
  .catch(error => Object.assign(window, { shaderDiagnosticsResult: { failure: String(error) } }))
