import { BoxGeometry, BufferGeometry, Matrix4, PlaneGeometry } from 'three'
import { prepareHouseGeometry, type HousePart } from '../../src/lightingLab/houseGeometry'
import { HouseLightingLab } from '../../src/lightingLab/houseEngine'

// The finish extends 25 mm into two adjoining walls, as in the house model.
// The diagonal corner must be repaired as well as the straight boundaries.
const meshes = [new PlaneGeometry(4.025, 4.025).rotateX(Math.PI / 2).translate(2.0125, 2.4, 2.0125),
  new BoxGeometry(.3, 3, 5).translate(4.15, 1.5, 2),
  new BoxGeometry(5, 3, .3).translate(2, 1.5, 4.15)]
const parts: HousePart[] = meshes.map((g: BufferGeometry, i) => ({ name: i ? 'wall' : 'ceiling',
  position: Float32Array.from(g.attributes.position.array), normal: Float32Array.from(g.attributes.normal.array),
  uv: Float32Array.from(g.attributes.uv.array), index: Uint32Array.from(g.index!.array), structural: true,
  matrices: [new Matrix4().toArray()], ranges: [{ start: 0, count: g.index!.count, material: 0 }] }))
const data = prepareHouseGeometry(parts, () => {})
const snapshot = { parts, finishes: [{ colour: [.8, .8, .8], emission: [0, 0, 0], map: null, alphaTest: 0, side: 0 }],
  position: [1, 1.5, 1], quaternion: [0, 0, 0, 1], fov: 45 }
const lab = new HouseLightingLab(document.querySelector<HTMLElement>('#viewport')!, snapshot, data)
lab.camera.lookAt(4, 2.4, 4)
lab.setInput({ daylight: false, sunDirection: [0, 1, 0], sunColour: [0, 0, 0], lights: [] })
Object.assign(window, { receiverLab: lab })
await lab.start(() => {}, () => {}, () => {})
lab.setPaused(true)
Object.assign(window, { receiverReady: true })
meshes.forEach(g => g.dispose())
