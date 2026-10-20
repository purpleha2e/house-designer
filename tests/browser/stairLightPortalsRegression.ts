import { Scene, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, PerspectiveCamera, WebGLRenderer, WebGLRenderTarget, Vector3, DataUtils, ShaderMaterial } from 'three'
import { createRoomLightMaskStack } from '../../src/roomLightMask'
import { applyRoomLightShader, createRoomLightBoundaryTexture, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../../src/roomLightShader'
import { createLightPortalTexture } from '../../src/roomLightPortals'
import { createIndirectField } from '../../src/indirectLighting'
import { createIndirectUniforms, indirectVolumeShaderDeclarations } from '../../src/indirectLightingShader'

const renderer = new WebGLRenderer({ antialias: false }); renderer.setSize(512, 512); document.body.append(renderer.domElement)
const scene = new Scene(), camera = new PerspectiveCamera(45, 1, .01, 30), target = new WebGLRenderTarget(512, 512)
camera.position.set(0, 4, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
const polygon = [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }]
const mask = createRoomLightMaskStack([{ id: 'ground', elevation: 0, rooms: [{ signature: 'room', polygon }] },
  { id: 'upper', elevation: 2.9, rooms: [
    { signature: 'room', polygon: [{ x: -3, y: -3 }, { x: .8, y: -3 }, { x: .8, y: 3 }, { x: -3, y: 3 }] },
    { signature: 'sealed-room', polygon: [{ x: .8, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: .8, y: 3 }] },
  ] }], { minX: -3, minZ: -3, size: 6 }, 64)
const room = createRoomLightShaderUniforms(createRoomLightMaskTexture(mask), createRoomLightBoundaryTexture(mask))
room.enabled.value = 1; room.maskBounds.value.set(-3, -3, 6, 6); room.floorRange.value.set(-.08, 2.89)
room.floorCount.value = 2; room.floorHeights.value.set(mask.floorHeights!)
room.pointRoomIds.value[0] = mask.roomIdsBySignature.get('upper:room')!
const material = new MeshStandardMaterial({ color: 'white', roughness: 1 }); applyRoomLightShader(material, room)
const mesh = new Mesh(new PlaneGeometry(6, 6), material); mesh.rotation.x = -Math.PI / 2; scene.add(mesh)
const light = new PointLight('white', 100, 20, 2); light.position.set(0, 5, 0); scene.add(light)
const opening = [{ x: -.7, y: -.7 }, { x: .7, y: -.7 }, { x: .7, y: .7 }, { x: -.7, y: .7 }]
function render(open: boolean, height = 0) {
  mesh.position.y = height; camera.position.set(0, height + 4, 4); camera.lookAt(0, height, 0); camera.updateMatrixWorld()
  const data = createLightPortalTexture([2.7, 2.914].map(y => ({ y, openings: open ? [opening] : [] })), mask.bounds, 128)
  room.portals.value = data.texture; room.portalBounds.value.copy(data.bounds); room.portalHeights.value.set(data.heights); room.portalCount.value = data.count
  room.portalEdges.value = data.edges; room.portalEdgeRanges.value = data.edgeRanges
  renderer.setRenderTarget(target); renderer.render(scene, camera)
  const pixels = new Uint8Array(512 * 512 * 4); renderer.readRenderTargetPixels(target, 0, 0, 512, 512, pixels)
  const at = (x: number, z: number) => {
    const p = new Vector3(x, height, z).project(camera), px = Math.floor((p.x + 1) * 256), py = Math.floor((p.y + 1) * 256), i = (py * 512 + px) * 4
    return pixels[i] + pixels[i + 1] + pixels[i + 2]
  }
  const result = { belowOpening: at(0, 0), belowSolid: at(2.1, 0), programs: renderer.info.programs?.length }
  data.dispose(); return result
}
const portalResult = { sealed: render(false), open: render(true), sealedAgain: render(false), ownStorey: render(false, 3.1) }
light.position.x = 1.1; room.pointRoomIds.value[0] = mask.roomIdsBySignature.get('upper:sealed-room')!
const otherRoom = render(true)
Object.assign(window, { stairPortalResult: { ...portalResult, otherRoom } })
renderer.setRenderTarget(null)

// The lamp and stair entrance belong to the same hallway, but the straight
// line between them cuts through another room inside that concave hallway.
const pathMask = createRoomLightMaskStack([
  { id: 'ground', elevation: 0, rooms: [{ signature: 'room', polygon }] },
  { id: 'upper', elevation: 2.9, rooms: [
    { signature: 'hall', polygon },
    { signature: 'bedroom', polygon: [{ x: -.95, y: -.3 }, { x: -.75, y: -.3 }, { x: -.75, y: .3 }, { x: -.95, y: .3 }] },
  ] },
], mask.bounds, 64)
const originalMask = room.mask.value, pathTexture = createRoomLightMaskTexture(pathMask)
const originalBoundaries = room.boundaries.value, pathBoundaries = createRoomLightBoundaryTexture(pathMask)
room.mask.value = pathTexture; room.boundaries.value = pathBoundaries
room.pointRoomIds.value[0] = pathMask.roomIdsBySignature.get('upper:hall')!
light.position.set(-1.1, 5, 0)
const obstructed = { downstairs: render(true), ownStorey: render(false, 3.1) }
light.position.x = 0
Object.assign(window, { stairConcaveRoomResult: { ...obstructed, clear: render(true) } })
room.mask.value = originalMask; room.boundaries.value = originalBoundaries; pathTexture.dispose(); pathBoundaries.dispose()

// Deliberately different per-storey radiance makes the old discontinuity
// visible. Open space must blend; a solid slab must keep the volumes separate.
const field = createIndirectField([0, 3].map((elevation, i) => ({ id: `floor-${i}`, elevation, height: 2.7,
  rooms: [{ signature: 'room', polygon }] })), 0)
const gi = createIndirectUniforms(field); gi.hdGIUseVolume.value = 1
for (let z = 0; z < field.volume.n; z++) for (let y = 0; y < field.volume.height * 4; y++) for (let x = 0; x < field.volume.n; x++) {
  const index = ((z * field.volume.height * 4 + y) * field.volume.n + x) * 4
  const coefficient = Math.floor(y / field.volume.height), floor = Math.floor((y % field.volume.height) / 14)
  for (let c = 0; c < 3; c++) field.volume.data[index + c] = DataUtils.toHalfFloat(coefficient === 0 ? floor ? .9 : .1 : 0)
  field.volume.data[index + 3] = DataUtils.toHalfFloat(1)
}
field.volume.maps[0].needsUpdate = true
const giScene = new Scene(), giMaterial = new ShaderMaterial({ uniforms: { ...gi, testHeight: { value: 3 } },
  vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
  fragmentShader: `${indirectVolumeShaderDeclarations}
    uniform float testHeight;
    void main(){vec3 mean;float floor=testHeight<hdGIFloorRanges[0].y?0.0:1.0;
      gl_FragColor=vec4(hdGIVolumeIrradiance(floor,vec3(0.0,testHeight,0.0),vec3(1.0,0.0,0.0),0.0,mean),1.0);}` })
giScene.add(new Mesh(new PlaneGeometry(2, 2), giMaterial))
function giSeam(open: boolean) {
  const bytes = field.mask.image.data as Uint8Array, range = field.ranges[0]
  const ceiling = open ? range.top : 2.4, packed = Math.round((ceiling - range.bottom) / (range.top - range.bottom) * 65535)
  for (let i = 0; i < 512 * 512; i++) { bytes[i * 4 + 1] = packed >> 8; bytes[i * 4 + 2] = packed & 255 }
  field.mask.needsUpdate = true
  return [2.99, 3.01].map(y => {
    giMaterial.uniforms.testHeight.value = y; renderer.setRenderTarget(target); renderer.render(giScene, camera)
    const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target, 256, 256, 1, 1, pixel); return pixel[0]
  })
}
Object.assign(window, { stairGISeamResult: { open: giSeam(true), solid: giSeam(false) } })
renderer.setRenderTarget(null)

