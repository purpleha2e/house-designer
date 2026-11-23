import { Matrix4, PlaneGeometry } from 'three'
import { prepareHouseGeometry } from '../../src/lightingLab/houseGeometry'
import { HouseLightingLab } from '../../src/lightingLab/houseEngine'
const geometry = new PlaneGeometry(2, 2)
const part = { position: Float32Array.from(geometry.attributes.position.array), normal: Float32Array.from(geometry.attributes.normal.array),
  uv: Float32Array.from(geometry.attributes.uv.array), index: Uint32Array.from(geometry.index!.array), structural: true,
  matrices: [new Matrix4().toArray()], ranges: [{ start: 0, count: 6, material: 0 }] }
const snapshot = { parts: [part], finishes: [{ colour: [.7, .7, .7], emission: [0, 0, 0], map: null, alphaTest: 0, side: 0 }],
  position: [0, 0, 3], quaternion: [0, 0, 0, 1], fov: 45 }
const lab = new HouseLightingLab(document.querySelector<HTMLElement>('#viewport')!, snapshot, prepareHouseGeometry([part], () => {}))
Object.assign(window, { directLab: lab }); geometry.dispose()
lab.setInput({ daylight: false, sunDirection: [0, 0, 1], sunColour: [0, 0, 0], lights: [{ kind: 'point', position: [0, 0, 2], target: [0, 0, 0],
  color: '#ffffff', power: 90, distance: 0, falloff: 2, angle: 1, penumbra: 0 }] })
lab.setIndirect(false); await lab.start(() => {}, () => {}, () => {})
