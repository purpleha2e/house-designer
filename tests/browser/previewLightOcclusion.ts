import { BoxGeometry, DataUtils, Mesh, MeshStandardMaterial, PointLight, Scene, Vector3, WebGLRenderer } from 'three'
import { createFastGI, fastGIRoom } from '../../src/fastGI'
import { createIndirectField } from '../../src/indirectLighting'
import { createIndirectUniforms } from '../../src/indirectLightingShader'
import { prepareFastCaptureScene } from '../../src/indirectCaptureScene'

const renderer = new WebGLRenderer(); renderer.setSize(400, 240); document.body.appendChild(renderer.domElement)
const source = new Scene(), material = new MeshStandardMaterial({ color: 'white', roughness: 1 })
const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); source.add(mesh); return mesh
}
box(4, 0, 2, 8, .1, 4); box(4, 3, 2, 8, .1, 4)
box(0, 1.5, 2, .1, 3, 4); box(8, 1.5, 2, .1, 3, 4)
box(4, 1.5, 0, 8, 3, .1); box(4, 1.5, 4, 8, 3, .1)
const partition = box(4, 1.5, 2, .1, 3, 4), light = new PointLight('white', 100)
light.position.set(2, 2, 2); source.add(light)
const field = createIndirectField([]), uniforms = createIndirectUniforms(field)
const engine = createFastGI(renderer, source, uniforms, 16, 32)!
const room = fastGIRoom([{ id: 'floor', elevation: 0, height: 3, rooms: [{ signature: 'right', polygon: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }] }] }], new Vector3(6, 1.5, 2))!
async function capture() {
  const id = engine.request(room, true, false)
  await engine.prepare(id, () => prepareFastCaptureScene(source, () => false), [light])
  await new Promise<void>((resolve, reject) => {
    const frame = () => { engine.step({ enabled: true, hybrid: true, mode: 'fast', viewsPerFrame: 3 }, false, 1 / 60)
      if (engine.stats.error) reject(Error(engine.stats.error))
      else if (engine.stats.state === 'ready') resolve()
      else requestAnimationFrame(frame)
    }; requestAnimationFrame(frame)
  })
  const target = engine.lighting[engine.bank], data = new Uint16Array(target.width * target.height * 4)
  await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, data)
  let energy = 0
  for (let pixel = 0; pixel < 16 ** 3; pixel++) for (let c = 0; c < 3; c++) energy += Math.max(0, DataUtils.fromHalfFloat(data[pixel * 4 + c]))
  return energy / (16 ** 3 * 3)
}
try {
  const closed = await capture(); source.remove(partition); const open = await capture()
  light.intensity = 0; const off = await capture()
  Object.assign(window, { previewOcclusionResult: { closed, open, off, glError: renderer.getContext().getError() } })
} catch (error) { Object.assign(window, { previewOcclusionResult: { error: String(error) } }) }