// Isolate grazing paths immediately beside an opening boundary.
scene.remove(mesh)
const wall = new Mesh(new PlaneGeometry(6, 6), material)
wall.rotation.y = -Math.PI / 2; wall.position.set(.7, 3, 0); scene.add(wall)
light.intensity = 20; light.position.set(0, 5, 0); room.pointRoomIds.value[0] = mask.roomIdsBySignature.get('upper:room')!
const portals = createLightPortalTexture([2.7, 2.914].map(y => ({ y, openings: [opening] })), mask.bounds, 128)
room.portalEdges.value=portals.edges; room.portalEdgeRanges.value=portals.edgeRanges; room.portals.value = portals.texture; room.portalBounds.value.copy(portals.bounds); room.portalHeights.value.set(portals.heights); room.portalCount.value = portals.count
camera.position.set(-3, 2.8, 1); camera.lookAt(.7, 2.8, 0); camera.updateMatrixWorld()
const heights = [2.5,2.6,2.65,2.69,2.71,2.8,2.85,2.9,2.913,2.93]
function sampleWall(enabled: number) {
 room.enabled.value=enabled; renderer.setRenderTarget(target); renderer.render(scene,camera)
 return heights.map(y=>{const p=new Vector3(wall.position.x,y,0).project(camera);const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,Math.floor((p.x+1)*256),Math.floor((p.y+1)*256),1,1,pixel);return pixel[0]})
}
const wallSamples = { heights, masked: sampleWall(1), unmasked: sampleWall(0) }
wall.position.x = .72
Object.assign(window,{stairWallPortalResult:{...wallSamples, outside: sampleWall(1)}})
portals.dispose()
