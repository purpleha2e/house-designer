import { AmbientLight, DataUtils, DoubleSide, Mesh, MeshStandardMaterial, NoToneMapping, PerspectiveCamera,
  Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms, updateIndirectUniforms } from '../../src/indirectLightingShader'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { buildWallMeshFaces } from '../../src/wallEngine/wallMesh'
import { buildWallBufferGeometryPayload } from '../../src/wallEngine/wallBuffer'
import { createWallBufferGeometry } from '../../src/wallEngine/wallThreeGeometry'
import { createWindowGeometry, disposeWindowGeometry } from '../../src/windowGeometry'
import { createWindowDesign } from '../../src/windowDesign'
import { attachWallMountedLighting } from '../../src/wallMountedLighting'

// A constant field isolates the room-mask boundary from bake noise and shadows.
const field = createIndirectField([{ id: 'room', elevation: 0, height: 3, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: .15 }, { x: 4, y: .15 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }])
for (let z = 0; z < field.volume.n; z++) for (let y = 0; y < field.volume.height; y++) for (let x = 0; x < field.volume.n; x++) {
  const offset = ((z * field.volume.height * 4 + y) * field.volume.n + x) * 4
  field.volume.data.set([1, 1, 1, 1].map(DataUtils.toHalfFloat), offset)
}
field.volume.maps[0].needsUpdate = true
const uniforms = createIndirectUniforms(field)
uniforms.hdGIUseVolume.value = 1
const material = new MeshStandardMaterial({ color: 'white', roughness: 1, side: DoubleSide })
applyIndirectLightingShader(material, uniforms)
applyRoomLightShader(material, createRoomLightShaderUniforms(field.mask))
const sampleOffset = { value: 1 }
const compileLighting = material.onBeforeCompile
material.onBeforeCompile = (shader, renderer) => {
  compileLighting.call(material, shader, renderer)
  shader.uniforms.hdRevealSampleOffset = sampleOffset
  shader.fragmentShader = 'uniform float hdRevealSampleOffset;\n' + shader.fragmentShader.replace(
    'samplePosition = worldPosition + offset;', 'samplePosition = worldPosition + offset * hdRevealSampleOffset;')
}
const faces = buildWallMeshFaces([{ id: 'wall', kind: 'external', height: 3, thickness: .3,
  start: { x: 0, y: 0 }, end: { x: 4, y: 0 },
  openings: [{ id: 'window', modelId: 'window', center: 2, width: 2, bottom: .6, height: 1.4 }] }],
{ exteriorWallSidesByWallId: new Map([['wall', -1]]) })
const geometry = createWallBufferGeometry(buildWallBufferGeometryPayload(faces, { floorId: 'room', materialBatchKey: () => 'white' }))
const scene = new Scene()
scene.add(new AmbientLight('white', .15), new Mesh(geometry, material))
const camera = new PerspectiveCamera(45, 1, .01, 30)
const renderer = new WebGLRenderer({ antialias: false })
renderer.setSize(900, 900); renderer.toneMapping = NoToneMapping
document.body.append(renderer.domElement)
const target = new WebGLRenderTarget(900, 900)
const offset = geometry.getAttribute('hdGIReceiverOffset'), original = offset.array.slice()
function sample(points: number[][]) {
  renderer.setRenderTarget(target); renderer.render(scene, camera)
  return points.map(point => {
    const p = new Vector3().fromArray(point).project(camera), pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, Math.floor((p.x + 1) * 450), Math.floor((p.y + 1) * 450), 1, 1, pixel)
    return pixel[0]
  })
}
function render(fixed: boolean, exterior: boolean) {
  if (fixed) offset.array.set(original); else offset.array.fill(0)
  offset.needsUpdate = true
  camera.position.set(2.7, 1.4, exterior ? -2 : 2)
  camera.lookAt(1.5, 1.65, 0); camera.updateMatrixWorld()
  const depths = exterior ? [-.14, -.12] : [-.07, 0, .08, .1495]
  const result = { header: sample(depths.map(z => [1.8, 2, z])), jamb: sample(depths.map(z => [1, 1.5, z])) }
  renderer.setRenderTarget(null); renderer.render(scene, camera)
  return result
}
const result = { legacy: render(false, false), fixed: render(true, false),
  exteriorLegacy: render(false, true), exteriorFixed: render(true, true) }
