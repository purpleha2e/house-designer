import { BoxGeometry, BufferGeometry, DataTexture, FloatType, Matrix4, PlaneGeometry, RGBAFormat, Vector3 } from 'three'
import { prepareHouseGeometry, type HousePart } from '../../src/lightingLab/houseGeometry'
import { prepareCoarseHouseParts } from '../../src/lightingLab/houseCoarseModels'
import { HouseLightingLab } from '../../src/lightingLab/houseEngine'

const meshes = [new PlaneGeometry(5, 3).translate(0, 1.5, 0), new PlaneGeometry(5, 5).rotateX(-Math.PI / 2),
  new BoxGeometry(4, .15, .03).translate(0, .075, .02)]
const part = (g: BufferGeometry, i: number): HousePart => ({
  position: Float32Array.from(g.attributes.position.array), normal: Float32Array.from(g.attributes.normal.array),
  uv: Float32Array.from(g.attributes.uv.array), index: Uint32Array.from(g.index!.array), structural: true,
  matrices: [new Matrix4().toArray()], ranges: [{ start: 0, count: g.index!.count, material: 0 }],
  lightingProxy: i === 2 ? 'shared-detail' : undefined,
})
const parts = meshes.map(part), data = prepareHouseGeometry(await prepareCoarseHouseParts(parts, () => {}), () => {})
const snapshot = { parts, finishes: [{ colour: [.8, .8, .8], emission: [0, 0, 0], map: null, alphaTest: 0, side: 0 }],
  position: [0, .35, 2], quaternion: [0, 0, 0, 1], fov: 45 }
const lab = new HouseLightingLab(document.querySelector<HTMLElement>('#viewport')!, snapshot, data)
lab.camera.lookAt(0, .1, 0)
lab.setInput({ daylight: false, sunDirection: [0, 1, 0], sunColour: [0, 0, 0], lights: [] })
// Controlled irradiance isolates receiver selection from stochastic GI: the
// wall is bright and the upward-facing floor is dark. Trim is never captured.
const values = new Float32Array(data.width * data.height * 4)
for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
  const card = data.cards[Math.floor(y / 16) * 32 + Math.floor(x / 16)]
  const value = card && data.normal[card.start * 3 + 2] > .99 ? .8 : .02
  values.set([value, value, value, 1], (y * data.width + x) * 4)
}
const texture = new DataTexture(values, data.width, data.height, RGBAFormat, FloatType); texture.needsUpdate = true
const pixel = (y: number) => {
  const p = new Vector3(0, y, .035).project(lab.camera)
  return { x: Math.round((p.x + 1) * 320), y: Math.round((1 - p.y) * 240) }
}
Object.assign(window, { trimLab: lab, trimPixels: () => [pixel(.025), pixel(.125)] })
const testUniforms = (lab as unknown as { uniforms: { filteredCache: { value: DataTexture } } }).uniforms
await lab.start(() => { testUniforms.filteredCache.value = texture }, () => {}, () => {})
meshes.forEach(g => g.dispose())