// Furniture and other ordinary meshes share the shader but lack this attribute.
geometry.deleteAttribute('hdGIReceiverOffset')
const withoutAttribute = render(true, false)
geometry.setAttribute('hdGIReceiverOffset', offset)
// The neighbouring room is much brighter. A reveal must sample on the owning
// side as well as classify there; the constant-field test cannot detect that.
const splitField = createIndirectField([{ id: 'room', elevation: 0, height: 3, rooms: [
  { signature: 'front', polygon: [{ x: 0, y: .15 }, { x: 4, y: .15 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
  { signature: 'back', polygon: [{ x: 0, y: -4 }, { x: 4, y: -4 }, { x: 4, y: -.15 }, { x: 0, y: -.15 }] },
] }])
for (let z = 0; z < splitField.volume.n; z++) for (let y = 0; y < splitField.volume.height; y++) for (let x = 0; x < splitField.volume.n; x++) {
  const worldZ = splitField.bounds.minZ + z * splitField.bounds.size / (splitField.volume.n - 1)
  const value = worldZ < 0 ? 10 : 1
  const offset = ((z * splitField.volume.height * 4 + y) * splitField.volume.n + x) * 4
  splitField.volume.data.set([value, value, value, 1].map(DataUtils.toHalfFloat), offset)
}
splitField.volume.maps[0].needsUpdate = true
updateIndirectUniforms(uniforms, splitField); uniforms.hdGIUseVolume.value = 1
sampleOffset.value = 0
const neighbouringLegacy = render(true, false)
sampleOffset.value = 1
const neighbours = { legacy: neighbouringLegacy, fixed: render(true, false) }
Object.assign(window, { revealResult: { ...result, withoutAttribute, neighbours }, renderReveal: render })
// Thin partition at an inside corner: normal-only bias leaves the tangential
// footprint straddling the much brighter room behind the adjoining wall.
const cornerField = createIndirectField([{ id: 'room', elevation: 0, height: 3, rooms: [{ signature: 'corner',
  polygon: [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }] }] }])
for (let z = 0; z < cornerField.volume.n; z++) for (let y = 0; y < cornerField.volume.height; y++) for (let x = 0; x < cornerField.volume.n; x++) {
  const worldZ = cornerField.bounds.minZ + z * cornerField.bounds.size / (cornerField.volume.n - 1)
  const value = worldZ < .055 ? 10 : 1
  const index = ((z * cornerField.volume.height * 4 + y) * cornerField.volume.n + x) * 4
  cornerField.volume.data.set([value, value, value, 1].map(DataUtils.toHalfFloat), index)
}
cornerField.volume.maps[0].needsUpdate = true
updateIndirectUniforms(uniforms, cornerField); uniforms.hdGIUseVolume.value = 1
const cornerGeometry = createWallBufferGeometry(buildWallBufferGeometryPayload(buildWallMeshFaces([
  { id: 'north', kind: 'internal', height: 3, thickness: .05, start: { x: 0, y: .08 }, end: { x: 4, y: .08 } },
  { id: 'west', kind: 'internal', height: 3, thickness: .1, start: { x: 0, y: 0 }, end: { x: 0, y: 4 } },
]), { floorId: 'room', materialBatchKey: () => 'white' }))
const originalMesh = scene.children.find(child => child instanceof Mesh)!
scene.remove(originalMesh)
const cornerMesh = new Mesh(cornerGeometry, material); scene.add(cornerMesh)
camera.position.set(2, 1.5, 2); camera.lookAt(.05, 1.5, .2); camera.updateMatrixWorld()
const cornerAttributes = [cornerGeometry.getAttribute('hdGICorner0'), cornerGeometry.getAttribute('hdGICorner1')]
const savedCorners = cornerAttributes.map(a => a.array.slice())
const points = [.106, .12, .14, .17, .22, .3, .48].map(z => [.05, 1.5, z])
const cornerFixed = sample(points)
cornerAttributes.forEach(a => { a.array.fill(0); a.needsUpdate = true })
const cornerLegacy = sample(points)
cornerAttributes.forEach((a, i) => { a.array.set(savedCorners[i]); a.needsUpdate = true })
Object.assign((window as unknown as { revealResult: object }).revealResult, { corner: { fixed: cornerFixed, legacy: cornerLegacy } })
scene.remove(cornerMesh); scene.add(originalMesh)
updateIndirectUniforms(uniforms, splitField); uniforms.hdGIUseVolume.value = 1
render(true, false)

// A room-facing frame sits within a 30 cm wall. Its original 8 cm normal
// classification step cannot reach the room, so it used exterior ambient.
const darkField = createIndirectField([{ id: 'room', elevation: 0, height: 3, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: .15 }, { x: 4, y: .15 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }])
for (let z = 0; z < darkField.volume.n; z++) for (let y = 0; y < darkField.volume.height; y++) for (let x = 0; x < darkField.volume.n; x++) {
  const i = ((z * darkField.volume.height * 4 + y) * darkField.volume.n + x) * 4
  darkField.volume.data.set([.025, .025, .025, 1].map(DataUtils.toHalfFloat), i)
}
darkField.volume.maps[0].needsUpdate = true
const frameUniforms = createIndirectUniforms(darkField)
frameUniforms.hdGIUseVolume.value = 1; frameUniforms.hdGIIndoorFill.value = 0
const frameWindow = createWindowGeometry({ ...createWindowDesign(), width: 1, height: 1.1, depth: .08 })
frameWindow.position.set(2, .6, -.05); frameWindow.rotation.y = Math.PI
frameWindow.traverse(object => {
  if (!(object instanceof Mesh)) return
  const m = object.material as MeshStandardMaterial
  applyIndirectLightingShader(m, frameUniforms)
})
const frameScene = new Scene(); frameScene.add(frameWindow, new AmbientLight('white', 1.5))
frameWindow.updateWorldMatrix(true, true)
const originalFrameGeometries = new Map<Mesh, typeof geometry>()
frameWindow.traverse(object => { if (object instanceof Mesh) originalFrameGeometries.set(object, object.geometry) })
const restoreFrame = attachWallMountedLighting(frameWindow, { id: 'window-wall', kind: 'external', thickness: .3,
  height: 3, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }, -1)
const fixedFrameGeometries = new Map([...originalFrameGeometries.keys()].map(mesh => [mesh, mesh.geometry]))
function renderWindowFrame(fixed: boolean, exterior: boolean) {
  const geometries = fixed ? fixedFrameGeometries : originalFrameGeometries
  geometries.forEach((g, mesh) => { mesh.geometry = g })
  camera.position.set(2.1, 1.2, exterior ? -2 : 2); camera.lookAt(2, 1.2, -.09); camera.updateMatrixWorld()
  const points = [1.53, 2.47].flatMap(x => [.75, 1.15, 1.55].map(y => [x, y, exterior ? -.13 : -.05]))
  renderer.setRenderTarget(target); renderer.render(frameScene, camera)
  const values = points.map(point => {
    const p = new Vector3().fromArray(point).project(camera), pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, Math.floor((p.x + 1) * 450), Math.floor((p.y + 1) * 450), 1, 1, pixel)
    return pixel[0]
  })
  renderer.setRenderTarget(null); renderer.render(frameScene, camera)
  return values
}
const windowFrame = { legacy: renderWindowFrame(false, false), fixed: renderWindowFrame(true, false),
  exteriorLegacy: renderWindowFrame(false, true), exteriorFixed: renderWindowFrame(true, true) }
Object.assign((window as unknown as { revealResult: object }).revealResult, { windowFrame })
Object.assign(window, { renderWindowFrame, disposeFrameFixture: () => {
  fixedFrameGeometries.forEach((g, mesh) => { mesh.geometry = g }); restoreFrame(); disposeWindowGeometry(frameWindow); darkField.dispose()
} })
